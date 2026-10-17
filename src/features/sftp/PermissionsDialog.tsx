import { useState, type FormEvent } from "react";
import "./sftp.css";
import type { AppKey } from "../../i18n/catalogs";
import { useT } from "../../i18n/i18n";
import { MAX_MODE, octalString, parseOctal } from "./permissions";
import { describeSftpError, type SftpEntry } from "./sftpClient";

const WHO: [AppKey, number][] = [
  ["sftp.permissions.owner", 6],
  ["sftp.permissions.group", 3],
  ["sftp.permissions.others", 0],
];
/** [name in the checkbox label, column header, bit]. */
const WHAT: [AppKey, AppKey, number][] = [
  ["sftp.permissions.read", "sftp.permissions.readHeader", 4],
  ["sftp.permissions.write", "sftp.permissions.writeHeader", 2],
  ["sftp.permissions.execute", "sftp.permissions.executeHeader", 1],
];

interface PermissionsDialogProps {
  entry: SftpEntry;
  /** Applies the new mode (chmod); a rejection is shown in the dialog. */
  onApply: (mode: number) => Promise<unknown>;
  /** Text for a rejected `onApply`; SFTP errors by default. */
  describeError?: (err: unknown) => string;
  onClose: () => void;
}

/** Read/write/execute checkboxes for owner, group and others, kept in sync with the octal value. */
export function PermissionsDialog({ entry, onApply, describeError = describeSftpError, onClose }: PermissionsDialogProps) {
  const t = useT();
  const [mode, setMode] = useState((entry.permissions ?? 0) & MAX_MODE);
  const [octal, setOctal] = useState(octalString(mode));
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const valid = parseOctal(octal) !== null;

  const toggle = (bit: number) => {
    // Setuid, setgid and sticky stay as they are.
    const next = mode ^ bit;
    setMode(next);
    setOctal(octalString(next));
    setError(null);
  };

  const changeOctal = (text: string) => {
    setOctal(text);
    const parsed = parseOctal(text);
    if (parsed !== null) setMode(parsed);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setApplying(true);
    try {
      await onApply(mode);
      onClose();
    } catch (err) {
      setError(describeError(err));
      setApplying(false);
    }
  };

  const message = !valid ? t("sftp.permissions.invalidOctal") : error;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog" role="dialog" aria-labelledby="sftp-permissions-title" onSubmit={submit} noValidate>
        <h2 id="sftp-permissions-title">{t("sftp.permissions.title", { name: entry.name })}</h2>
        <table className="sftp-permissions">
          <thead>
            <tr>
              <th />
              {WHAT.map(([what, header]) => (
                <th key={what}>{t(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WHO.map(([who, shift]) => (
              <tr key={who}>
                <th scope="row">{t(who)}</th>
                {WHAT.map(([what, , value]) => {
                  const bit = value << shift;
                  return (
                    <td key={what}>
                      <input
                        type="checkbox"
                        aria-label={t("sftp.permissions.checkbox", { who: t(who), what: t(what) })}
                        checked={(mode & bit) !== 0}
                        onChange={() => toggle(bit)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <label className="field">
          {t("sftp.permissions.octal")}
          <input spellCheck={false} inputMode="numeric" value={octal} onChange={(e) => changeOctal(e.target.value)} />
        </label>
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!valid || applying}>
            {t("common.apply")}
          </button>
        </div>
      </form>
    </div>
  );
}
