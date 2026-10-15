import { useState, type FormEvent } from "react";
import type { SerialTarget } from "../sessions/types";
import { SerialFields } from "./SerialFields";
import { defaultSerialForm, parseSerialForm } from "./serialSettings";

interface SerialDialogProps {
  onConnect: (target: SerialTarget) => void;
  onCancel: () => void;
}

export function SerialDialog({ onConnect, onCancel }: SerialDialogProps) {
  const [form, setForm] = useState(defaultSerialForm);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseSerialForm(form);
    if (result.ok) onConnect({ type: "serial", ...result.settings });
    else setError(result.error);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="serial-title">
        <h2 id="serial-title">Serial session</h2>
        <SerialFields form={form} onChange={setForm} autoFocusPath />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
