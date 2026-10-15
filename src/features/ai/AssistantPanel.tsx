import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { TerminalSettings } from "../settings/settings";
import { writeText } from "../terminal/clipboard";
import { aiAssist, aiKeyStatus, describeAiError, isAiError, type AiAnswer } from "./aiClient";
import { aiConfigOf, needsApiKey, truncateSelection } from "./aiContext";

const PROVIDER_NAMES: Record<TerminalSettings["aiProvider"], string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  "openai-compatible": "the OpenAI-compatible endpoint",
  "opencode-go": "OpenCode Go",
};

/** What the assistant knows about the pane it was opened over. Terminal output is never part of it. */
export interface AssistContext {
  os: string;
  cwd: string | null;
  /** The host's recent commands, read when the question is sent. */
  history: () => string[];
  /** The pane's selection when the assistant opened, "" for none. */
  selection: string;
  /** This conversation's ID: new on every opening, kept for every question asked in it. */
  sessionId: string;
}

interface AssistantPanelProps {
  settings: TerminalSettings;
  context: AssistContext;
  /** False when there is no terminal pane to insert into. */
  canInsert: boolean;
  /** Types the command into the pane without Enter. */
  onInsert: (command: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answer"; reply: AiAnswer }
  | { kind: "error"; message: string };

/** A piece of an answer: plain text, or the inside of a fenced code block. */
type AnswerPart = { code: boolean; text: string };

/** Splits an answer on ``` fence lines; an unclosed fence runs to the end. */
function answerParts(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let code = false;
  let lines: string[] = [];
  const flush = () => {
    const text = code ? lines.join("\n") : lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) parts.push({ code, text });
    lines = [];
  };
  for (const line of answer.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush();
      code = !code;
    } else {
      lines.push(line);
    }
  }
  flush();
  return parts;
}

/** The answer as React text nodes only (never HTML): line breaks kept, code in monospace blocks. */
function AnswerText({ answer }: { answer: string }) {
  return (
    <div className="assistant__reply" aria-label="Answer">
      {answerParts(answer).map((part, i) =>
        part.code ? (
          <pre key={i} className="assistant__command">
            {part.text}
          </pre>
        ) : (
          <p key={i} className="assistant__text">
            {part.text.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}

/** The on-demand assistant (S3, S8): any question in plain words, an answer back, and a command only when one fits; never run. */
export function AssistantPanel({ settings, context, canInsert, onInsert, onClose, onOpenSettings }: AssistantPanelProps) {
  const [prompt, setPrompt] = useState("");
  const selection = truncateSelection(context.selection);
  /** A selection made before opening is offered ticked (and shown) so it is sent unless unticked. */
  const [includeSelection, setIncludeSelection] = useState(selection !== "");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** True once the keyring says no key is saved for the provider. */
  const [keyMissing, setKeyMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Bumped by Cancel and on close: older answers are dropped. */
  const seq = useRef(0);
  const provider = settings.aiProvider;

  useEffect(() => {
    let live = true;
    if (needsApiKey(provider)) {
      aiKeyStatus(provider)
        .then((saved) => live && !saved && setKeyMissing(true))
        .catch(() => {});
    }
    return () => {
      live = false;
      seq.current++;
    };
  }, [provider]);

  const ask = () => {
    if (!prompt.trim() || phase.kind === "loading" || keyMissing) return;
    const mine = ++seq.current;
    setPhase({ kind: "loading" });
    setCopied(false);
    aiAssist(aiConfigOf(settings, context.sessionId), {
      prompt: prompt.trim(),
      os: context.os,
      cwd: context.cwd,
      history: context.history(),
      selection: includeSelection && selection ? selection : null,
    })
      .then((reply) => mine === seq.current && setPhase({ kind: "answer", reply }))
      .catch((err) => {
        if (mine !== seq.current) return;
        if (isAiError(err) && err.kind === "noKey") setKeyMissing(true);
        setPhase({ kind: "error", message: describeAiError(err) });
      });
  };

  const cancel = () => {
    seq.current++;
    setPhase({ kind: "idle" });
  };

  // The keys stay in the panel: no app shortcut or terminal sees them.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const onPromptKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  const command = phase.kind === "answer" ? (phase.reply.command ?? "") : "";

  return (
    <div className="overlay" onKeyDown={onKeyDown}>
      <div className="dialog assistant" role="dialog" aria-modal="true" aria-label="AI assistant">
        <h2>AI assistant</h2>
        {keyMissing && (
          <div className="assistant__notice" role="alert">
            <p>No API key is saved for {PROVIDER_NAMES[provider]}. Add one in Settings → AI.</p>
            <button type="button" className="btn" onClick={onOpenSettings}>
              Open AI settings
            </button>
          </div>
        )}
        <textarea
          className="assistant__prompt"
          aria-label="Your question"
          placeholder="Ask anything…"
          rows={3}
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onPromptKey}
        />
        <label className="check">
          <input
            type="checkbox"
            disabled={!selection}
            checked={includeSelection && selection !== ""}
            onChange={(e) => setIncludeSelection(e.target.checked)}
          />
          Include selected text
        </label>
        {includeSelection && selection && (
          <pre className="assistant__selection" aria-label="Selected text to send">
            {selection}
          </pre>
        )}
        {phase.kind === "error" && <p className="form-error">{phase.message}</p>}
        {phase.kind === "answer" && (
          <div className="assistant__answer">
            {phase.reply.answer && <AnswerText answer={phase.reply.answer} />}
            {command && (
              <pre className="assistant__command" aria-label="Suggested command">
                {command}
              </pre>
            )}
          </div>
        )}
        <div className="dialog__actions">
          {phase.kind === "loading" ? (
            <>
              <span className="muted assistant__loading">Asking…</span>
              <button type="button" className="btn" onClick={cancel}>
                Cancel
              </button>
            </>
          ) : (
            <>
              {command && (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      void writeText(command)
                        .then(() => setCopied(true))
                        .catch(() => setPhase({ kind: "error", message: "Could not copy to the clipboard." }))
                    }
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!canInsert}
                    title="Types the command into the terminal without running it"
                    onClick={() => onInsert(command)}
                  >
                    Insert
                  </button>
                </>
              )}
              <button
                type="button"
                className={`btn${command ? "" : " btn--primary"}`}
                disabled={!prompt.trim() || keyMissing}
                onClick={ask}
              >
                Ask
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
