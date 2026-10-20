import { useT } from "../../i18n/i18n";
import { accessName, viewerLabel } from "./labels";
import type { ShareCommand } from "./shareApi";
import type { Share } from "./useShares";

interface ShareToastsProps {
  share: Share;
  onCommand: (command: ShareCommand) => void;
  onDismissWarning: () => void;
}

/** The in-tab toasts of a shared pane: join requests, the password wait and the 10-minute warning. */
export function ShareToasts({ share, onCommand, onDismissWarning }: ShareToastsProps) {
  const t = useT();
  if (share.pending.length === 0 && !share.passwordWait && !share.expiring) return null;
  return (
    <div className="share-toasts" role="region" aria-live="polite">
      {share.pending.map((viewer) => (
        <div key={viewer.viewer} className={`share-toast${viewer.access === "type" ? " share-toast--type" : ""}`}>
          <span>
            {t("share.join.request", { label: viewerLabel(viewer), access: accessName(viewer.access), ip: viewer.ip })}
          </span>
          <div className="share-toast__actions">
            <button type="button" className="btn" onClick={() => onCommand({ cmd: "deny", viewer: viewer.viewer })}>
              {t("share.join.deny")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onCommand({ cmd: "allow", viewer: viewer.viewer })}
            >
              {t("share.join.allow")}
            </button>
          </div>
        </div>
      ))}
      {share.passwordWait && (
        <div className="share-toast" role="status">
          <span>{t("share.passwordWait")}</span>
        </div>
      )}
      {share.expiring && (
        <div className="share-toast" role="alert">
          <span>{t("share.expiring", { tab: share.tab })}</span>
          <div className="share-toast__actions">
            <button type="button" className="btn" onClick={onDismissWarning}>
              {t("share.dismiss")}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => onCommand({ cmd: "expiry", expiry: "oneHour" })}>
              {t("share.extendHour")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
