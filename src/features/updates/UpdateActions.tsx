import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../../i18n/i18n";
import { updateError, useUpdateInstallation } from "./UpdateInstallation";
import type { Release } from "./updates";

/** The same two independent actions in the startup notice and Settings → About. */
export function UpdateActions({ release }: { release?: Release }) {
  const t = useT();
  const { installation, start } = useUpdateInstallation();
  const [pageError, setPageError] = useState<string | null>(null);
  const target = release ?? (installation.state === "idle" ? undefined : installation.release);
  if (!target) return null;
  const busy = installation.state === "busy";
  const progress = busy ? installation.progress : null;
  const visitPage = async () => {
    setPageError(null);
    try {
      await openUrl(target.url);
    } catch (error) {
      setPageError(updateError(error));
    }
  };
  return (
    <span className="notice__actions">
      <button type="button" className="btn" disabled={busy || installation.state === "done"} onClick={() => void start(target)}>
        {t(installation.state === "failed" ? "app.update.retry" : "app.update.download")}
      </button>
      <button type="button" className="btn" onClick={() => void visitPage()}>
        {t("app.update.visitPage")}
      </button>
      {progress && (
        <span role="status">
          {t(`app.update.${progress.phase}`)}
          {progress.phase === "downloading" && progress.downloaded !== undefined && (
            <> {progress.total === undefined
              ? t("app.update.bytes", { downloaded: progress.downloaded })
              : t("app.update.bytesTotal", { downloaded: progress.downloaded, total: progress.total })}</>
          )}
        </span>
      )}
      {installation.state === "done" && <span role="status">{t(`app.update.${installation.result}`)}</span>}
      {installation.state === "failed" && <span role="alert">{t("app.update.installFailed", { error: installation.error })}</span>}
      {pageError !== null && <span role="alert">{t("app.update.pageFailed", { error: pageError })}</span>}
    </span>
  );
}
