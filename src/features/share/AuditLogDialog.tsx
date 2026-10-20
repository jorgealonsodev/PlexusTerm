import { useEffect, useState } from "react";
import { useT } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import { shareTime } from "./labels";
import { shareAuditLog } from "./shareApi";

type Entry = Record<string, unknown>;

const EVENTS = new Set([
  "start",
  "end",
  "joinRequest",
  "approved",
  "denied",
  "disconnected",
  "left",
  "input",
  "dropped",
  "linkRotated",
  "viewOnly",
  "inputPaused",
  "expiry",
]);

/** The fields of an entry other than its time, tab and event, as `name: value`. */
function details(entry: Entry, bytes: (count: number) => string): string {
  return Object.entries(entry)
    .filter(([name]) => !["at", "tab", "event"].includes(name))
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => {
      if (name === "bytes" && typeof value === "number") return bytes(value);
      if (name === "expiresAt" || name === "startedAt") return `${name}: ${shareTime(Number(value) * 1000)}`;
      return `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`;
    })
    .join(" · ");
}

/** The local audit log of shares (PRD-share §6.2), newest first. */
export function AuditLogDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void shareAuditLog()
      .then((list) => setEntries([...list].reverse()))
      .catch((err) => setError(String(err)));
  }, []);

  const eventName = (event: unknown) =>
    typeof event === "string" && EVENTS.has(event) ? t(`share.audit.events.${event}` as AppKey) : String(event);

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog share-audit" role="dialog" aria-labelledby="share-audit-title">
        <h2 id="share-audit-title">{t("share.audit.title")}</h2>
        <p className="muted">{t("share.audit.note")}</p>
        {error && <p className="form-error">{error}</p>}
        {entries && entries.length === 0 && <p>{t("share.audit.empty")}</p>}
        {entries && entries.length > 0 && (
          <div className="share-audit__table">
            <table>
              <thead>
                <tr>
                  <th>{t("share.audit.time")}</th>
                  <th>{t("share.audit.tab")}</th>
                  <th>{t("share.audit.event")}</th>
                  <th>{t("share.audit.details")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={i}>
                    <td>{shareTime(Number(entry.at) * 1000)}</td>
                    <td>{String(entry.tab ?? "")}</td>
                    <td>{eventName(entry.event)}</td>
                    <td>{details(entry, (count) => t("share.audit.bytes", { count }))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--primary" autoFocus onClick={onClose}>
            {t("share.dialog.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
