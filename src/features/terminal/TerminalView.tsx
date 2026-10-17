import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cssFontFamily, DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import { hostKeyOf } from "../history/history";
import { commandHistory, type HistoryStore } from "../history/historyStore";
import { patchJump } from "../sessions/jumpHosts";
import { savedPasswordRejected, shouldAskAgain, storageFor } from "../sessions/passwordFlow";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import {
  sshLoginOf,
  targetTitle,
  type JumpTarget,
  type PasswordStorage,
  type SessionTarget,
  type SshAuth,
} from "../sessions/types";
import { describeSerialError } from "../serial/serialSettings";
import { describeSshError, toSshError, type SshError } from "../ssh/sshErrors";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { parseOsc7 } from "../sftp/osc7";
import type { MacroTarget } from "../macros/player";
import { shortcutFor, type Shortcut } from "../panes/shortcuts";
import { matchesShortcut } from "../settings/shortcutCapture";
import { readText, writeText } from "./clipboard";
import { backendFor } from "./backend";
import { runningShellOf } from "./localShell";
import { useShells } from "../platform/useShells";
import { clearLineKeys } from "./clearLine";
import { usePlatform } from "../platform/usePlatform";
import { FindBar, type FindDirection, type FindOptions } from "./FindBar";
import { EMPTY_LINE, feedExternal, feedInput, isSecretPrompt, promptBefore, type LineState } from "./lineTracker";
import { bufferText, type BufferLine } from "./output";
import { pastePlan } from "./paste";
import { PasteConfirm } from "./PasteConfirm";
import { createSessionLog, type SessionLog } from "./sessionLog";
import { TerminalContextMenu, type MenuAction } from "./TerminalContextMenu";
import { themeById } from "./themes";
import type { AppKey } from "../../i18n/catalogs";
import { t } from "../../i18n/i18n";

interface TerminalViewProps {
  target: SessionTarget;
  /** True while the view is visible (its tab is the active one). */
  active: boolean;
  /** True when this pane should hold the keyboard focus while visible; defaults to true. */
  focused?: boolean;
  onTitle: (title: string) => void;
  onExit: (code: number | null) => void;
  /** Working directory reported by the shell through OSC 7. */
  onCwd?: (path: string) => void;
  /** Backend session id once connected, null when the session ends. */
  onSession?: (id: number | null) => void;
  /** Called with everything the user types into this terminal. */
  onInput?: (data: string) => void;
  /** Hands out a function that writes to this session as if typed; returns its unregister function. */
  registerWriter?: (write: (data: string) => void) => () => void;
  /** App-wide terminal settings (S15.6); defaults when omitted. */
  settings?: TerminalSettings;
  /** Changes a setting from inside the pane (the paste confirmation's "Don't ask again"). */
  onSettingsChange?: (patch: Partial<TerminalSettings>) => void;
  /** File this pane's output is logged to, or null when logging stops (S15.5). */
  onLogging?: (path: string | null) => void;
  /** Hands out this pane's macro interface (S16.3); returns its unregister function. */
  registerMacroTarget?: (target: MacroTarget) => () => void;
  /**
   * Asks the AI provider to complete the typed line when the history has no suggestion
   * (S2); resolves with the whole command line (starting with `line`) or null.
   */
  aiSuggest?: (context: AiSuggestContext) => Promise<string | null>;
  /** The command history behind inline suggestions (S1); the app's history when omitted. */
  history?: HistoryStore;
  /** Hands out what the assistant needs from this pane (S3); returns its unregister function. */
  registerAssistTarget?: (target: AssistTarget) => () => void;
}

/** What the on-demand assistant uses from a pane (S3). */
export interface AssistTarget {
  /** The selected text, or "" when nothing is selected. */
  selection: () => string;
  /** Gives the keyboard back to the terminal. */
  focus: () => void;
  /**
   * Types `text` into this pane as if the user had typed it (tracked, so it is recorded once sent
   * with Enter), but never broadcast to other panes or recorded into a macro.
   */
  insert: (text: string) => void;
  /**
   * Replaces the typed line with `text` and sends it with Enter (recorded like a typed command, never
   * broadcast). Refused (false) at a password prompt or in a full-screen program.
   */
  run: (text: string) => boolean;
}

export interface AiSuggestContext {
  line: string;
  hostKey: string;
  /** Working directory reported through OSC 7, if any. */
  cwd: string | null;
  /** The host's last commands, oldest first (`aiHistoryContext` of them). */
  history: string[];
}

/** Pause in typing before the AI is asked (S2). */
export const AI_SUGGEST_DELAY_MS = 400;

/** The grey rest of the command drawn after the cursor (S1). */
interface Ghost {
  text: string;
  style: CSSProperties;
}

const sameGhost = (a: Ghost | null, b: Ghost | null) =>
  a === b || (a !== null && b !== null && a.text === b.text && JSON.stringify(a.style) === JSON.stringify(b.style));

/** The next word of a suggestion, with the spaces before it (Ctrl+Right). */
const nextWord = (rest: string) => /^\s*\S+/.exec(rest)?.[0] ?? rest;

interface PendingHost {
  host: string;
  fingerprint: string;
  otherKnownKeys: string[];
  /** Set when the host is a jump host. */
  jump?: { index: number; label: string };
}

/**
 * Which login the password prompt is for (the target, or jump host `index`), and whether
 * its saved password was rejected (see `savedPasswordRejected`).
 */
type PasswordFor = { rejected: boolean } & ({ jump: null } | { jump: { index: number; label: string } });

/** "bastion — jump host 1 of 2" */
const jumpLabel = (jumps: JumpTarget[], index: number) =>
  t("sessions.jumps.label", { name: jumps[index].name, index: index + 1, total: jumps.length });

/** The saved session whose keyring password a login uses, if any. */
const savedLoginOf = (where: { host: string; port: number; username: string; auth: SshAuth }) =>
  where.auth.method === "storedPassword"
    ? { id: where.auth.sessionId, username: where.username, host: where.host, port: where.port }
    : null;

const red = (text: string) => `\x1b[31m${text}\x1b[0m\r\n`;

/** Every row of the scrollback, for "Save output to file". */
const scrollback = (term: Terminal): BufferLine[] => {
  const buffer = term.buffer.active;
  const rows: BufferLine[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) rows.push({ text: line.translateToString(false), isWrapped: line.isWrapped });
  }
  return rows;
};

const textFilters = () => [{ name: t("terminal.view.textFiles"), extensions: ["txt", "log"] }];

interface PendingPaste {
  text: string;
  lineCount: number;
  preview: string[];
}

/** Login typed after the saved password failed; kept for later retries (e.g. host key trust). */
interface TypedLogin {
  auth: SshAuth;
  storage?: PasswordStorage;
}

/** One xterm.js instance bound to one backend session for its whole lifetime. */
export function TerminalView({
  target,
  active,
  focused = true,
  onTitle,
  onExit,
  onCwd,
  onSession,
  onInput,
  registerWriter,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
  onLogging,
  registerMacroTarget,
  aiSuggest,
  history = commandHistory,
  registerAssistTarget,
}: TerminalViewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const historyRef = useRef(history);
  historyRef.current = history;
  /** Visible and holding the keyboard: the only state that shows suggestions. */
  const shownRef = useRef(active && focused);
  shownRef.current = active && focused;
  const [ghost, setGhost] = useState<Ghost | null>(null);
  /** The suggestion drawn right now, accepted by Right Arrow / End / Ctrl+Right. */
  const ghostRestRef = useRef<string | null>(null);
  /** Redraws the suggestion (set by the terminal effect). */
  const refreshGhostRef = useRef<() => void>(() => {});
  /** Accepts the drawn suggestion for a key event; true when the key was used. */
  const acceptRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  const [findOpen, setFindOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const logRef = useRef<SessionLog | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  /** Pane-local shortcuts, reached from xterm's key handler. */
  const paneShortcutRef = useRef<(shortcut: Shortcut) => void>(() => {});
  /** The current paste handler, reached from the native paste listener. */
  const pasteTextRef = useRef<(text: string) => void>(() => {});
  const startRef = useRef<(trustedFingerprint?: string) => void>(() => {});
  const [pendingHost, setPendingHost] = useState<PendingHost | null>(null);
  const [askPassword, setAskPassword] = useState<PasswordFor | null>(null);
  const typedLogin = useRef<TypedLogin | null>(null);
  /** Jump hosts, updated when one of them is trusted or gets a typed password. */
  /** The SSH login of an SSH tab, or the one that starts the server of a Mosh tab. */
  const sshLogin = sshLoginOf(target);
  const jumpsRef = useRef<JumpTarget[]>(sshLogin?.jumps ?? []);
  /** The saved session whose keyring password the prompted login replaces, if any. */
  const savedLogin =
    askPassword?.jump != null
      ? savedLoginOf(jumpsRef.current[askPassword.jump.index])
      : sshLogin
        ? savedLoginOf(sshLogin)
        : null;
  // Keep callbacks current without re-creating the terminal.
  const callbacks = useRef({ onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget, aiSuggest, registerAssistTarget });
  callbacks.current = { onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget, aiSuggest, registerAssistTarget };
  // The platform arrives from the backend after the first render.
  const platform = usePlatform();
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const shells = useShells();
  const shellsRef = useRef(shells);
  shellsRef.current = shells;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: cssFontFamily(settingsRef.current.fontFamily),
      fontSize: settingsRef.current.fontSize,
      lineHeight: 1.15,
      scrollback: 10000,
      theme: themeById(settingsRef.current.theme).theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    const search = new SearchAddon();
    term.loadAddon(search);
    // Application shortcuts must not reach the shell (Ctrl+Shift+D would send Ctrl+D, i.e. EOF);
    // returning false lets the event bubble to the window listener without xterm handling it.
    // Find, copy and paste belong to this pane and are handled here.
    term.attachCustomKeyEventHandler((e) => {
      if (acceptRef.current(e)) return false;
      // The assistant shortcut (S3) is the window's, like the app shortcuts below.
      if (matchesShortcut(e, settingsRef.current.assistantShortcut)) return false;
      const shortcut = shortcutFor(e);
      if (shortcut === null) return true;
      if (e.type === "keydown") {
        // No native paste on top of ours.
        if (shortcut.type === "paste") e.preventDefault();
        paneShortcutRef.current(shortcut);
      }
      return false;
    });
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    const backend = backendFor(target);
    let sessionId: number | null = null;
    let disposed = false;
    /** Set when the session ended but its pane stays open (serial device gone, mosh-client failed). */
    let ended = false;
    /** Macros waiting for output (S16.3). */
    const outputListeners = new Set<(text: string) => void>();

    /** Ends the session but keeps the pane, so what it printed (e.g. an error) stays readable. */
    const endKeepingPane = (note: string) => {
      ended = true;
      term.write(`\r\n[${note}]\r\n`);
      if (sessionId !== null) void backend.close(sessionId).catch(() => {});
      sessionId = null;
      callbacks.current.onSession?.(null);
    };

    /** Handles a failure of jump host `err.hop`: trust prompt, password prompt or message. */
    const jumpFailed = (err: Extract<SshError, { kind: "hop" }>) => {
      const index = err.hop - 1;
      const jump = jumpsRef.current[index];
      if (!jump) return term.write(red(describeSshError(err)));
      const label = jumpLabel(jumpsRef.current, index);
      if (err.error.kind === "unknownHost") setPendingHost({ ...err.error, jump: { index, label } });
      else {
        if (err.error.kind !== "secretMissing") term.write(red(describeSshError(err)));
        if (shouldAskAgain(jump.auth, err.error)) {
          setAskPassword({ jump: { index, label }, rejected: savedPasswordRejected(err.error) });
        }
      }
    };

    const start = (trustedFingerprint?: string) => {
      const jumps = jumpsRef.current.map((j) => j.name).join(", ");
      const say = (plain: AppKey, withJumps: AppKey, where: string) =>
        term.write(`${jumps ? t(withJumps, { target: where, jumps }) : t(plain, { target: where })}\r\n`);
      if (target.type === "ssh") say("terminal.view.connecting", "terminal.view.connectingVia", targetTitle(target));
      if (target.type === "mosh") {
        say("terminal.view.startingMosh", "terminal.view.startingMoshVia", targetTitle(target.ssh));
      }
      if (target.type === "serial") term.write(`${t("terminal.view.opening", { target: targetTitle(target) })}\r\n`);
      if (target.type === "telnet") {
        term.write(`\x1b[33m${t("terminal.view.telnetUnencrypted")}\x1b[0m\r\n`);
        term.write(`${t("terminal.view.connecting", { target: `${target.host}:${target.port}` })}\r\n`);
      }
      backend
        .start({ cols: term.cols, rows: term.rows, trustedFingerprint, jumps: jumpsRef.current, ...typedLogin.current }, (msg) => {
          // A disposed view (e.g. StrictMode's first mount) must not close the live tab.
          if (disposed) return;
          if (msg.event === "output") {
            term.write(msg.data);
            logRef.current?.write(msg.data);
            outputListeners.forEach((listener) => listener(msg.data));
          }
          else if (target.type === "serial") endKeepingPane(t("terminal.view.serialEnded"));
          else if (target.type === "mosh" && msg.data !== 0) {
            endKeepingPane(
              msg.data === null
                ? t("terminal.view.moshExited")
                : t("terminal.view.moshExitedCode", { code: msg.data }),
            );
          } else {
            callbacks.current.onSession?.(null);
            callbacks.current.onExit(msg.data);
          }
        })
        .then((id) => {
          if (disposed || ended) void backend.close(id).catch(() => {});
          else {
            sessionId = id;
            callbacks.current.onSession?.(id);
          }
        })
        .catch((raw) => {
          if (disposed) return;
          // Serial and Telnet errors are `{ kind, message }`.
          if (target.type === "serial" || target.type === "telnet") {
            term.write(red(describeSerialError(raw)));
            return;
          }
          const err = toSshError(raw);
          if (err.kind === "hop") return jumpFailed(err);
          const auth = typedLogin.current?.auth ?? sshLoginOf(target)?.auth ?? null;
          if (auth && shouldAskAgain(auth, err)) {
            // No saved password is the normal first login, not an error worth a red line.
            if (err.kind !== "secretMissing") term.write(red(describeSshError(err)));
            setAskPassword({ jump: null, rejected: savedPasswordRejected(err) });
          } else if (err.kind === "unknownHost") setPendingHost(err);
          else term.write(red(describeSshError(err)));
        });
    };
    startRef.current = start;
    // Deferred one tick: StrictMode mounts, unmounts and remounts synchronously, and the
    // discarded mount must not open anything (a serial port allows a single opener).
    const startTimer = setTimeout(() => {
      if (!disposed) start();
    }, 0);

    const write = (data: string) => {
      if (sessionId !== null) void backend.write(sessionId, data);
    };

    // Inline suggestions (S1): the typed line, its suggestion and what is drawn.
    const hostKey = hostKeyOf(target);
    // Read history.json now so the first keys already get suggestions.
    void historyRef.current.ready();
    let line: LineState = EMPTY_LINE;
    let suggestion: { line: string; rest: string } | null = null;
    let cwd: string | null = null;
    let aiTimer: ReturnType<typeof setTimeout> | null = null;
    /** Bumped on every change of the line: older AI answers are stale. */
    let aiSeq = 0;

    /** The cursor line up to the cursor, and whether anything is drawn after it. */
    const cursorRow = () => {
      const buffer = term.buffer.active;
      const row = buffer.getLine(buffer.baseY + buffer.cursorY);
      const toCursor = row?.translateToString(false, 0, buffer.cursorX) ?? "";
      const textAfter = (row?.translateToString(true).length ?? 0) > buffer.cursorX;
      return { toCursor, textAfter };
    };
    const atSecretPrompt = () => isSecretPrompt(promptBefore(cursorRow().toCursor, line.text));
    const fullScreen = () => term.buffer.active.type === "alternate";

    const refreshGhost = () => {
      const buffer = term.buffer.active;
      let rest: string | null = null;
      if (
        settingsRef.current.inlineSuggestions &&
        shownRef.current &&
        !line.uncertain &&
        suggestion?.line === line.text &&
        !fullScreen() &&
        buffer.viewportY === buffer.baseY
      ) {
        const { toCursor, textAfter } = cursorRow();
        // The shell echoed the typed text and the cursor ends it.
        if (toCursor.endsWith(line.text) && !textAfter && !isSecretPrompt(promptBefore(toCursor, line.text))) {
          rest = suggestion.rest.split(/[\r\n]/)[0] || null;
        }
      }
      ghostRestRef.current = rest;
      let next: Ghost | null = null;
      if (rest !== null) {
        const screen = host.querySelector<HTMLElement>(".xterm-screen");
        const pane = paneRef.current;
        const cellWidth = screen ? screen.clientWidth / term.cols : 0;
        const cellHeight = screen ? screen.clientHeight / term.rows : 0;
        const origin = screen?.getBoundingClientRect();
        const paneBox = pane?.getBoundingClientRect();
        next = {
          text: rest,
          style: {
            left: (origin?.left ?? 0) - (paneBox?.left ?? 0) + buffer.cursorX * cellWidth,
            top: (origin?.top ?? 0) - (paneBox?.top ?? 0) + buffer.cursorY * cellHeight,
            maxWidth: cellWidth ? (term.cols - buffer.cursorX) * cellWidth : undefined,
            height: cellHeight || undefined,
            lineHeight: cellHeight ? `${cellHeight}px` : undefined,
            fontFamily: cssFontFamily(settingsRef.current.fontFamily),
            fontSize: settingsRef.current.fontSize,
            color: themeById(settingsRef.current.theme).theme.foreground,
          },
        };
      }
      setGhost((previous) => (sameGhost(previous, next) ? previous : next));
    };
    refreshGhostRef.current = refreshGhost;

    const askAi = () => {
      const ask = callbacks.current.aiSuggest;
      const s = settingsRef.current;
      // A leading space keeps a line out of history (like HISTCONTROL); it stays private from the AI too.
      if (!ask || !s.aiSuggestions || !s.inlineSuggestions || line.uncertain || !line.text.trim() || line.text.startsWith(" ")) return;
      const seq = aiSeq;
      const asked = line.text;
      aiTimer = setTimeout(() => {
        aiTimer = null;
        // Never send what is typed at a password prompt or in a full-screen program.
        if (seq !== aiSeq || fullScreen() || atSecretPrompt()) return;
        const recent = settingsRef.current.commandHistory ? historyRef.current.recent(hostKey, s.aiHistoryContext) : [];
        ask({ line: asked, hostKey, cwd, history: recent })
          .then((full) => {
            if (seq !== aiSeq || !full || !full.startsWith(asked) || full.length <= asked.length) return;
            suggestion = { line: asked, rest: full.slice(asked.length) };
            refreshGhost();
          })
          .catch(() => {});
      }, AI_SUGGEST_DELAY_MS);
    };

    const updateSuggestion = () => {
      aiSeq++;
      if (aiTimer) clearTimeout(aiTimer);
      aiTimer = null;
      suggestion = null;
      const s = settingsRef.current;
      if (s.inlineSuggestions && !line.uncertain && line.text) {
        const full = s.commandHistory ? historyRef.current.suggest(hostKey, line.text) : null;
        if (full) suggestion = { line: line.text, rest: full.slice(line.text.length) };
        else askAi();
      }
      refreshGhost();
    };

    /** Follows the typed line and records the commands sent with Enter. */
    const track = (data: string) => {
      if (fullScreen()) {
        // vim, less, top...: nothing typed there is a command line.
        line = EMPTY_LINE;
      } else {
        const result = feedInput(line, data);
        const secret = result.commits.length > 0 && atSecretPrompt();
        line = result.state;
        if (settingsRef.current.commandHistory && !secret) {
          for (const command of result.commits) if (!command.startsWith(" ")) historyRef.current.record(hostKey, command);
        }
      }
      updateSuggestion();
    };

    const unregisterWriter = callbacks.current.registerWriter?.((data) => {
      write(data);
      // Multi-execution and other panes' data is never recorded.
      line = feedExternal(line, data);
      updateSuggestion();
    });
    /** The normal input path: typing, pastes and macros all go through it (multi-execution included). */
    const typed = (data: string) => {
      write(data);
      callbacks.current.onInput?.(data);
      track(data);
    };
    acceptRef.current = (e) => {
      const rest = ghostRestRef.current;
      if (rest === null || e.altKey || e.metaKey || e.shiftKey) return false;
      const all = !e.ctrlKey && (e.key === "ArrowRight" || e.key === "End");
      const word = e.ctrlKey && e.key === "ArrowRight";
      if (!all && !word) return false;
      if (e.type === "keydown") {
        e.preventDefault?.();
        typed(all ? rest : nextWord(rest));
      }
      return true;
    };
    const unregisterMacroTarget = callbacks.current.registerMacroTarget?.({
      send: typed,
      subscribe: (listener) => {
        outputListeners.add(listener);
        return () => outputListeners.delete(listener);
      },
      notice: (text) => term.write(`\r\n${red(text)}`),
    });

    const unregisterAssistTarget = callbacks.current.registerAssistTarget?.({
      selection: () => (term.hasSelection() ? term.getSelection() : ""),
      focus: () => term.focus(),
      insert: (text) => {
        write(text);
        track(text);
      },
      run: (text) => {
        // One plain line only: a line break or control character would press keys of its own.
        // eslint-disable-next-line no-control-regex
        if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) return false;
        if (fullScreen() || atSecretPrompt()) return false;
        // Clear the line first: whatever was half typed (even after Tab or arrows) is removed,
        // so the line sent is exactly the command.
        write(`${clearLineKeys(platformRef.current, target.type, runningShellOf(target, shellsRef.current))}${text}\r`);
        line = EMPTY_LINE;
        track(`${text}\r`);
        return true;
      },
    });

    const subs = [
      term.onData(typed),
      term.onWriteParsed(refreshGhost),
      term.onCursorMove(refreshGhost),
      term.onScroll(refreshGhost),
      term.onResize(({ cols, rows }) => sessionId !== null && void backend.resize(sessionId, cols, rows)),
      term.onTitleChange((title) => callbacks.current.onTitle(title)),
      term.parser.registerOscHandler(7, (data) => {
        const path = parseOsc7(data);
        if (path) {
          cwd = path;
          callbacks.current.onCwd?.(path);
        }
        return true;
      }),
    ];

    const observer = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit();
    });
    observer.observe(host);

    // Every native paste (e.g. middle click) goes through the same confirmation as ours.
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      pasteTextRef.current(e.clipboardData?.getData("text/plain") ?? "");
    };
    host.addEventListener("paste", onPaste, true);
    // Copy on select: only selections made with the mouse (find matches select text too).
    const onMouseUp = (e: globalThis.MouseEvent) => {
      if (e.button !== 0 || !settingsRef.current.copyOnSelect) return;
      setTimeout(() => {
        if (!disposed && term.hasSelection()) void writeText(term.getSelection()).catch(() => {});
      }, 0);
    };
    host.addEventListener("mouseup", onMouseUp);

    return () => {
      disposed = true;
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("mouseup", onMouseUp);
      // Closing the pane writes what the log still holds.
      void logRef.current?.stop();
      logRef.current = null;
      clearTimeout(startTimer);
      if (aiTimer) clearTimeout(aiTimer);
      aiSeq++;
      acceptRef.current = () => false;
      unregisterWriter?.();
      unregisterMacroTarget?.();
      unregisterAssistTarget?.();
      outputListeners.clear();
      observer.disconnect();
      subs.forEach((s) => s.dispose());
      if (sessionId !== null) void backend.close(sessionId);
      term.dispose();
    };
    // The target of a tab never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggestions show only in the visible, focused pane, and follow their settings.
  useEffect(() => {
    refreshGhostRef.current();
  }, [active, focused, settings.inlineSuggestions, settings.fontSize, settings.fontFamily, settings.theme]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    if (focused) termRef.current?.focus();
  }, [active, focused]);

  // Font size changes apply live (S15.2); hidden tabs refit when they are shown again.
  const fontSize = settings.fontSize;
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    if (hostRef.current?.offsetParent !== null) fitRef.current?.fit();
  }, [fontSize]);

  // Colour scheme and font changes apply live too; a new font changes the cell size.
  const theme = themeById(settings.theme).theme;
  const fontFamily = cssFontFamily(settings.fontFamily);
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.theme === theme) return;
    term.options.theme = theme;
  }, [theme]);
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontFamily === fontFamily) return;
    term.options.fontFamily = fontFamily;
    if (hostRef.current?.offsetParent !== null) fitRef.current?.fit();
  }, [fontFamily]);

  const focusTerminal = () => termRef.current?.focus();

  /** Pastes as if typed (multi-execution included), asking first for several lines (S15.3). */
  const pasteText = (text: string) => {
    const plan = pastePlan(text, settingsRef.current);
    if (plan.kind === "direct") termRef.current?.paste(plan.text);
    else if (plan.kind === "confirm") setPendingPaste(plan);
  };
  pasteTextRef.current = pasteText;

  const pasteFromClipboard = () => {
    readText()
      .then((text) => pasteText(text ?? ""))
      .catch(() => termRef.current?.write(red(t("terminal.view.clipboardError"))));
  };

  const copySelection = () => {
    const term = termRef.current;
    if (term?.hasSelection()) void writeText(term.getSelection()).catch(() => {});
  };

  const find = (text: string, options: FindOptions, direction: FindDirection) => {
    const search = searchRef.current;
    if (!search) return false;
    try {
      return direction === "next" ? search.findNext(text, options) : search.findPrevious(text, options);
    } catch {
      return false; // e.g. an unfinished regular expression
    }
  };

  const closeFind = () => {
    setFindOpen(false);
    searchRef.current?.clearDecorations();
    focusTerminal();
  };

  const saveOutput = async () => {
    const term = termRef.current;
    if (!term) return;
    const contents = bufferText(scrollback(term));
    const path = await save({ defaultPath: "terminal-output.txt", filters: textFilters() });
    if (!path) return;
    await invoke("save_text_file", { path, contents }).catch((err) =>
      termRef.current?.write(red(t("terminal.view.saveError", { error: String(err) }))),
    );
  };

  const stopLogging = () => {
    void logRef.current?.stop();
    logRef.current = null;
    setLogPath(null);
    callbacks.current.onLogging?.(null);
  };

  const toggleLogging = async () => {
    if (logRef.current) return stopLogging();
    const path = await save({ defaultPath: "session.log", filters: textFilters() });
    if (!path || logRef.current || !termRef.current) return;
    const log = createSessionLog(path, (file, contents) => invoke("append_text_file", { path: file, contents }), {
      onError: (err) => {
        if (logRef.current !== log) return;
        termRef.current?.write(red(t("terminal.view.loggingStopped", { error: String(err) })));
        stopLogging();
      },
    });
    logRef.current = log;
    setLogPath(path);
    callbacks.current.onLogging?.(path);
  };

  const runMenuAction = (action: MenuAction) => {
    const term = termRef.current;
    switch (action) {
      case "copy":
        copySelection();
        break;
      case "paste":
        pasteFromClipboard();
        break;
      case "selectAll":
        term?.selectAll();
        break;
      case "clear":
        term?.clear();
        break;
      case "find":
        return setFindOpen(true);
      case "save":
        void saveOutput();
        break;
      case "log":
        void toggleLogging();
        break;
    }
    focusTerminal();
  };

  paneShortcutRef.current = (shortcut) => {
    if (shortcut.type === "find") setFindOpen(true);
    else if (shortcut.type === "copy") copySelection();
    else if (shortcut.type === "paste") pasteFromClipboard();
  };

  /** Right click pastes, or opens the menu when that is turned off; Ctrl+right click always opens it (S15.4). */
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (settingsRef.current.rightClickPastes && !e.ctrlKey) pasteFromClipboard();
    else setMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="terminal-pane" hidden={!active} ref={paneRef}>
      <div
        className="terminal-host"
        ref={hostRef}
        style={{ background: theme.background }}
        onContextMenu={onContextMenu}
      />
      {ghost && (
        <div className="terminal-ghost" aria-hidden="true" style={ghost.style}>
          {ghost.text}
        </div>
      )}
      {findOpen && <FindBar onFind={find} onClose={closeFind} />}
      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          logging={logPath !== null}
          onAction={runMenuAction}
          onClose={() => {
            setMenu(null);
            focusTerminal();
          }}
        />
      )}
      {pendingPaste && (
        <PasteConfirm
          lineCount={pendingPaste.lineCount}
          preview={pendingPaste.preview}
          onPaste={(dontAskAgain) => {
            setPendingPaste(null);
            if (dontAskAgain) onSettingsChange?.({ confirmMultilinePaste: false });
            termRef.current?.paste(pendingPaste.text);
            focusTerminal();
          }}
          onCancel={() => {
            setPendingPaste(null);
            focusTerminal();
          }}
        />
      )}
      {pendingHost && (
        <HostKeyPrompt
          host={pendingHost.host}
          fingerprint={pendingHost.fingerprint}
          otherKnownKeys={pendingHost.otherKnownKeys}
          via={pendingHost.jump?.label}
          onTrust={() => {
            setPendingHost(null);
            const jump = pendingHost.jump;
            if (jump) {
              jumpsRef.current = patchJump(jumpsRef.current, jump.index, { trustedFingerprint: pendingHost.fingerprint });
              startRef.current();
            } else startRef.current(pendingHost.fingerprint);
            termRef.current?.focus();
          }}
          onCancel={() => {
            setPendingHost(null);
            termRef.current?.write(red(t("terminal.view.hostKeyCancelled")));
            termRef.current?.focus();
          }}
        />
      )}
      {askPassword && savedLogin && (
        <PasswordPrompt
          label={askPassword.jump?.label ?? targetTitle(sshLogin ?? target)}
          remember={{ initial: askPassword.rejected }}
          onSubmit={(password, remember) => {
            setAskPassword(null);
            const storage = storageFor(savedLogin, remember, askPassword.rejected);
            const login = { auth: { method: "password" as const, password }, storage };
            if (askPassword.jump) jumpsRef.current = patchJump(jumpsRef.current, askPassword.jump.index, login);
            else typedLogin.current = login;
            startRef.current();
            termRef.current?.focus();
          }}
          onCancel={() => {
            setAskPassword(null);
            termRef.current?.write(red(t("terminal.view.cancelled")));
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
