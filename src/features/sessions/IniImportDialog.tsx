import type { SavedSession, SavedTelnetSession } from "./library";
import { skippedLabel, type ImportPlan } from "./iniImport";
import { useT } from "../../i18n/i18n";

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

interface IniImportDialogProps {
  result: ImportResult;
  onConfirm: (sessions: (SavedSession | SavedTelnetSession)[]) => void;
  onClose: () => void;
}

/** Preview of a sessions.ini import; nothing is saved until the user confirms. */
export function IniImportDialog({ result, onConfirm, onClose }: IniImportDialogProps) {
  const t = useT();
  const plan = result.ok ? result.plan : null;
  const count = plan?.toAdd.length ?? 0;
  const skipped = plan ? Object.entries(plan.skipped) : [];

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="mi-title">
        <h2 id="mi-title">{t("sessions.import.title")}</h2>
        {!result.ok && (
          <p className="form-error" role="alert">
            {t("sessions.import.readError", { error: result.error })}
          </p>
        )}
        {plan && (
          <>
            <p>{count ? t("sessions.import.toImport", { count }) : t("sessions.import.none")}</p>
            {plan.duplicates > 0 && (
              <p className="muted">{t("sessions.import.duplicates", { count: plan.duplicates })}</p>
            )}
            {skipped.length > 0 && (
              <>
                <p className="muted">{t("sessions.import.notImported")}</p>
                <ul className="import-skipped">
                  {skipped.map(([key, n]) => (
                    <li key={key}>{`${skippedLabel(key)}: ${n}`}</li>
                  ))}
                </ul>
              </>
            )}
            {count > 0 && (
              <p className="muted">
                {t("sessions.import.note")}
              </p>
            )}
          </>
        )}
        <div className="dialog__actions">
          {count > 0 ? (
            <>
              <button type="button" className="btn" onClick={onClose}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn--primary" autoFocus onClick={() => onConfirm(plan!.toAdd)}>
                {t("sessions.import.confirm", { count })}
              </button>
            </>
          ) : (
            <button type="button" className="btn" autoFocus onClick={onClose}>
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
