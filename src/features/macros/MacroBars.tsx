import { useState, type FormEvent } from "react";
import { useT } from "../../i18n/i18n";

/** Always visible while recording (S16.2): what is typed ends up in a plain-text file (S16.5). */
export function RecordingIndicator({ onStop }: { onStop: () => void }) {
  const t = useT();
  return (
    <div className="recording-banner" role="status">
      <span className="recording-banner__dot" aria-hidden="true" />
      <span>
        <strong>{t("macros.recording.title")}</strong> — {t("macros.recording.warning")}
      </span>
      <button className="btn" onClick={onStop}>
        {t("macros.recording.stop")}
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
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
    else setError(t("macros.form.nameRequired"));
  };
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onDiscard()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="nm-title">
        <h2 id="nm-title">{t("macros.name.title")}</h2>
        <p className="muted">{t("macros.name.recorded", { count: stepCount })}</p>
        <label className="field">
          {t("common.name")}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onDiscard}>
            {t("macros.name.discard")}
          </button>
          <button type="submit" className="btn btn--primary">
            {t("common.save")}
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
  const t = useT();
  return (
    <div className="macro-progress">
      <span>{t("macros.progress.running", { name, step: step + 1, total })}</span>
      <progress value={step + 1} max={total} aria-label={t("macros.progress.label", { name })} />
      <button className="btn" title="Escape" onClick={onStop}>
        {t("common.stop")}
      </button>
    </div>
  );
}
