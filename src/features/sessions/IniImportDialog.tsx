import { isSshSession, type LibrarySession } from "./library";
import { skippedLabel, type ImportPlan } from "./iniImport";
import { passwordCommandsOf } from "./passwordCommand";
import { useT } from "../../i18n/i18n";

export type ImportResult = { ok: true; plan: ImportPlan } | { ok: false; error: string };

interface IniImportDialogProps {
  result: ImportResult;
  onConfirm: (sessions: LibrarySession[]) => void;
  onClose: () => void;
}

/**
 * Preview of an import (.ini, ~/.ssh/config or an exported sessions file); nothing is saved until
 * the user confirms. Proxy commands are listed in full: they run on this computer when the session
 * is opened, and a file may come from someone else.
 */
export function IniImportDialog({ result, onConfirm, onClose }: IniImportDialogProps) {
  const t = useT();
  const plan = result.ok ? result.plan : null;
  const count = plan?.toAdd.length ?? 0;
  const skipped = plan ? Object.entries(plan.skipped) : [];
  const proxied = (plan?.toAdd ?? []).filter(isSshSession).filter((s) => s.proxyCommand);
  // A file from someone else must not hide a command that would run on this computer.
  const commands = plan ? passwordCommandsOf(plan.toAdd) : [];

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
            {proxied.length > 0 && (
              <>
                <p className="form-error">{t("sessions.import.proxyCommands")}</p>
                <ul className="import-skipped">
                  {proxied.map((s) => (
                    <li key={s.id} data-testid="import-proxy-command">
                      {s.name}: <code dir="ltr">{s.proxyCommand}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {commands.length > 0 && (
              <>
                <p>{t("sessions.passwordCommand.importCommands")}</p>
                <ul className="import-skipped">
                  {commands.map(({ name, command }, index) => (
                    <li key={index}>
                      {`${name}: `}
                      <code dir="ltr">{command}</code>
                    </li>
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
