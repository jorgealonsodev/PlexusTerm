import { useState, type FormEvent } from "react";
import type { SshTarget } from "../sessions/types";
import { parseQuickConnect, type QuickConnectForm } from "./quickConnect";

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
  const set = (field: keyof QuickConnectForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

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
        <div className="form-row">
          <label className="field field--grow">
            Remote host
            <input autoFocus value={form.host} onChange={set("host")} placeholder="host or user@host:port" />
          </label>
          <label className="field field--port">
            Port
            <input value={form.port} onChange={set("port")} placeholder="22" inputMode="numeric" />
          </label>
        </div>
        <label className="field">
          Username
          <input value={form.username} onChange={set("username")} autoComplete="username" />
        </label>
        <label className="field">
          Authentication
          <select value={form.method} onChange={set("method")}>
            <option value="password">Password</option>
            <option value="key">Private key</option>
            <option value="agent">SSH agent</option>
          </select>
        </label>
        {form.method === "password" && (
          <label className="field">
            Password
            <input type="password" value={form.password} onChange={set("password")} autoComplete="current-password" />
          </label>
        )}
        {form.method === "key" && (
          <>
            <label className="field">
              Private key
              <input value={form.keyPath} onChange={set("keyPath")} />
            </label>
            <label className="field">
              Passphrase (optional)
              <input type="password" value={form.passphrase} onChange={set("passphrase")} />
            </label>
          </>
        )}
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
