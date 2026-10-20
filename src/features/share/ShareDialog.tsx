import { useEffect, useState } from "react";
import { Eye, Keyboard } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { writeText } from "../terminal/clipboard";
import { accessName, shareTime, viewerLabel } from "./labels";
import { viewerBuildHash, type Access, type Expiry, type HistoryChoice, type LinkInfo, type ShareCommand } from "./shareApi";
import type { Share, ShareOptions } from "./useShares";

interface ShareDialogProps {
  tab: string;
  /** The tab's live share, or undefined to choose the options and start one. */
  share?: Share;
  /** Relay URL, viewer origin and token are set. */
  configured: boolean;
  viewerOrigin: string;
  /** macOS and Windows sleep on lid close whatever an application asks. */
  lidSleeps: boolean;
  onStart: (options: ShareOptions) => Promise<void>;
  onCommand: (command: ShareCommand) => void;
  onOpenSettings: () => void;
  onAuditLog: () => void;
  onClose: () => void;
}

const EXPIRIES: Expiry[] = ["whenStopped", "oneHour", "twelveHours"];
const HISTORIES: HistoryChoice[] = ["screen", 1000, 5000];
const historyKey = (h: HistoryChoice) =>
  h === "screen" ? ("share.dialog.screen" as const) : h === 1000 ? ("share.dialog.lines1000" as const) : ("share.dialog.lines5000" as const);
const expiryKey = (e: Expiry) => `share.dialog.${e}` as const;

/** The access with its icon and text, never colour alone (Can type is red). */
function AccessName({ access }: { access: Access }) {
  const t = useT();
  const Icon = access === "type" ? Keyboard : Eye;
  return (
    <span className={`share-access${access === "type" ? " share-access--type" : ""}`}>
      <Icon size={14} aria-hidden="true" />
      {t(access === "type" ? "share.dialog.canType" : "share.dialog.viewOnly")}
    </span>
  );
}

function LinkRow({ link }: { link: LinkInfo }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = () =>
    void writeText(link.url)
      .then(() => {
        setCopied(true);
        setFailed(false);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setFailed(true));
  return (
    <div className="share-link">
      <div className="share-link__text">
        <span className="share-link__label">
          <AccessName access={link.access} />
        </span>
        <input readOnly value={link.url} aria-label={t("share.dialog.link", { access: accessName(link.access) })} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn--primary" onClick={copy}>
          {copied ? t("share.dialog.copied") : t("share.dialog.copy")}
        </button>
        {failed && <span className="form-error">{t("share.dialog.copyFailed")}</span>}
      </div>
      <img
        className="share-link__qr"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(link.qr)}`}
        alt={t("share.dialog.qr", { access: accessName(link.access) })}
        width={140}
        height={140}
      />
    </div>
  );
}

/**
 * The Share dialog (PRD-share §4.1.1, §4.1.5): the options and Share, then, while sharing, the links
 * with their QR codes, who is connected, and the changes a share takes.
 */
export function ShareDialog(props: ShareDialogProps) {
  const t = useT();
  const { share } = props;
  const [view, setView] = useState(true);
  const [type, setType] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("whenStopped");
  const [history, setHistory] = useState<HistoryChoice>(1000);
  const [busy, setBusy] = useState(false);
  const [build, setBuild] = useState<string | null>(null);

  useEffect(() => {
    if (!props.viewerOrigin) return;
    let current = true;
    void viewerBuildHash(props.viewerOrigin)
      .then((hash) => current && setBuild(hash))
      .catch(() => current && setBuild(null));
    return () => {
      current = false;
    };
  }, [props.viewerOrigin]);

  const accesses: Access[] = [...(view ? (["view"] as const) : []), ...(type ? (["type"] as const) : [])];
  const start = () => {
    setBusy(true);
    props
      .onStart({ accesses, expiry, history })
      .catch(() => {})
      .finally(() => setBusy(false));
  };
  const typing = share ? share.links.some((l) => l.access === "type") : type;
  const typingViewer = share?.viewers.some((v) => v.access === "type") ?? false;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div className="dialog share-dialog" role="dialog" aria-labelledby="share-title">
        <h2 id="share-title">{t("share.dialog.title", { tab: props.tab })}</h2>
        {!share && !props.configured && (
          <>
            <p>{t("share.dialog.notConfigured")}</p>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={props.onClose}>
                {t("share.dialog.close")}
              </button>
              <button type="button" className="btn btn--primary" autoFocus onClick={props.onOpenSettings}>
                {t("share.dialog.openSettings")}
              </button>
            </div>
          </>
        )}
        {!share && props.configured && (
          <>
            <fieldset className="share-dialog__group">
              <legend>{t("share.dialog.access")}</legend>
              <label className="check">
                <input type="checkbox" checked={view} onChange={(e) => setView(e.target.checked)} />
                <AccessName access="view" />
              </label>
              <label className="check">
                <input type="checkbox" checked={type} onChange={(e) => setType(e.target.checked)} />
                <AccessName access="type" />
              </label>
              {type && <p className="share-warning">{t("share.dialog.canTypeWarning")}</p>}
            </fieldset>
            <label className="field">
              {t("share.dialog.expiry")}
              <select value={expiry} onChange={(e) => setExpiry(e.target.value as Expiry)}>
                {EXPIRIES.map((e) => (
                  <option key={e} value={e}>
                    {t(expiryKey(e))}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{t("share.dialog.maxNote")}</p>
            <label className="field">
              {t("share.dialog.history")}
              <select
                value={String(history)}
                onChange={(e) => setHistory(e.target.value === "screen" ? "screen" : (Number(e.target.value) as 1000 | 5000))}
              >
                {HISTORIES.map((h) => (
                  <option key={h} value={String(h)}>
                    {t(historyKey(h))}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">{t("share.dialog.historyNote")}</p>
          </>
        )}
        {share && (
          <>
            {share.phase === "starting" && <p role="status">{t("share.dialog.starting")}</p>}
            {share.phase === "unreachable" && (
              <p role="status" className="form-error">
                {t("share.dialog.unreachable")}
              </p>
            )}
            {share.links.map((link) => (
              <LinkRow key={link.access + link.url} link={link} />
            ))}
            {share.expiresAt !== null && (
              <div className="form-row">
                <span>{t("share.dialog.endsAt", { time: shareTime(share.expiresAt) })}</span>
                <label className="field">
                  <select
                    aria-label={t("share.dialog.extend")}
                    value=""
                    onChange={(e) => e.target.value && props.onCommand({ cmd: "expiry", expiry: e.target.value as Expiry })}
                  >
                    <option value="">{t("share.dialog.extend")}</option>
                    {EXPIRIES.map((e) => (
                      <option key={e} value={e}>
                        {t(expiryKey(e))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <h3>{t("share.dialog.connected")}</h3>
            {share.viewers.length === 0 && share.pending.length === 0 && <p className="muted">{t("share.dialog.nobody")}</p>}
            <ul className="share-viewers">
              {share.viewers.map((viewer) => (
                <li key={viewer.viewer}>
                  <span>
                    {viewerLabel(viewer)} · <AccessName access={viewer.access} /> · {viewer.ip} ·{" "}
                    {t("share.dialog.since", { time: shareTime(viewer.since) })}
                  </span>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => props.onCommand({ cmd: "disconnect", viewer: viewer.viewer })}
                  >
                    {t("share.dialog.disconnect")}
                  </button>
                </li>
              ))}
              {share.pending.map((viewer) => (
                <li key={viewer.viewer}>
                  <span>
                    {viewerLabel(viewer)} · <AccessName access={viewer.access} /> · {viewer.ip} · {t("share.dialog.waiting")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="form-row">
              {typing && (
                <button type="button" className="btn" onClick={() => props.onCommand({ cmd: "viewOnly" })}>
                  {t("share.dialog.viewOnlyAction")}
                </button>
              )}
              <button type="button" className="btn" onClick={() => props.onCommand({ cmd: "pause", on: !share.paused })}>
                {share.paused ? t("share.dialog.resume") : t("share.dialog.pause")}
              </button>
              <button type="button" className="btn" onClick={props.onAuditLog}>
                {t("share.dialog.auditLog")}
              </button>
            </div>
            {share.paused && <p className="muted">{t("share.dialog.paused")}</p>}
            {typing && <p className="muted">{t("share.dialog.viewOnlyNote")}</p>}
          </>
        )}
        {(share || props.configured) && (
          <>
            <p className="muted">{t("share.dialog.browserNote")}</p>
            {typingViewer && <p className="share-warning">{t("share.dialog.privilegesNote")}</p>}
            {props.lidSleeps && <p className="muted">{t("share.dialog.lidNote")}</p>}
            <p className="muted share-dialog__build">
              {build ? t("share.dialog.build", { hash: build }) : t("share.dialog.buildUnknown")}
            </p>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={props.onClose}>
                {t("share.dialog.close")}
              </button>
              {share ? (
                <button type="button" className="btn btn--danger" onClick={() => props.onCommand({ cmd: "stop" })}>
                  {t("share.dialog.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary"
                  autoFocus
                  disabled={busy || accesses.length === 0}
                  onClick={start}
                >
                  {t("share.dialog.start")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
