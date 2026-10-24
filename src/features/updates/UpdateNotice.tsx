import { X } from "lucide-react";
import { UpdateActions } from "./UpdateActions";
import { useT } from "../../i18n/i18n";
import type { Release } from "./updates";

/** A newer release, with matching installation and manual release-page actions. */
export function UpdateNotice({ release, onClose }: { release: Release; onClose: () => void }) {
  const t = useT();
  return (
    <div className="notice notice--update" role="status">
      <span>{t("app.update.available", { version: release.version })}</span>
      <span className="notice__actions">
        <UpdateActions release={release} />
        <button className="btn btn--icon" aria-label={t("app.update.close")} title={t("app.update.close")} onClick={onClose}>
          <X size={14} />
        </button>
      </span>
    </div>
  );
}
