import { DEFAULT_TMUX_SESSION, type QuickConnectForm } from "./quickConnect";
import { HelpTip } from "../sidebar/HelpTip";
import { useT } from "../../i18n/i18n";

type Setter = (field: keyof QuickConnectForm) => (e: { target: { value: string } }) => void;
type Flag = "forwardAgent" | "tmux";
type CheckSetter = (field: Flag) => (e: { target: { checked: boolean } }) => void;

interface SshFieldsProps {
  form: QuickConnectForm;
  set: Setter;
  check: CheckSetter;
  /** Show password/passphrase inputs (quick connect); saved sessions never store them. */
  withSecrets: boolean;
  autoFocusHost?: boolean;
}

export function SshFields({ form, set, check, withSecrets, autoFocusHost }: SshFieldsProps) {
  const t = useT();
  return (
    <>
      <div className="form-row">
        <label className="field field--grow">
          {t("sessions.ssh.remoteHost")}
          <input
            autoFocus={autoFocusHost}
            value={form.host}
            onChange={set("host")}
            placeholder={t("sessions.ssh.hostPlaceholder")}
          />
        </label>
        <label className="field field--port">
          {t("common.port")}
          <input value={form.port} onChange={set("port")} placeholder="22" inputMode="numeric" />
        </label>
      </div>
      <label className="field">
        {t("common.username")}
        <input value={form.username} onChange={set("username")} autoComplete="username" />
      </label>
      <label className="field">
        {t("sessions.ssh.authentication")}
        <select value={form.method} onChange={set("method")}>
          <option value="password">{t("common.password")}</option>
          <option value="key">{t("sessions.ssh.privateKey")}</option>
          <option value="agent">{t("sessions.ssh.agent")}</option>
        </select>
      </label>
      {withSecrets && form.method === "password" && (
        <label className="field">
          {t("common.password")}
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
          {t("sessions.ssh.privateKey")}
          <input value={form.keyPath} onChange={set("keyPath")} />
        </label>
      )}
      {withSecrets && form.method === "key" && (
        <label className="field">
          {t("sessions.ssh.passphrase")}
          <input type="password" value={form.passphrase} onChange={set("passphrase")} />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={form.forwardAgent} onChange={check("forwardAgent")} />
        <span className="setting-title">
          {t("sessions.ssh.forwardAgent")} <HelpTip text={t("sessions.ssh.forwardAgentHelp")} />
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={form.tmux} onChange={check("tmux")} />
        <span className="setting-title">
          {t("sessions.ssh.tmux")} <HelpTip text={t("sessions.ssh.tmuxHelp")} />
        </span>
      </label>
      {form.tmux && (
        <label className="field">
          {t("sessions.ssh.tmuxSession")}
          <input value={form.tmuxSession} onChange={set("tmuxSession")} placeholder={DEFAULT_TMUX_SESSION} />
        </label>
      )}
    </>
  );
}

/** Sets a checkbox field of the form. */
export function checkSetter<T>(setForm: (update: (f: T) => T) => void) {
  return (field: keyof T) => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [field]: e.target.checked }));
}

export function fieldSetter<T>(setForm: (update: (f: T) => T) => void) {
  return (field: keyof T) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
}
