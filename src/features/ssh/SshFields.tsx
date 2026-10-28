import { DEFAULT_TMUX_SESSION, MAX_PROXY_COMMAND, type QuickConnectForm } from "./quickConnect";
import { HelpTip } from "../sidebar/HelpTip";
import { useT } from "../../i18n/i18n";
import { MAX_COMMAND_LENGTH, PASSWORD_COMMAND_PRESETS } from "../sessions/passwordCommand";

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
          <option value="passwordCommand">{t("sessions.passwordCommand.method")}</option>
        </select>
      </label>
      {form.method === "passwordCommand" && (
        <CommandField
          label={t("sessions.passwordCommand.command")}
          help={t("sessions.passwordCommand.help")}
          value={form.passwordCommand ?? ""}
          onChange={set("passwordCommand")}
        />
      )}
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
      {form.method === "key" && (
        <CommandField
          label={t("sessions.passwordCommand.passphraseCommand")}
          help={t("sessions.passwordCommand.passphraseHelp")}
          value={form.passphraseCommand ?? ""}
          onChange={set("passphraseCommand")}
        />
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
      <label className="field">
        <span className="setting-title">
          {t("sessions.ssh.proxyCommand")} <HelpTip text={t("sessions.ssh.proxyCommandHelp")} />
        </span>
        <input
          value={form.proxyCommand}
          onChange={set("proxyCommand")}
          placeholder={t("sessions.ssh.proxyCommandPlaceholder")}
          maxLength={MAX_PROXY_COMMAND}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
    </>
  );
}

interface CommandFieldProps {
  label: string;
  help: string;
  value: string;
  onChange: (e: { target: { value: string } }) => void;
}

/**
 * A password manager's command line (not a secret: it is saved with the session), with a menu of
 * presets that fills it with a template to complete.
 */
function CommandField({ label, help, value, onChange }: CommandFieldProps) {
  const t = useT();
  return (
    <div className="form-row">
      <label className="field field--grow">
        <span className="setting-title">
          {label} <HelpTip text={help} />
        </span>
        <input
          value={value}
          onChange={onChange}
          maxLength={MAX_COMMAND_LENGTH}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          placeholder={PASSWORD_COMMAND_PRESETS[0].command}
        />
      </label>
      <label className="field">
        {t("sessions.passwordCommand.presets")}
        <select
          value=""
          onChange={(e) => {
            const preset = PASSWORD_COMMAND_PRESETS[Number(e.target.value)];
            if (preset) onChange({ target: { value: preset.command } });
          }}
        >
          <option value="" disabled>
            …
          </option>
          {PASSWORD_COMMAND_PRESETS.map((preset, index) => (
            <option key={preset.label} value={index}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
    </div>
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
