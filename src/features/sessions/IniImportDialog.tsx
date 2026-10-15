import type { SavedSession, SavedTelnetSession } from "./library";
import { skippedLabel, type ImportPlan } from "./iniImport";

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

interface IniImportDialogProps {
  result: ImportResult;
  onConfirm: (sessions: (SavedSession | SavedTelnetSession)[]) => void;
  onClose: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Preview of a sessions.ini import; nothing is saved until the user confirms. */
export function IniImportDialog({ result, onConfirm, onClose }: IniImportDialogProps) {
  const plan = result.ok ? result.plan : null;
  const count = plan?.toAdd.length ?? 0;
  const skipped = plan ? Object.entries(plan.skipped) : [];

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="mi-title">
        <h2 id="mi-title">Import from another app</h2>
        {!result.ok && (
          <p className="form-error" role="alert">
            Could not read the file: {result.error}
          </p>
        )}
        {plan && (
          <>
            <p>{count ? `${plural(count, "session")} to import.` : "No sessions to import."}</p>
            {plan.duplicates > 0 && (
              <p className="muted">{plural(plan.duplicates, "duplicate")} already saved will be skipped.</p>
            )}
            {skipped.length > 0 && (
              <>
                <p className="muted">Not imported:</p>
                <ul className="import-skipped">
                  {skipped.map(([key, n]) => (
                    <li key={key}>{`${skippedLabel(key)}: ${n}`}</li>
                  ))}
                </ul>
              </>
            )}
            {count > 0 && (
              <p className="muted">
                Passwords are not imported; they are asked each time you connect. Sessions go under the
                "Imported" folder.
              </p>
            )}
          </>
        )}
        <div className="dialog__actions">
          {count > 0 ? (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" autoFocus onClick={() => onConfirm(plan!.toAdd)}>
                {`Import ${plural(count, "session")}`}
              </button>
            </>
          ) : (
            <button type="button" className="btn" autoFocus onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
