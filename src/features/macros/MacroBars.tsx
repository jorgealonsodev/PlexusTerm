import { useState, type FormEvent } from "react";

/** Always visible while recording (S16.2): what is typed ends up in a plain-text file (S16.5). */
export function RecordingIndicator({ onStop }: { onStop: () => void }) {
  return (
    <div className="recording-banner" role="status">
      <span className="recording-banner__dot" aria-hidden="true" />
      <span>
        <strong>Recording macro</strong> — Everything you type is saved, including passwords
      </span>
      <button className="btn" onClick={onStop}>
        Stop recording
      </button>
    </div>
  );
}

interface NameMacroDialogProps {
  stepCount: number;
  onSave: (name: string) => void;
  onDiscard: () => void;
}

/** Asked when a recording stops: keep it under a name, or throw it away. */
export function NameMacroDialog({ stepCount, onSave, onDiscard }: NameMacroDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
    else setError("Enter a name.");
  };
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onDiscard()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="nm-title">
        <h2 id="nm-title">Save recorded macro</h2>
        <p className="muted">
          {stepCount} {stepCount === 1 ? "step" : "steps"} recorded. Macros are saved as plain text.
        </p>
        <label className="field">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onDiscard}>
            Discard
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

interface MacroProgressProps {
  name: string;
  /** Index of the running step, from 0. */
  step: number;
  total: number;
  onStop: () => void;
}

/** Shown while a macro plays (S16.3); Escape stops it too. */
export function MacroProgress({ name, step, total, onStop }: MacroProgressProps) {
  return (
    <div className="macro-progress">
      <span>
        Running "{name}": step {step + 1} of {total}
      </span>
      <progress value={step + 1} max={total} aria-label={`Macro ${name} progress`} />
      <button className="btn" title="Escape" onClick={onStop}>
        Stop
      </button>
    </div>
  );
}
