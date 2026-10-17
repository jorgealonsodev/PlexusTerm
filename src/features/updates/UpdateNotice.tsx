import { X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../../i18n/i18n";
import type { Release } from "./updates";

/** Bar telling that a newer release is published, with a link to its download page. */
export function UpdateNotice({ release, onClose }: { release: Release; onClose: () => void }) {
  const t = useT();
  return (
    <div className="notice notice--update" role="status">
      <span>{t("app.update.available", { version: release.version })}</span>
      <span className="notice__actions">
        <button className="btn" onClick={() => void openUrl(release.url).catch(() => {})}>
          {t("app.update.download")}
        </button>
        <button className="btn btn--icon" aria-label={t("app.update.close")} title={t("app.update.close")} onClick={onClose}>
          <X size={14} />
        </button>
      </span>
    </div>
  );
}
