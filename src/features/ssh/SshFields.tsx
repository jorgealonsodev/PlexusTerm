import type { QuickConnectForm } from "./quickConnect";

type Setter = (field: keyof QuickConnectForm) => (e: { target: { value: string } }) => void;

interface SshFieldsProps {
  form: QuickConnectForm;
  set: Setter;
  /** Show password/passphrase inputs (quick connect); saved sessions never store them. */
  withSecrets: boolean;
  autoFocusHost?: boolean;
}

export function SshFields({ form, set, withSecrets, autoFocusHost }: SshFieldsProps) {
  return (
    <>
      <div className="form-row">
        <label className="field field--grow">
          Remote host
          <input
            autoFocus={autoFocusHost}
            value={form.host}
            onChange={set("host")}
            placeholder="host or user@host:port"
          />
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
      {withSecrets && form.method === "password" && (
        <label className="field">
          Password
          <input
            type="password"
            value={form.password}
            onChange={set("password")}
            autoComplete="current-password"
          />
        </label>
      )}
      {form.method === "key" && (
        <label className="field">
          Private key
          <input value={form.keyPath} onChange={set("keyPath")} />
        </label>
      )}
      {withSecrets && form.method === "key" && (
        <label className="field">
          Passphrase (optional)
          <input type="password" value={form.passphrase} onChange={set("passphrase")} />
        </label>
      )}
    </>
  );
}

export function fieldSetter<T>(setForm: (update: (f: T) => T) => void) {
  return (field: keyof T) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
}
