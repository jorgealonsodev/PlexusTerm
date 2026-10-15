import { Play, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TerminalSettings } from "../settings/settings";
import { writeText } from "../terminal/clipboard";
import { AnswerText } from "./AnswerText";
import { aiAssist, aiKeyStatus, describeAiError, isAiError, type AiProvider, type AiTurn } from "./aiClient";
import { aiConfigOf, needsApiKey, newAiSessionId, truncateSelection } from "./aiContext";
import { ModelPicker } from "./ModelPicker";

const PROVIDER_NAMES: Record<TerminalSettings["aiProvider"], string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  "openai-compatible": "the OpenAI-compatible endpoint",
  "opencode-go": "OpenCode Go",
};

/** What the chat knows about its linked terminal. Terminal output is never part of it. */
export interface ChatContext {
  os: string;
  cwd: string | null;
  /** The host's recent commands, read when a question is sent. */
  history: () => string[];
}

interface ChatPaneProps {
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
}

/** One question and what came back for it. */
interface ChatTurn {
  id: number;
  question: string;
  selection: string | null;
  state: "loading" | "answer" | "error";
  answer: string;
  command: string | null;
  error: string;
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
  const [copied, setCopied] = useState<"no" | "yes" | "failed">("no");
  return (
    <div className="chat__command">
      <pre className="assistant__command" aria-label="Suggested command">
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
          {copied === "yes" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
        </button>
        <button
          type="button"
          className="btn"
          title="Types the command into the terminal without running it"
          onClick={() => onInsert(command)}
        >
          Insert
        </button>
        <button
          type="button"
          className="btn btn--primary btn--icon"
          title="Runs the command in the terminal (types it and presses Enter)"
          onClick={() => onRun(command)}
        >
          <Play size={14} />
          Run
        </button>
      </div>
    </div>
  );
}

/**
 * The AI chat pane under a terminal (S9): any question, answers as in S8, follow-ups with the
 * earlier turns as context, and one OpenCode session per pane. A command runs only when Run is clicked.
 */
export function ChatPane({ settings, context, selection, focused, onInsert, onRun, onOpenSettings, onClose, onSelectModel }: ChatPaneProps) {
  const [sessionId] = useState(newAiSessionId);
  const [input, setInput] = useState("");
  /** The selection still attached to the next question; dropped once sent or removed. */
  const [chip, setChip] = useState(() => truncateSelection(selection));
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [keyMissing, setKeyMissing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Bumped by Stop and on unmount: older answers are dropped. */
  const seq = useRef(0);
  const nextId = useRef(1);
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

  useEffect(() => {
    if (focused) inputRef.current?.focus();
  }, [focused]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns]);

  const send = () => {
    const question = input.trim();
    if (!question || loading || keyMissing) return;
    const mine = ++seq.current;
    const id = nextId.current++;
    const attached = chip || null;
    const conversation: AiTurn[] = turns
      .filter((t) => t.state === "answer")
      .slice(-10)
      .map((t) => ({ question: t.question, selection: t.selection, answer: t.answer, command: t.command }));
    setTurns((prev) => [
      ...prev,
      { id, question, selection: attached, state: "loading", answer: "", command: null, error: "" },
    ]);
    setInput("");
    setChip("");
    const update = (patch: Partial<ChatTurn>) =>
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    aiAssist(aiConfigOf(settings, sessionId), {
      prompt: question,
      os: context.os,
      cwd: context.cwd,
      history: context.history(),
      selection: attached,
      conversation,
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
    <section className="chat" aria-label="AI chat">
      <header className="chat__header">
        <span className="chat__title">AI</span>
        <ModelPicker provider={provider} model={model} baseUrl={settings.aiBaseUrl} onSelect={onSelectModel} />
        <button
          type="button"
          className="chat__close"
          aria-label="Close AI chat"
          title="Close AI chat (Ctrl+Shift+W)"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="chat__turns" ref={listRef} aria-live="polite">
        {turns.length === 0 && !keyMissing && (
          <p className="muted chat__empty">Ask anything. Commands run only when you click Run.</p>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="chat__turn">
            <div className="chat__question" aria-label="Question">
              {turn.selection && <pre className="assistant__selection">{turn.selection}</pre>}
              <p className="assistant__text">{turn.question}</p>
            </div>
            {turn.state === "loading" && <p className="muted">Asking…</p>}
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
          <p>No API key is saved for {PROVIDER_NAMES[provider]}. Add one in Settings → AI.</p>
          <button type="button" className="btn" onClick={onOpenSettings}>
            Open AI settings
          </button>
        </div>
      )}
      {chip && (
        <div className="chat__chip">
          <pre className="assistant__selection" aria-label="Selected text to send">
            {chip}
          </pre>
          <button
            type="button"
            className="chat__chip-remove"
            aria-label="Remove selected text"
            title="Do not send the selected text"
            onClick={() => setChip("")}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="chat__input-row">
        <textarea
          ref={inputRef}
          className="assistant__prompt chat__input"
          aria-label="Your question"
          placeholder="Ask anything…"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKey}
        />
        {loading ? (
          <button type="button" className="btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={!input.trim() || keyMissing} onClick={send}>
            Send
          </button>
        )}
      </div>
    </section>
  );
}
