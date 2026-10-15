import { useState, type FormEvent } from "react";
import { useSecretAvailable } from "./secrets";
import { useT } from "../../i18n/i18n";

interface PasswordPromptProps {
  label: string;
  /** Offers "Save password in the system keyring" (saved sessions only), ticked when `initial`. */
  remember?: { initial: boolean };
  /** `remember` is true only when the checkbox was offered, usable and ticked. */
  /** `remember` is undefined when the keyring state is not known yet (nothing should change). */
  onSubmit: (password: string, remember: boolean | undefined) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ label, remember, onSubmit, onCancel }: PasswordPromptProps) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(remember?.initial ?? false);
  const available = useSecretAvailable(remember !== undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Unknown keyring state (still loading) leaves any saved password as it is.
    if (remember === undefined) onSubmit(password, false);
    else onSubmit(password, available === null ? undefined : available === true && save);
  };
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="pw-title">
        <h2 id="pw-title">{t("sessions.password.title", { label })}</h2>
        <label className="field">
          {t("common.password")}
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {remember && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={save}
                disabled={available !== true}
                onChange={(e) => setSave(e.target.checked)}
              />
              {t("sessions.password.save")}
            </label>
            {available === false && (
              <p className="muted">{t("sessions.password.noKeyring")}</p>
            )}
          </>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary">
            {t("common.connect")}
          </button>
        </div>
      </form>
    </div>
  );
}
