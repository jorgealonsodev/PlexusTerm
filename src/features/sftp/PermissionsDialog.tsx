import { useState, type FormEvent } from "react";
import "./sftp.css";
import { MAX_MODE, octalString, parseOctal } from "./permissions";
import { describeSftpError, type SftpEntry } from "./sftpClient";

const WHO: [string, number][] = [
  ["Owner", 6],
  ["Group", 3],
  ["Others", 0],
];
const WHAT: [string, number][] = [
  ["read", 4],
  ["write", 2],
  ["execute", 1],
];

interface PermissionsDialogProps {
  entry: SftpEntry;
  /** Applies the new mode (chmod); a rejection is shown in the dialog. */
  onApply: (mode: number) => Promise<unknown>;
  onClose: () => void;
}

/** Read/write/execute checkboxes for owner, group and others, kept in sync with the octal value. */
export function PermissionsDialog({ entry, onApply, onClose }: PermissionsDialogProps) {
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
      setError(describeSftpError(err));
      setApplying(false);
    }
  };

  const message = !valid ? "Enter one to four octal digits (0-7)." : error;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog" role="dialog" aria-labelledby="sftp-permissions-title" onSubmit={submit} noValidate>
        <h2 id="sftp-permissions-title">Permissions of {entry.name}</h2>
        <table className="sftp-permissions">
          <thead>
            <tr>
              <th />
              {WHAT.map(([what]) => (
                <th key={what}>{what[0].toUpperCase() + what.slice(1)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WHO.map(([who, shift]) => (
              <tr key={who}>
                <th scope="row">{who}</th>
                {WHAT.map(([what, value]) => {
                  const bit = value << shift;
                  return (
                    <td key={what}>
                      <input
                        type="checkbox"
                        aria-label={`${who} ${what}`}
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
          Octal
          <input spellCheck={false} inputMode="numeric" value={octal} onChange={(e) => changeOctal(e.target.value)} />
        </label>
        {message && (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!valid || applying}>
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
