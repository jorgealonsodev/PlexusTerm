import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal, type FontWeight } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Eye, Keyboard, ShieldAlert } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useT } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import { boldWeight, cssFontFamily, DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import type { SharedTarget } from "../sessions/types";
import { themeById } from "../terminal/themes";
import { writeText } from "../terminal/clipboard";
import { FindBar, type FindDirection, type FindOptions } from "../terminal/FindBar";
import { shareTime } from "./labels";
import type { Access } from "./shareApi";
import { closeView, startView, viewInput, type DoneReason } from "./viewApi";

interface SharedViewProps {
  target: SharedTarget;
  active: boolean;
  focused?: boolean;
  settings?: TerminalSettings;
}

type Phase = "connecting" | "waiting" | "live" | "reconnecting" | "away" | "done";

interface Done {
  reason: DoneReason;
  code: string | null;
}

/** The message of a final state (PRD-share §4.2, §4.4). */
function doneMessage(done: Done, host: string): { key: AppKey; vars?: Record<string, string> } {
  switch (done.reason) {
    case "denied":
      return { key: "share.view.denied" };
    case "kicked":
      return { key: "share.view.kicked" };
    case "offline":
      return { key: "share.view.offline" };
    case "lost":
      return { key: "share.view.lost", vars: { host } };
    case "refused":
      if (done.code === "not_found") return { key: "share.view.notFound" };
      if (done.code === "bad_key") return { key: "share.view.badKey" };
      if (done.code === "full") return { key: "share.view.full" };
      if (done.code === "version") return { key: "share.view.version" };
      return { key: "share.view.refused", vars: { code: done.code ?? "?" } };
    default:
      return { key: "share.view.ended" };
  }
}

/**
 * A tab shared from another PlexusTerm (PRD-share P3), drawn as an untrusted pane: it keeps the
 * sharer's size, offers copy and find, and types only with Can type while the share is live. What
 * the remote program prints cannot reach this computer: no clipboard writes (OSC 52), no answers to
 * terminal queries, no title changes, no notifications, no links, no AI and no logging.
 */
export function SharedView({ target, active, focused = true, settings = DEFAULT_SETTINGS }: SharedViewProps) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [access, setAccess] = useState<Access | null>(null);
  const [paused, setPaused] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [note, setNote] = useState<AppKey | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const typing = useRef(false);
  typing.current = phase === "live" && access === "type" && !paused;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily: cssFontFamily(settings.fontFamily),
      fontSize: settings.fontSize,
      fontWeight: settings.fontWeight as FontWeight,
      fontWeightBold: boldWeight(settings.fontWeight) as FontWeight,
      lineHeight: settings.lineHeight,
      scrollback: 10000,
      theme: themeById(settings.theme).theme,
    });
    // Same character widths as the sharer's terminal, or emoji lines would be laid out differently.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    const search = new SearchAddon();
    term.loadAddon(search);
    // Remote output must not make this terminal answer back (the answer would be typed into the
    // sharer's shell) nor reach this computer's clipboard: device attributes and status reports,
    // window reports, mode and setting reports, colour queries and OSC 52 are swallowed.
    const swallow = () => true;
    const subs = [
      term.parser.registerCsiHandler({ final: "c" }, swallow),
      term.parser.registerCsiHandler({ prefix: ">", final: "c" }, swallow),
      term.parser.registerCsiHandler({ prefix: "=", final: "c" }, swallow),
      term.parser.registerCsiHandler({ final: "n" }, swallow),
      term.parser.registerCsiHandler({ prefix: "?", final: "n" }, swallow),
      term.parser.registerCsiHandler({ final: "t" }, swallow),
      term.parser.registerCsiHandler({ intermediates: "$", final: "p" }, swallow),
      term.parser.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, swallow),
      term.parser.registerCsiHandler({ prefix: ">", final: "q" }, swallow),
      term.parser.registerDcsHandler({ intermediates: "$", final: "q" }, swallow),
      ...[4, 10, 11, 12, 52].map((ident) => term.parser.registerOscHandler(ident, swallow)),
    ];
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey || !e.shiftKey) return true;
      const key = e.key.toLowerCase();
      if (key === "c") {
        if (term.hasSelection()) void writeText(term.getSelection()).catch(() => {});
        return false;
      }
      if (key === "f") {
        setFindOpen(true);
        return false;
      }
      return true;
    });
    term.open(host);
    termRef.current = term;
    searchRef.current = search;

    let id: number | null = null;
    let disposed = false;
    const send = (data: string) => {
      if (id !== null && typing.current) void viewInput(id, data).catch(() => {});
    };
    subs.push(term.onData(send), term.onBinary(send));
    void startView(target.url, target.relayUrl, (event) => {
      if (disposed) return;
      switch (event.event) {
        case "reconnecting":
          return setPhase("reconnecting");
        case "waiting":
          return setPhase("waiting");
        case "joined":
          term.resize(event.data.cols, event.data.rows);
          setAccess(event.data.access);
          return setPhase("live");
        case "reset":
          return term.reset();
        case "output":
          return term.write(event.data);
        case "resized":
          return term.resize(event.data.cols, event.data.rows);
        case "access":
          setAccess(event.data);
          if (event.data === "view") setNote("share.view.becameViewOnly");
          return;
        case "inputPaused":
          return setPaused(event.data);
        case "programExited":
          return setNote("share.view.programExited");
        case "sharerAway":
          return setPhase("away");
        case "sharerBack":
          return setPhase("live");
        case "expiry":
          return setExpiresAt(event.data * 1000);
        case "done":
          // Disconnecting clears the pane's buffer (PRD-share §6.2).
          term.reset();
          setPhase("done");
          return setDone(event.data);
      }
    })
      .then((started) => {
        if (disposed) void closeView(started).catch(() => {});
        else id = started;
      })
      .catch((err) => {
        if (disposed) return;
        setPhase("done");
        setDone({ reason: "refused", code: String(err) });
      });
    return () => {
      disposed = true;
      if (id !== null) void closeView(id).catch(() => {});
      subs.forEach((s) => s.dispose());
      term.dispose();
      termRef.current = null;
    };
    // The target of a tab never changes; settings apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themeById(settings.theme).theme;
    term.options.fontSize = settings.fontSize;
    term.options.fontFamily = cssFontFamily(settings.fontFamily);
  }, [settings.theme, settings.fontSize, settings.fontFamily]);

  useEffect(() => {
    if (active && focused) termRef.current?.focus();
  }, [active, focused]);

  const find = (text: string, options: FindOptions, direction: FindDirection) => {
    const search = searchRef.current;
    if (!search) return false;
    try {
      return direction === "next" ? search.findNext(text, options) : search.findPrevious(text, options);
    } catch {
      return false;
    }
  };

  const status: AppKey | null =
    phase === "connecting"
      ? "share.view.connecting"
      : phase === "waiting"
        ? "share.view.waiting"
        : phase === "reconnecting"
          ? "share.view.reconnecting"
          : phase === "away"
            ? "share.view.sharerAway"
            : null;
  const ended = done ? doneMessage(done, target.relayHost) : null;
  const Icon = access === "type" ? Keyboard : Eye;
  return (
    <div className="terminal-pane shared-pane" hidden={!active}>
      <div className="shared-pane__bar" role="status" aria-live="polite">
        <span className="shared-pane__untrusted" title={t("share.view.untrustedHelp")}>
          <ShieldAlert size={14} aria-hidden="true" />
          {t("share.view.untrusted")}
        </span>
        {access && (
          <span className={`share-access${access === "type" ? " share-access--type" : ""}`}>
            <Icon size={14} aria-hidden="true" />
            {t(access === "type" ? "share.dialog.canType" : "share.dialog.viewOnly")}
          </span>
        )}
        {status && <span>{t(status)}</span>}
        {paused && phase === "live" && <span>{t("share.view.paused")}</span>}
        {note && <span>{t(note)}</span>}
        {expiresAt !== null && phase !== "done" && <span className="muted">{t("share.view.endsAt", { time: shareTime(expiresAt) })}</span>}
      </div>
      <div className="terminal-host shared-pane__host" ref={hostRef} style={{ background: themeById(settings.theme).theme.background }} />
      {ended && (
        <div className="shared-pane__done" role="alert">
          <p>{t(ended.key, ended.vars)}</p>
          {done?.code === "version" && (
            <button type="button" className="btn btn--primary" onClick={() => void openUrl(target.url).catch(() => {})}>
              {t("share.view.openInBrowser")}
            </button>
          )}
        </div>
      )}
      {findOpen && (
        <FindBar
          initialText=""
          onFind={find}
          onClose={() => {
            setFindOpen(false);
            searchRef.current?.clearDecorations();
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
