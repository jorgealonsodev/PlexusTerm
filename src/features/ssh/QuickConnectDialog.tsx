import { useState, type FormEvent } from "react";
import type { SshTarget } from "../sessions/types";
import { parseQuickConnect, type QuickConnectForm } from "./quickConnect";
import { fieldSetter, SshFields } from "./SshFields";

interface QuickConnectDialogProps {
  onConnect: (target: SshTarget) => void;
  onCancel: () => void;
}

const emptyForm: QuickConnectForm = {
  host: "",
  port: "",
  username: "",
  method: "password",
  password: "",
  keyPath: "~/.ssh/id_ed25519",
  passphrase: "",
};

export function QuickConnectDialog({ onConnect, onCancel }: QuickConnectDialogProps) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseQuickConnect(form);
    if (result.ok) onConnect(result.target);
    else setError(result.error);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="qc-title">
        <h2 id="qc-title">SSH session</h2>
        <SshFields form={form} set={fieldSetter(setForm)} withSecrets autoFocusHost />
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
