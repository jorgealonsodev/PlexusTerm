import { createContext, useContext, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * In-app replacements for the browser's native confirm and prompt boxes, which the system webview
 * does not show reliably (WebKitGTK answers `confirm` without asking).
 */
export interface ConfirmOptions {
  /** Heading; without one the message names the dialog. */
  title?: string;
  /** Paragraphs are separated by blank lines. */
  message: string;
  confirmLabel: string;
  /** Destructive action: the dialog is an alert and Cancel has the focus. */
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  /** Label of the text field. */
  message: string;
  defaultValue?: string;
  confirmLabel: string;
}

export interface Dialogs {
  /** Resolves true when accepted, false when cancelled (Cancel or Escape). */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Resolves to the text as typed (untrimmed), or null when cancelled. */
  prompt: (options: PromptOptions) => Promise<string | null>;
}

type Request =
  | { id: number; kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

const DialogContext = createContext<Dialogs | null>(null);

let nextId = 0;

/** Shows the requested dialogs one at a time, in the order they were asked. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([]);
  const api = useMemo<Dialogs>(
    () => ({
      confirm: (options) =>
        new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: "confirm", options, resolve }])),
      prompt: (options) =>
        new Promise((resolve) => setQueue((q) => [...q, { id: ++nextId, kind: "prompt", options, resolve }])),
    }),
    [],
  );
  const current = queue[0];
  const finish = (settle: () => void) => {
    settle();
    setQueue((q) => q.slice(1));
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current?.kind === "confirm" && (
        <ConfirmDialog key={current.id} options={current.options} onAnswer={(ok) => finish(() => current.resolve(ok))} />
      )}
      {current?.kind === "prompt" && (
        <PromptDialog key={current.id} options={current.options} onAnswer={(v) => finish(() => current.resolve(v))} />
      )}
    </DialogContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error("useDialogs needs a DialogProvider");
  return dialogs;
}

const paragraphs = (message: string) => message.split(/\n\s*\n/).map((text, i) => <p key={i}>{text}</p>);

/** Escape cancels; the keys never reach the windows and panels behind the dialog. */
const keys = (onCancel: () => void, onEnter?: () => void) => (e: KeyboardEvent) => {
  e.stopPropagation();
  if (e.key === "Escape") {
    e.preventDefault();
    onCancel();
  } else if (e.key === "Enter" && onEnter && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    onEnter();
  }
};

function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const { title, message, confirmLabel, danger = false } = options;
  // Enter on a focused button presses that button, so Enter on a destructive one cancels.
  return (
    <div className="overlay overlay--dialogs" onKeyDown={keys(() => onAnswer(false))}>
      <div
        className="dialog"
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-label={title ?? message}
        aria-describedby="app-dialog-message"
      >
        {title && <h2>{title}</h2>}
        <div id="app-dialog-message" className="app-dialog__message">
          {paragraphs(message)}
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" autoFocus={danger} onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? "btn--danger" : "btn--primary"}`}
            autoFocus={!danger}
            onClick={() => onAnswer(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptDialog({ options, onAnswer }: { options: PromptOptions; onAnswer: (value: string | null) => void }) {
  const { title, message, defaultValue = "", confirmLabel } = options;
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="overlay overlay--dialogs" onKeyDown={keys(() => onAnswer(null), () => onAnswer(value))}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? message}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(value);
        }}
      >
        {title && <h2>{title}</h2>}
        <label className="field">
          {message}
          <input
            autoFocus
            spellCheck={false}
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => onAnswer(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
