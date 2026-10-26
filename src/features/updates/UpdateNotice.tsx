import { ArrowDownToLine, X } from "lucide-react";
import { UpdateActions } from "./UpdateActions";
import { useT } from "../../i18n/i18n";
import type { Release } from "./updates";

/** A newer release, as a floating card with matching installation and manual release-page actions. */
export function UpdateNotice({ release, onClose }: { release: Release; onClose: () => void }) {
  const t = useT();
  return (
    <div className="update-toast" role="status">
      <div className="update-toast__head">
        <span className="update-toast__icon" aria-hidden>
          <ArrowDownToLine size={16} />
        </span>
        <span className="update-toast__text">{t("app.update.available", { version: release.version })}</span>
        <button className="btn btn--icon" aria-label={t("app.update.close")} title={t("app.update.close")} onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <UpdateActions release={release} />
    </div>
  );
}
