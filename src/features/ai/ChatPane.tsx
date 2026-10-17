import { FileText, MessageSquarePlus, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { t as translate, useT } from "../../i18n/i18n";
import type { TerminalSettings } from "../settings/settings";
import { writeText } from "../terminal/clipboard";
import { AnswerText } from "./AnswerText";
import { aiAssist, aiKeyStatus, describeAiError, isAiError, type AiProvider, type AiTurn } from "./aiClient";
import { aiConfigOf, needsApiKey, newAiSessionId, truncateSelection } from "./aiContext";
import { recallChat, rememberChat, type ChatTurn } from "./chatMemory";
import { ModelPicker } from "./ModelPicker";
import type { PathDrag } from "../drop/pathDrag";
import { MAX_ATTACHED_FILES, describeAttachError, fileName, readAttachment, type AttachedText } from "./attachments";

const PROVIDER_NAMES: Record<Exclude<TerminalSettings["aiProvider"], "openai-compatible">, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  "opencode-go": "OpenCode Go",
};

/** The provider as the object of a sentence ("No API key is saved for …"). */
const providerName = (provider: TerminalSettings["aiProvider"]) =>
  provider === "openai-compatible" ? translate("ai.providers.openaiCompatibleEndpoint") : PROVIDER_NAMES[provider];

/** What the app can attach to an open chat's next question. */
export interface ChatTarget {
  /** Files dropped on the chat (S6). */
  attachFiles: (drag: PathDrag) => void;
  /** Selected terminal text from "Ask the AI" (S7); replaces the selection chip. */
  attachSelection: (text: string) => void;
}

/** What the chat knows about its linked terminal. Terminal output is never part of it. */
export interface ChatContext {
  os: string;
  /** Name of the local shell (e.g. pwsh); null or missing when unknown or remote. */
  shell?: string | null;
  cwd: string | null;
  /** The host's recent commands, read when a question is sent. */
  history: () => string[];
}

interface ChatPaneProps {
  /** The linked terminal's pane id: its conversation comes back when the chat opens again. */
  conversationKey: string;
  settings: TerminalSettings;
  context: ChatContext;
  /** The linked terminal's selection when the chat opened, offered with the first question. */
  selection: string;
  /** The pane has the keyboard focus in its tab: the input takes it. */
  focused: boolean;
  /** Types a command into the linked terminal without Enter. */
  onInsert: (command: string) => void;
  /** Sends a command to the linked terminal with Enter. */
  onRun: (command: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  /** Makes `model` of `provider` the AI provider and model (S10). */
  onSelectModel: (provider: AiProvider, model: string) => void;
  /** Hands out how to attach dropped files (S6) and a selection (S7); returns its unregister function. */
  registerDropTarget?: (target: ChatTarget) => () => void;
}


/** A command from an answer, with Copy, Insert (types it, no Enter) and Run (types it and presses Enter). */
function CommandBox({
  command,
  onInsert,
  onRun,
}: {
  command: string;
  onInsert: (command: string) => void;
  onRun: (command: string) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  return (
    <div className="chat__command">
      <pre className="assistant__command" aria-label={t("ai.command.label")}>
        {command}
      </pre>
      <div className="chat__command-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void writeText(command)
              .then(() => setCopied("yes"))
              .catch(() => setCopied("failed"))
          }
        >
          {copied === "yes" ? t("ai.command.copied") : copied === "failed" ? t("ai.command.copyFailed") : t("common.copy")}
        </button>
        <button
          type="button"
          className="btn"
          title={t("ai.command.insertTitle")}
          onClick={() => onInsert(command)}
        >
          {t("ai.command.insert")}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--icon"
          title={t("ai.command.runTitle")}
          onClick={() => onRun(command)}
        >
          <Play size={14} />
          {t("ai.command.run")}
        </button>
      </div>
    </div>
  );
}

/**
 * The AI chat pane under a terminal (S9): any question, answers as in S8, follow-ups with the
 * earlier turns as context, and one OpenCode session per pane. A command runs only when Run is clicked.
 */
export function ChatPane({ conversationKey, settings, context, selection, focused, onInsert, onRun, onOpenSettings, onClose, onSelectModel, registerDropTarget }: ChatPaneProps) {
  const t = useT();
  const [sessionId, setSessionId] = useState(() => recallChat(conversationKey)?.sessionId ?? newAiSessionId());
  const [input, setInput] = useState("");
  /** The selection still attached to the next question; dropped once sent or removed. */
  const [chip, setChip] = useState(() => truncateSelection(selection));
  /** Files dropped on the chat, sent with the next question (S6). */
  const [files, setFiles] = useState<AttachedText[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  /** The files of the question in flight, given back when it is stopped. */
  const pendingFiles = useRef<AttachedText[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [turns, setTurns] = useState<ChatTurn[]>(() => recallChat(conversationKey)?.turns ?? []);
  const [keyMissing, setKeyMissing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Bumped by Stop and on unmount: older answers are dropped. */
  const seq = useRef(0);
  const nextId = useRef(Math.max(0, ...turns.map((turn) => turn.id)) + 1);

  // Kept for the terminal, so closing the chat does not end the conversation.
  useEffect(() => rememberChat(conversationKey, { sessionId, turns }), [conversationKey, sessionId, turns]);

  /** New conversation: no earlier turns and another AI session. */
  const newConversation = () => {
    seq.current++;
    setTurns([]);
    setSessionId(newAiSessionId());
    inputRef.current?.focus();
  };
  const provider = settings.aiProvider;
  const loading = turns.some((t) => t.state === "loading");

  useEffect(() => {
    let live = true;
    if (needsApiKey(provider)) {
      aiKeyStatus(provider)
        .then((saved) => live && setKeyMissing(!saved))
        .catch(() => {});
    } else {
      setKeyMissing(false);
    }
    return () => {
      live = false;
    };
  }, [provider]);

  useEffect(() => () => void seq.current++, []);

  const attach = async (drag: PathDrag) => {
    setAttachError(null);
    const known = new Set(filesRef.current.map((f) => f.path));
    const paths = drag.paths.map((p) => p.path).filter((path) => !known.has(path));
    if (filesRef.current.length + paths.length > MAX_ATTACHED_FILES) {
      return setAttachError(t("ai.chat.tooManyFiles", { max: MAX_ATTACHED_FILES }));
    }
    for (const path of paths) {
      try {
        const file = await readAttachment(drag.origin, path);
        setFiles((prev) => (prev.some((f) => f.path === file.path) ? prev : [...prev, file]));
      } catch (err) {
        setAttachError(describeAttachError(err));
      }
    }
    inputRef.current?.focus();
  };
  const attachRef = useRef(attach);
  attachRef.current = attach;
  useEffect(
    () =>
      registerDropTarget?.({
        attachFiles: (drag) => void attachRef.current(drag),
        attachSelection: (text) => {
          if (text) setChip(truncateSelection(text));
          inputRef.current?.focus();
        },
      }),
    [registerDropTarget],
  );

  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  const send = () => {
    // With only a selection or files attached, the question asks to explain them (L13).
    const attachedOnly = !input.trim() && (chip !== "" || files.length > 0);
    const question = attachedOnly ? t("ai.chat.explainAttached") : input.trim();
    if (!question || loading || keyMissing) return;
    const mine = ++seq.current;
    const id = nextId.current++;
    const attached = chip || null;
    const sentFiles = files;
    pendingFiles.current = sentFiles;
    const conversation: AiTurn[] = turns
      .filter((t) => t.state === "answer")
      .slice(-10)
      .map((t) => ({ question: t.question, selection: t.selection, answer: t.answer, command: t.command }));
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        selection: attached,
        ...(sentFiles.length ? { files: sentFiles.map((f) => f.path) } : {}),
        state: "loading",
        answer: "",
        command: null,
        error: "",
      },
    ]);
    setInput("");
    setChip("");
    setFiles([]);
    setAttachError(null);
    const update = (patch: Partial<ChatTurn>) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    aiAssist(aiConfigOf(settings, sessionId), {
      prompt: question,
      os: context.os,
      ...(context.shell ? { shell: context.shell } : {}),
      cwd: context.cwd,
      history: context.history(),
      selection: attached,
      conversation,
      ...(sentFiles.length ? { files: sentFiles.map(({ path, content }) => ({ path, content })) } : {}),
    })
      .then((reply) => mine === seq.current && update({ state: "answer", answer: reply.answer, command: reply.command }))
      .catch((err) => {
        if (mine !== seq.current) return;
        if (isAiError(err) && err.kind === "noKey") setKeyMissing(true);
        update({ state: "error", error: describeAiError(err) });
      });
  };

  /** Cancels the request in flight; its question (and selection) go back to the input. */
  const stop = () => {
    const pending = turns.find((t) => t.state === "loading");
    if (!pending) return;
    seq.current++;
    setTurns((prev) => prev.filter((t) => t.id !== pending.id));
    setInput(pending.question);
    if (pending.selection) setChip(pending.selection);
    setFiles(pendingFiles.current);
    inputRef.current?.focus();
  };

  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      send();
    }
  };

  const model = settings.aiModel.trim();

  return (
    <section className="chat" aria-label={t("ai.chat.label")}>
      <header className="chat__header">
        <span className="chat__title">{t("ai.chat.title")}</span>
        <ModelPicker provider={provider} model={model} baseUrl={settings.aiBaseUrl} onSelect={onSelectModel} />
        <button
          type="button"
          className="chat__close"
          aria-label={t("ai.chat.newConversation")}
          title={t("ai.chat.newConversation")}
          onClick={newConversation}
        >
          <MessageSquarePlus size={16} />
        </button>
        <button
          type="button"
          className="chat__close"
          aria-label={t("ai.chat.close")}
          title={t("ai.chat.closeTitle")}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="chat__turns" ref={listRef} aria-live="polite">
        {turns.length === 0 && !keyMissing && (
          <p className="muted chat__empty">{t("ai.chat.empty")}</p>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="chat__turn">
            <div className="chat__question" aria-label={t("ai.chat.question")}>
              {turn.selection && <pre className="assistant__selection">{turn.selection}</pre>}
              {turn.files?.map((path) => (
                <p key={path} className="chat__file chat__file--sent" title={path}>
                  <FileText size={12} /> {fileName(path)}
                </p>
              ))}
              <p className="assistant__text">{turn.question}</p>
            </div>
            {turn.state === "loading" && <p className="muted">{t("ai.chat.asking")}</p>}
            {turn.state === "error" && (
              <p className="form-error" role="alert">
                {turn.error}
              </p>
            )}
            {turn.state === "answer" && (
              <div className="assistant__answer">
                {turn.answer && <AnswerText answer={turn.answer} />}
                {turn.command && <CommandBox command={turn.command} onInsert={onInsert} onRun={onRun} />}
              </div>
            )}
          </div>
        ))}
      </div>
      {keyMissing && (
        <div className="assistant__notice" role="alert">
          <p>{t("ai.chat.noKey", { provider: providerName(provider) })}</p>
          <button type="button" className="btn" onClick={onOpenSettings}>
            {t("ai.chat.openSettings")}
          </button>
        </div>
      )}
      {chip && (
        <div className="chat__chip">
          <pre className="assistant__selection" aria-label={t("ai.chat.selectedText")}>
            {chip}
          </pre>
          <button
            type="button"
            className="chat__chip-remove"
            aria-label={t("ai.chat.removeSelection")}
            title={t("ai.chat.removeSelectionTitle")}
            onClick={() => setChip("")}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {files.map((file) => (
        <div key={file.path} className="chat__chip chat__file" title={file.path} aria-label={t("ai.chat.attachedFile", { name: fileName(file.path) })}>
          <FileText size={12} />
          <span className="chat__file-name">{fileName(file.path)}</span>
          {file.truncated && <span className="muted">{t("ai.chat.fileTruncated")}</span>}
          <button
            type="button"
            className="chat__chip-remove"
            aria-label={t("ai.chat.removeFile", { name: fileName(file.path) })}
            onClick={() => setFiles((prev) => prev.filter((f) => f.path !== file.path))}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {attachError && (
        <p className="form-error chat__attach-error" role="alert">
          {attachError}
        </p>
      )}
      <div className="chat__input-row">
        <textarea
          ref={inputRef}
          className="assistant__prompt chat__input"
          aria-label={t("ai.chat.input")}
          placeholder={t("ai.chat.placeholder")}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKey}
        />
        {loading ? (
          <button type="button" className="btn" onClick={stop}>
            {t("common.stop")}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={(!input.trim() && !chip && files.length === 0) || keyMissing} onClick={send}>
            {t("ai.chat.send")}
          </button>
        )}
      </div>
    </section>
  );
}
