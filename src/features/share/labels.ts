import { getLocale, t } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import type { Access, EndKind, ShareViewer } from "./shareApi";
import type { ShareNotice } from "./useShares";

/** A time of today or another day in the interface language and the local time zone. */
export const shareTime = (ms: number) =>
  new Date(ms).toLocaleString(getLocale(), { dateStyle: "short", timeStyle: "short" });

export const accessName = (access: Access) => t(access === "type" ? "share.viewer.canType" : "share.viewer.viewOnly");

/** "Viewer 2 — Chrome on Android, unverified" */
export function viewerLabel(viewer: ShareViewer): string {
  const browser =
    viewer.browser && viewer.os
      ? t("share.viewer.browserOn", { browser: viewer.browser, os: viewer.os })
      : (viewer.browser ?? viewer.os ?? t("share.viewer.unknownBrowser"));
  return t("share.viewer.label", { number: viewer.number, browser });
}

const REFUSED: Record<string, AppKey> = {
  unauthorized: "share.refused.unauthorized",
  bad_request: "share.refused.bad_request",
  too_many_shares: "share.refused.too_many_shares",
  version: "share.refused.version",
  rate_limited: "share.refused.rate_limited",
};

export function endMessage(tab: string, end: EndKind, code: string | null): string {
  if (end === "refused") {
    const known = code ? REFUSED[code] : undefined;
    const reason = known ? t(known) : t("share.refused.unknown", { code: code ?? "?" });
    return t("share.ended.refused", { tab, reason });
  }
  return t(`share.ended.${end}`, { tab });
}

/** The sentence a notice shows (its system notification has the same text). */
export function noticeText(notice: ShareNotice): string {
  switch (notice.kind) {
    case "ended":
      return endMessage(notice.tab, notice.end, notice.code);
    case "joinRequest":
      return t("share.join.request", {
        label: viewerLabel(notice.viewer),
        access: accessName(notice.viewer.access),
        ip: notice.viewer.ip,
      });
    case "joined":
      return t("share.join.joined", {
        label: viewerLabel(notice.viewer),
        access: accessName(notice.viewer.access),
        ip: notice.viewer.ip,
      });
    case "password":
      return t("share.password", { tab: notice.tab });
    case "sudoSkipped":
      return t("share.sudoSkipped", { tab: notice.tab });
    case "crashed":
      return t("share.crashed", { tab: notice.tab, time: shareTime(notice.at) });
    case "failed":
      return t("share.failed", { tab: notice.tab, error: notice.error });
  }
}
