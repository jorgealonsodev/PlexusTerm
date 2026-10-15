import { useState, type FormEvent } from "react";
import type { TelnetTarget } from "../sessions/types";
import { TelnetFields } from "./TelnetFields";
import { emptyTelnetForm, parseTelnetForm } from "./telnetForm";

interface TelnetDialogProps {
  onConnect: (target: TelnetTarget) => void;
  onCancel: () => void;
}

export function TelnetDialog({ onConnect, onCancel }: TelnetDialogProps) {
  const [form, setForm] = useState(emptyTelnetForm);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseTelnetForm(form);
    if (result.ok) onConnect({ type: "telnet", host: result.host, port: result.port });
    else setError(result.error);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="telnet-title">
        <h2 id="telnet-title">Telnet session</h2>
        <TelnetFields form={form} onChange={setForm} autoFocusHost />
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
