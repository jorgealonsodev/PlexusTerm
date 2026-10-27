import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal, type FontWeight, type IBuffer, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SerializeAddon } from "@xterm/addon-serialize";
import { cellsOf, createFileLinkProvider, createLinkHandler, webLinkHandler, type FileLinks } from "./fileLinks";
import { WebglAddon } from "@xterm/addon-webgl";
import { diagnosticEntry } from "../diagnostics/useDiagnosticLog";
import { softwareWebgl } from "./webglProbe";
import { keepCanvasesExact } from "./exactCanvas";
import { latencyFrame, latencyMark } from "./latencyLog";
import "@xterm/xterm/css/xterm.css";
import { boldWeight, cssFontFamily, DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
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
import { parseOsc7, parseOsc9Cwd } from "../sftp/osc7";
import type { MacroTarget } from "../macros/player";
import { shortcutFor, type Shortcut } from "../panes/shortcuts";
import { matchesShortcut } from "../settings/shortcutCapture";
import { readText, writeText } from "./clipboard";
import { backendFor, setTerminalFlow, type StartOptions } from "./backend";
import { createOutputFlow } from "./flowControl";
import { runningShellOf } from "./localShell";
import { useShells } from "../platform/useShells";
import { clearLineKeys } from "./clearLine";
import { usePlatform } from "../platform/usePlatform";
import { FindBar, type FindDirection, type FindOptions } from "./FindBar";
import { commandOnScreen, EMPTY_LINE, feedExternal, feedInput, isSecretPrompt, promptBefore, type LineState, promptOnlyOnScreen } from "./lineTracker";
import { bufferText, type BufferLine } from "./output";
import { pastePlan } from "./paste";
import { PasteConfirm } from "./PasteConfirm";
import { createSessionLog, type SessionLog } from "./sessionLog";
import { TerminalContextMenu, linkOf, type MenuAction } from "./TerminalContextMenu";
import { isDrawnGrey, parseOsc133, typedLineAt, type CommandLine, type ScreenRows } from "./shellMarks";
import { themeById } from "./themes";
import { attachErrorHighlight, errorColor, type ErrorHighlight } from "./errorHighlight";
import { attachCommandBlocks, jumpColor, type CommandBlocks } from "./commandBlocks";
import { compileRules } from "./highlightRules";
import { attachRuleHighlight, type RuleHighlight } from "./ruleHighlight";
import { createCommandTimer, formatDuration, shortCommand, type FinishedCommand } from "./commandTimer";
import { createOsc99Reader, parseOsc777, parseOsc9, type AttentionNotice } from "./attention";
import type { SharePane } from "../share/sharePane";
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
  /** Hands out how to run this pane's own actions (find, copy…) from the command palette; returns its unregister function. */
  registerPaneShortcuts?: (run: (shortcut: Shortcut) => void) => () => void;
  /**
   * Asks the AI provider to complete the typed line when the history has no suggestion
   * (S2); resolves with the whole command line (starting with `line`) or null.
   */
  aiSuggest?: (context: AiSuggestContext) => Promise<string | null>;
  /** The command history behind inline suggestions (S1); the app's history when omitted. */
  history?: HistoryStore;
  /** Hands out what the assistant needs from this pane (S3); returns its unregister function. */
  registerAssistTarget?: (target: AssistTarget) => () => void;
  /** Opens this pane's AI chat with its selection attached; without it the menu has no "Ask the AI". */
  onAskAi?: () => void;
  /**
   * A program asks for attention: the bell, or a desktop notification sequence (OSC 9, 777, 99)
   * such as Claude Code and Codex send when they finish or wait for the user.
   */
  onAttention?: (notice: AttentionNotice) => void;
  /**
   * The shell's prompt came back, so a command may have changed the git branch: the shell reported
   * its folder (OSC 7) or marked a prompt (OSC 133), or, without that, the output of a command sent
   * with Enter went quiet. `mark` is true for the shell's own marks (OSC 7, OSC 133), false for
   * quiet output, which a program running in the terminal (an AI CLI) can produce too.
   */
  onPrompt?: (mark: boolean) => void;
  /**
   * A command line sent with Enter (never one typed at a password prompt or in a full-screen
   * program), with the text before it on its row: the shell's prompt (S10).
   */
  onCommand?: (command: string, prompt: string) => void;
  /**
   * Given, it is called each time the output stops for `PROMPT_QUIET_MS`, with the text before the
   * cursor, so DEV mode can tell when the shell's prompt is back after an AI CLI (S10).
   */
  onOutputQuiet?: (row: string) => void;
  /**
   * Given, it is called with true when the pane starts printing on its own (not the echo of what is
   * typed) and with false once it has printed nothing for `ACTIVITY_QUIET_MS`: an AI CLI working.
   */
  onActivity?: (busy: boolean) => void;
  /** Turns the paths printed in the pane into files that Ctrl+click opens; none without it. */
  fileLinks?: FileLinks;
  /** Hands out what terminal sharing needs from this pane; returns its unregister function. */
  registerSharePane?: (pane: SharePane) => () => void;
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
  /**
   * Nothing is typed on the command line: no tracked text, nothing after the cursor, no password
   * prompt and no full-screen program. Unknown lines (after Tab or arrows) are not empty.
   */
  lineEmpty?: () => boolean;
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
/** Without shell integration, the prompt counts as back once a command's output stops this long. */
export const PROMPT_QUIET_MS = 500;
/** A pane stops counting as working after printing nothing this long (an AI CLI's spinner ticks faster). */
export const ACTIVITY_QUIET_MS = 1500;
/** Output this soon after a key is taken as its echo. */
const ECHO_MS = 150;

/** xterm's buffer as the shell marks read it. */
const rowsOf = (buffer: IBuffer, cols: number): ScreenRows => ({
  cols,
  row: (y) => {
    const line = buffer.getLine(y);
    if (!line) return null;
    return {
      wrapped: line.isWrapped,
      text: (start, end, trimRight = false) => line.translateToString(trimRight, start, end),
      drawn: (col) => {
        const cell = line.getCell(col);
        return cell !== undefined && isDrawnGrey(cell);
      },
    };
  },
});
/** After a resize, error lines are coloured again once the size has not changed for this long. */
const ERROR_REFRESH_DELAY_MS = 150;

/** The grey rest of the command drawn after the cursor (S1). */
interface Ghost {
  text: string;
  style: CSSProperties;
}

const sameGhost = (a: Ghost | null, b: Ghost | null) =>
  a === b || (a !== null && b !== null && a.text === b.text && JSON.stringify(a.style) === JSON.stringify(b.style));

/** Shift+Enter alone, not while an input method is composing text. */
const shiftEnter = (e: KeyboardEvent) =>
  e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;

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

/** The next frame, or a timer where there are no frames (tests, hidden pages). */
const requestFrame = (callback: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : (setTimeout(callback, 16) as unknown as number);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id);

/** Title changes reach the tab at most this often. */
export const TITLE_MS = 250;

/** Seconds a connection waits before the tab counts them and offers Ctrl+C to cancel. */
export const CONNECT_WAIT_SHOWN_S = 3;

/** The longest a new terminal waits for the fonts before starting its session. */
export const FONT_WAIT_MS = 1500;

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
  registerPaneShortcuts,
  aiSuggest,
  history = commandHistory,
  registerAssistTarget,
  onAskAi,
  onAttention,
  onPrompt,
  onCommand,
  onOutputQuiet,
  onActivity,
  fileLinks,
  registerSharePane,
}: TerminalViewProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const onAskAiRef = useRef(onAskAi);
  const fileLinksRef = useRef(fileLinks);
  fileLinksRef.current = fileLinks;
  /** The selection when the right button went down, read by the context menu handler. */
  const selectionAtRightDown = useRef<string | null>(null);
  onAskAiRef.current = onAskAi;
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const errorsRef = useRef<ErrorHighlight | null>(null);
  /** The user's highlight rules (Settings > Terminal), compiled once per change. */
  const rulesRef = useRef<RuleHighlight | null>(null);
  const compiledRulesRef = useRef(compileRules(settings.highlightRules));
  /** The commands the shell's marks delimit; empty without shell integration. */
  const blocksRef = useRef<CommandBlocks | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  /** The WebGL renderer while it draws this terminal; null means xterm's own (DOM) renderer. */
  const webglRef = useRef<WebglAddon | null>(null);
  /** Stops keeping the WebGL canvas at its exact size (exactCanvas.ts); null without WebGL. */
  const exactCanvasRef = useRef<(() => void) | null>(null);
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
  /** Sends data as if typed (set by the terminal effect), for keys the key handler translates. */
  const typedRef = useRef<(data: string) => void>(() => {});
  const [findOpen, setFindOpen] = useState(false);
  /** `output` is the output of the command under the click, when the shell marks its commands. */
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string; output: string | null } | null>(null);
  /** What the find bar opens with: the selection it was opened from, or nothing. */
  const [findText, setFindText] = useState("");
  /** Bumped when the bar must start again with `findText`; plain Ctrl+Shift+F keeps what is typed. */
  const [findSeed, setFindSeed] = useState(0);
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
  const callbacks = useRef({ onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget, aiSuggest, registerAssistTarget, onAttention, onPrompt, onCommand, onOutputQuiet, onActivity, registerSharePane });
  callbacks.current = { onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget, aiSuggest, registerAssistTarget, onAttention, onPrompt, onCommand, onOutputQuiet, onActivity, registerSharePane };
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
      // A thin bar, as in editors: the block covered a whole cell.
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily: cssFontFamily(settingsRef.current.fontFamily),
      fontSize: settingsRef.current.fontSize,
      fontWeight: settingsRef.current.fontWeight as FontWeight,
      fontWeightBold: boldWeight(settingsRef.current.fontWeight) as FontWeight,
      lineHeight: settingsRef.current.lineHeight,
      scrollback: 10000,
      theme: themeById(settingsRef.current.theme).theme,
      // Decorations, which colour the error lines, are still a proposed API in xterm.
      allowProposedApi: true,
      // Hyperlinks a program prints (OSC 8): web links and files open on Ctrl+click.
      linkHandler: createLinkHandler({
        openUrl: (url) => void openUrl(url).catch(() => {}),
        openFile: () => fileLinksRef.current?.open,
      }),
    });
    // xterm measures with Unicode 6 by default, where emoji take one cell; programs use the newer
    // tables (two cells), so every emoji shifted the rest of its line one column left.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(webLinkHandler((url) => void openUrl(url).catch(() => {}))));
    term.registerLinkProvider(
      createFileLinkProvider((y) => cellsOf(term.buffer.active.getLine(y - 1)), {
        resolve: (text) => fileLinksRef.current?.resolve(text) ?? Promise.resolve(null),
        open: (path) => fileLinksRef.current?.open(path),
      }),
    );
    const search = new SearchAddon();
    term.loadAddon(search);
    // Snapshots of a shared pane for the viewers who join.
    const serializer = new SerializeAddon();
    term.loadAddon(serializer);
    // Application shortcuts must not reach the shell (Ctrl+Shift+D would send Ctrl+D, i.e. EOF);
    // returning false lets the event bubble to the window listener without xterm handling it.
    // Find, copy, paste and the pane's menu actions (select all, clear, log…) are handled here.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown") latencyMark("K");
      if (acceptRef.current(e)) return false;
      // The assistant shortcut (S3) is the window's, like the app shortcuts below.
      if (matchesShortcut(e, settingsRef.current.assistantShortcut)) return false;
      const shortcut = shortcutFor(e, settingsRef.current.shortcuts);
      if (shortcut === null) {
        // xterm sends the same CR for Shift+Enter as for Enter, so AI command-line tools would
        // submit; a line feed (Ctrl+J) is their "new line" key and a shell's Enter.
        if (!shiftEnter(e) || !settingsRef.current.shiftEnterNewline) return true;
        if (e.type === "keydown") {
          e.preventDefault?.();
          typedRef.current("\n");
        }
        return false;
      }
      // Without prompts to jump to (no shell marks, a full-screen program) the keys stay the program's.
      const failedOnly = shortcut.type === "previousFailedCommand" || shortcut.type === "nextFailedCommand";
      if (
        (failedOnly || shortcut.type === "previousCommand" || shortcut.type === "nextCommand") &&
        !blocksRef.current?.canJump(failedOnly)
      ) {
        return true;
      }
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
    const errors = attachErrorHighlight(term, {
      enabled: () => settingsRef.current.errorHighlight,
      color: () => errorColor(themeById(settingsRef.current.theme).theme),
    });
    errorsRef.current = errors;
    const rules = attachRuleHighlight(term, {
      rules: () => compiledRulesRef.current,
      onNotify: (rule, line) =>
        callbacks.current.onAttention?.({
          title: t("terminal.ruleMatched", { pattern: settingsRef.current.highlightRules[rule]?.pattern ?? "" }),
          body: line,
        }),
    });
    rulesRef.current = rules;
    const blocks = attachCommandBlocks(term, {
      failedColor: () => errorColor(themeById(settingsRef.current.theme).theme),
      jumpColor: () => jumpColor(themeById(settingsRef.current.theme).theme),
      failedTitle: (code, ms) =>
        ms === null
          ? t("terminal.commandDot.exit", { code })
          : t("terminal.commandDot.exitTime", { code, duration: formatDuration(ms) }),
    });
    blocksRef.current = blocks;
    let errorsTimer: ReturnType<typeof setTimeout> | null = null;
    fitRef.current = fit;
    searchRef.current = search;

    const backend = backendFor(target);
    let sessionId: number | null = null;
    let disposed = false;
    /** Set when the session ended but its pane stays open (serial device gone, mosh-client failed). */
    let ended = false;
    /** While a network session is being opened: shows how long it has waited, and Ctrl+C cancels it. */
    let cancelConnect: (() => void) | null = null;
    /** The session's share tap, and the number of the last output written while it is shared. */
    let tap: number | null = null;
    let outputSeq = 0;
    /** Pauses reading the session while xterm has too much output still to parse. */
    const outputFlow = createOutputFlow((paused) => {
      if (tap !== null) void setTerminalFlow(tap, paused).catch(() => {});
    });
    const resizeListeners = new Set<(cols: number, rows: number) => void>();
    /** Macros waiting for output (S16.3). */
    const outputListeners = new Set<(text: string, echo?: boolean) => void>();
    /** A command was sent with Enter and its prompt has not been seen yet. */
    let awaitingPrompt = false;
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    /** `mark`: the shell marked its prompt (OSC 7, OSC 133) rather than its output going quiet. */
    const promptCame = (mark: boolean) => {
      awaitingPrompt = false;
      if (promptTimer) clearTimeout(promptTimer);
      promptTimer = null;
      callbacks.current.onPrompt?.(mark);
    };
    /** Output went quiet, for DEV mode (only while it listens). */
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    let activityTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTyped = -Infinity;
    /** Output arrived: working, unless it is the echo of a key and the pane was idle. */
    const active = () => {
      if (!activityTimer && performance.now() - lastTyped < ECHO_MS) return;
      if (activityTimer) clearTimeout(activityTimer);
      else callbacks.current.onActivity?.(true);
      activityTimer = setTimeout(() => {
        activityTimer = null;
        callbacks.current.onActivity?.(false);
      }, ACTIVITY_QUIET_MS);
    };

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
      // A host that does not answer keeps the tab waiting: after a moment a line under the message
      // counts the seconds and says Ctrl+C cancels, so the wait never looks like a frozen window.
      let waitLine = false;
      const since = performance.now();
      const ticker =
        target.type === "serial"
          ? null
          : setInterval(() => {
              if (disposed || ended) return;
              const seconds = Math.round((performance.now() - since) / 1000);
              if (seconds < CONNECT_WAIT_SHOWN_S) return;
              waitLine = true;
              term.write(`\x1b[2K\r\x1b[2m${t("terminal.view.stillConnecting", { seconds })}\x1b[0m`);
            }, 1000);
      const stopWaiting = () => {
        if (ticker) clearInterval(ticker);
        if (waitLine) term.write("\x1b[2K\r");
        waitLine = false;
        cancelConnect = null;
      };
      if (ticker) {
        cancelConnect = () => {
          stopWaiting();
          endKeepingPane(t("terminal.view.connectCancelled"));
        };
      }
      const options: StartOptions = {
        cols: term.cols,
        rows: term.rows,
        trustedFingerprint,
        jumps: jumpsRef.current,
        shellIntegration: settingsRef.current.shellIntegration,
        ...typedLogin.current,
      };
      backend
        .start(options, (event) => {
          // A disposed view (e.g. StrictMode's first mount) must not close the live tab.
          if (disposed) return;
          // Shared output is output like any other, numbered for the snapshots of the share.
          let msg = event;
          if (msg.event === "sharedOutput") {
            outputSeq = msg.data.seq;
            msg = { event: "output", data: msg.data.data };
          }
          if (msg.event === "tap") tap = msg.data;
          else if (msg.event === "output") {
            latencyMark("O", msg.data.length);
            term.write(msg.data, outputFlow.queued(msg.data.length));
            logRef.current?.write(msg.data);
            // The echo of a key in an idle pane is not a program at work.
            const echo = !activityTimer && performance.now() - lastTyped < ECHO_MS;
            outputListeners.forEach((listener) => listener(msg.data, echo));
            active();
            if (awaitingPrompt) {
              if (promptTimer) clearTimeout(promptTimer);
              promptTimer = setTimeout(() => promptCame(false), PROMPT_QUIET_MS);
            }
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = callbacks.current.onOutputQuiet
              ? setTimeout(() => {
                  quietTimer = null;
                  callbacks.current.onOutputQuiet?.(cursorRow().toCursor);
                }, PROMPT_QUIET_MS)
              : null;
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
          stopWaiting();
          if (disposed || ended) void backend.close(id).catch(() => {});
          else {
            sessionId = id;
            callbacks.current.onSession?.(id);
          }
        })
        .catch((raw) => {
          stopWaiting();
          // Cancelled with Ctrl+C: the pane already says so.
          if (disposed || ended) return;
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
    // It also waits for the fonts (at most FONT_WAIT_MS): a font that loads later changes the
    // cell size, and resizing a shell that is still starting can leave Windows PowerShell blank.
    const startTimer = setTimeout(() => {
      const fontsReady = typeof document !== "undefined" ? document.fonts?.ready : undefined;
      let waited: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<void>((resolve) => (waited = setTimeout(resolve, FONT_WAIT_MS)));
      void Promise.race([fontsReady ?? Promise.resolve(), timeout]).then(() => {
        if (waited) clearTimeout(waited);
        if (disposed) return;
        if (host.offsetParent !== null) fit.fit();
        start();
      });
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
    /** Where the command line starts (OSC 133 B) while it is typed; null when the shell gives no marks. */
    let inputStart: { marker: IMarker; col: number } | null = null;
    /**
     * The shell's prompt is up (A seen, no command running): only then does a B mark start the
     * command line, so one printed by a program or a file shown with `cat` is ignored.
     */
    let atPrompt = false;
    /** The last command line sent with Enter (never one typed at a password prompt), for its notice. */
    let lastSent = "";
    /** Between the shell's C and D marks: a command runs, and the folders it reports are not the shell's. */
    let commandRunning = false;
    const commandTimer = createCommandTimer();
    /** A long command finished: its tab is marked, and the desktop told while the window is away. */
    const commandNotice = (done: FinishedCommand): AttentionNotice => {
      const failed = done.exit !== null && done.exit !== 0;
      const command = shortCommand(done.command);
      const duration = formatDuration(done.ms);
      return {
        title: failed ? t("terminal.commandDone.failed", { code: done.exit! }) : t("terminal.commandDone.finished"),
        body: command ? `${command} · ${duration}` : duration,
      };
    };
    /** The command line as the shell's marks place it on screen, exact after Tab, arrows or Ctrl+R. */
    const markedLine = (): CommandLine | null => {
      if (!inputStart || inputStart.marker.isDisposed || fullScreen()) return null;
      const buffer = term.buffer.active;
      return typedLineAt(
        rowsOf(buffer, term.cols),
        { row: inputStart.marker.line, col: inputStart.col },
        { row: buffer.baseY + buffer.cursorY, col: buffer.cursorX },
      );
    };
    /**
     * Takes the typed line from the screen when the marks place it: always while the keys left it
     * uncertain, otherwise once the echo of the last key had time to arrive.
     */
    const syncMarkedLine = () => {
      if (!line.uncertain && performance.now() - lastTyped < ECHO_MS) return;
      const marked = markedLine();
      if (!marked || (!line.uncertain && marked.beforeCursor === line.text)) return;
      line = { text: marked.beforeCursor, uncertain: false };
      updateSuggestion();
    };

    const refreshGhost = () => {
      syncMarkedLine();
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
    /**
     * The ghost is drawn once per frame: a key, its echo and the cursor move arrive within a few
     * milliseconds, and each refresh measures the screen (a layout) and may re-render the pane.
     */
    let ghostFrame: number | null = null;
    let ghostPending = false;
    const scheduleGhost = () => {
      if (ghostPending) return;
      ghostPending = true;
      ghostFrame = requestFrame(() => {
        ghostPending = false;
        ghostFrame = null;
        refreshGhost();
      });
    };

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
            scheduleGhost();
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
      // What → would accept changes now, not at the next frame.
      ghostRestRef.current = null;
      scheduleGhost();
    };

    /** The prompt and command of the cursor's row, as they look on screen. */
    const onScreenCommand = () => {
      const buffer = term.buffer.active;
      return commandOnScreen(buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? "");
    };

    /** Follows the typed line and records the commands sent with Enter. */
    const track = (data: string) => {
      if (fullScreen()) {
        // vim, less, top...: nothing typed there is a command line.
        line = EMPTY_LINE;
      } else {
        // The prompt before the typed text, read before the line changes; only Enter needs it, and
        // reading the screen on every key costs two row reads.
        const enter = data.includes("\r") || data.includes("\n");
        const prompt = enter ? promptBefore(cursorRow().toCursor, line.text) : "";
        // A line recalled from history or completed with Tab is only known from the screen.
        // With the shell's marks, Enter sends exactly the line on screen.
        const marked = data === "\r" ? markedLine() : null;
        const recalled = !marked && line.uncertain && data.includes("\r") ? onScreenCommand() : null;
        const fed = feedInput(line, data);
        const result = marked ? { state: EMPTY_LINE, commits: [marked.text] } : fed;
        const secret = (result.commits.length > 0 || recalled !== null) && atSecretPrompt();
        if (result.commits.length > 0) awaitingPrompt = true;
        line = result.state;
        if (!secret) for (const command of result.commits) callbacks.current.onCommand?.(command, prompt);
        if (!secret && recalled && result.commits.length === 0) callbacks.current.onCommand?.(recalled.command, recalled.prompt);
        if (!secret && result.commits.length > 0) lastSent = result.commits[result.commits.length - 1];
        else if (!secret && recalled) lastSent = recalled.command;
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
      if (cancelConnect) {
        if (data.includes("\x03")) cancelConnect();
        return;
      }
      latencyMark("D", data.length);
      lastTyped = performance.now();
      write(data);
      callbacks.current.onInput?.(data);
      track(data);
    };
    typedRef.current = typed;
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

    const unregisterSharePane = callbacks.current.registerSharePane?.({
      tap: () => tap,
      size: () => ({ cols: term.cols, rows: term.rows }),
      snapshot: (history) => {
        // Everything written up to now (output `outputSeq` included) is parsed when this callback runs.
        const coversSeq = outputSeq;
        return new Promise((resolve) =>
          term.write("", () => {
            const screen = serializer.serialize({ scrollback: 0 });
            resolve(
              history === "screen"
                ? { coversSeq, screen: null, full: screen }
                : { coversSeq, screen, full: serializer.serialize({ scrollback: history }) },
            );
          }),
        );
      },
      inject: (data) => {
        // Like another pane's input: never recorded in this computer's history.
        write(data);
        line = feedExternal(line, data);
        updateSuggestion();
      },
      lineEmpty: () => {
        if (fullScreen() || atSecretPrompt()) return false;
        const marked = markedLine();
        if (marked) return marked.text === "";
        const row = cursorRow();
        const empty = line.uncertain ? promptOnlyOnScreen(row.toCursor) : line.text === "";
        return empty && !row.textAfter;
      },
      sharerTypedAt: () => lastTyped,
      atPassword: atSecretPrompt,
      fullScreen,
      onResize: (listener) => {
        resizeListeners.add(listener);
        return () => resizeListeners.delete(listener);
      },
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
      lineEmpty: () => {
        if (fullScreen() || atSecretPrompt()) return false;
        const marked = markedLine();
        if (marked) return marked.text === "";
        const row = cursorRow();
        // After Ctrl+L, arrows or Tab the typed line is uncertain: the screen tells whether only
        // the prompt is there.
        const empty = line.uncertain ? promptOnlyOnScreen(row.toCursor) : line.text === "";
        return empty && !row.textAfter;
      },
    });

    /** Reports a request for attention; the sequence is always consumed (xterm has no use for it). */
    const attention = (notice: AttentionNotice | null) => {
      if (notice) callbacks.current.onAttention?.(notice);
      return true;
    };
    const readOsc99 = createOsc99Reader();
    // AI tools animate their title many times a second; the tab bar needs a few of them.
    let titleTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTitle: string | null = null;
    const titleChanged = (title: string) => {
      if (titleTimer) {
        pendingTitle = title;
        return;
      }
      callbacks.current.onTitle(title);
      const flush = () => {
        titleTimer = null;
        if (pendingTitle === null) return;
        const latest = pendingTitle;
        pendingTitle = null;
        callbacks.current.onTitle(latest);
        titleTimer = setTimeout(flush, TITLE_MS);
      };
      titleTimer = setTimeout(flush, TITLE_MS);
    };
    /** The shell reported its folder (OSC 7 or 9;9); shells do it with every prompt. */
    const reportCwd = (path: string) => {
      // A program running in the terminal (an AI tool, an ssh session) may report its own folder:
      // with the shell's marks, only the shell's report at its prompt moves the Explorer.
      if (commandRunning) return;
      cwd = path;
      callbacks.current.onCwd?.(path);
      promptCame(true);
    };

    const subs = [
      term.onData(typed),
      term.onBell(() => attention({ title: null, body: null })),
      term.parser.registerOscHandler(9, (data) => {
        // 9;9 is the folder Windows shells report with every prompt (ConEmu, Windows Terminal).
        const folder = parseOsc9Cwd(data);
        if (folder === null) return attention(parseOsc9(data));
        reportCwd(folder);
        return true;
      }),
      term.parser.registerOscHandler(777, (data) => attention(parseOsc777(data))),
      term.parser.registerOscHandler(99, (data) => attention(readOsc99(data))),
      term.onWriteParsed(scheduleGhost),
      term.onWriteParsed(() => {
        latencyMark("P");
        latencyFrame();
      }),
      term.onCursorMove(scheduleGhost),
      term.onScroll(scheduleGhost),
      term.onResize(({ cols, rows }) => {
        if (sessionId !== null) void backend.resize(sessionId, cols, rows);
        resizeListeners.forEach((listener) => listener(cols, rows));
        // Rows reflow to the new width: colour them again once the size settles (a window drag
        // resizes many times in a row).
        if (errorsTimer) clearTimeout(errorsTimer);
        errorsTimer = setTimeout(() => {
          errorsTimer = null;
          errors.refresh();
          rules.refresh();
        }, ERROR_REFRESH_DELAY_MS);
      }),
      term.onTitleChange(titleChanged),
      term.parser.registerOscHandler(7, (data) => {
        const path = parseOsc7(data);
        if (path) reportCwd(path);
        else promptCame(true);
        return true;
      }),
      // Shell integration marks: A = prompt start, B = command line start, C = command runs,
      // D = command finished.
      term.parser.registerOscHandler(133, (data) => {
        const mark = parseOsc133(data);
        if (!mark) return true;
        blocks.mark(mark);
        if (mark.kind === "C") commandRunning = true;
        else if (mark.kind === "A" || mark.kind === "D") commandRunning = false;
        if (mark.kind === "C") commandTimer.started(lastSent);
        else if (mark.kind === "D") {
          const done = commandTimer.finished(mark.exit, settingsRef.current.commandNotifySeconds * 1000);
          if (done) callbacks.current.onAttention?.(commandNotice(done));
        }
        inputStart?.marker.dispose();
        inputStart = null;
        if (mark.kind !== "B") atPrompt = mark.kind === "A";
        else if (atPrompt) {
          const marker = term.registerMarker(0);
          if (marker) inputStart = { marker, col: term.buffer.active.cursorX };
        }
        if (mark.kind === "A" || mark.kind === "D") promptCame(true);
        return true;
      }),
    ];

    const observer = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit();
    });
    observer.observe(host);
    // A font that finishes loading after the first fit changes the cell size, not the pane's:
    // without fitting again the last rows would sit under the bar below the terminal.
    const refitForFonts = () => {
      if (host.offsetParent !== null) fit.fit();
    };
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", refitForFonts);
    void fonts?.ready?.then(refitForFonts);

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
      outputFlow.dispose();
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("mouseup", onMouseUp);
      // Closing the pane writes what the log still holds.
      void logRef.current?.stop();
      logRef.current = null;
      clearTimeout(startTimer);
      if (aiTimer) clearTimeout(aiTimer);
      aiSeq++;
      acceptRef.current = () => false;
      typedRef.current = () => {};
      unregisterWriter?.();
      unregisterMacroTarget?.();
      unregisterAssistTarget?.();
      unregisterSharePane?.();
      resizeListeners.clear();
      outputListeners.clear();
      observer.disconnect();
      if (titleTimer) clearTimeout(titleTimer);
      if (ghostPending && ghostFrame !== null) cancelFrame(ghostFrame);
      fonts?.removeEventListener?.("loadingdone", refitForFonts);
      subs.forEach((s) => s.dispose());
      if (errorsTimer) clearTimeout(errorsTimer);
      if (promptTimer) clearTimeout(promptTimer);
      if (quietTimer) clearTimeout(quietTimer);
      if (activityTimer) clearTimeout(activityTimer);
      errors.dispose();
      errorsRef.current = null;
      rules.dispose();
      rulesRef.current = null;
      blocks.dispose();
      blocksRef.current = null;
      // Disposed with the terminal.
      webglRef.current = null;
      exactCanvasRef.current?.();
      exactCanvasRef.current = null;
      if (sessionId !== null) void backend.close(sessionId);
      term.dispose();
    };
    // The target of a tab never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fits the rows and columns to the pane again, while it is shown. */
  const refit = () => {
    if (hostRef.current?.offsetParent !== null) fitRef.current?.fit();
  };

  // GPU acceleration: WebGL draws redraw-heavy programs (AI command-line tools, htop) smoothly. Without
  // WebGL2, or when the GPU drops the context (driver reset, sleep), xterm's own renderer takes over.
  const gpuAcceleration = settings.gpuAcceleration;
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (!gpuAcceleration) {
      exactCanvasRef.current?.();
      exactCanvasRef.current = null;
      webglRef.current?.dispose();
      webglRef.current = null;
    } else if (!webglRef.current && !softwareWebgl()) {
      // WebGL drawn by the processor (llvmpipe) is slower than xterm's own renderer.
      let addon: WebglAddon | null = null;
      try {
        addon = new WebglAddon();
        const loaded = addon;
        loaded.onContextLoss(() => {
          diagnosticEntry("warn", "terminal lost its WebGL context (GPU reset or sleep); xterm's renderer takes over");
          if (webglRef.current === loaded) {
            webglRef.current = null;
            exactCanvasRef.current?.();
            exactCanvasRef.current = null;
          }
          loaded.dispose();
          errorsRef.current?.refresh();
          refit();
        });
        term.loadAddon(loaded);
        webglRef.current = loaded;
        // At a fractional devicePixelRatio (WebKitGTK with Xft.dpi 110) xterm's rounded canvas size
        // would be resampled, blurring the text.
        if (term.element) exactCanvasRef.current = keepCanvasesExact(term.element);
      } catch (error) {
        diagnosticEntry("warn", `terminal WebGL renderer failed to start (${String(error)}); xterm's renderer is used`);
        addon?.dispose();
        webglRef.current = null;
      }
    }
    // Each renderer measures its cells its own way: the rows must fit the pane again.
    refit();
    // The error colours are decorations, drawn by whichever renderer is in use.
    errorsRef.current?.refresh();
  }, [gpuAcceleration]);

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

  // The text weight applies live, bold a step heavier.
  const fontWeight = settings.fontWeight;
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.fontWeight === fontWeight) return;
    term.options.fontWeight = fontWeight as FontWeight;
    term.options.fontWeightBold = boldWeight(fontWeight) as FontWeight;
  }, [fontWeight]);

  // The line height applies live; taller or shorter rows change how many fit in the pane.
  const lineHeight = settings.lineHeight;
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.lineHeight === lineHeight) return;
    term.options.lineHeight = lineHeight;
    if (hostRef.current?.offsetParent !== null) fitRef.current?.fit();
  }, [lineHeight]);

  // Colour scheme and font changes apply live too; a new font changes the cell size.
  const theme = themeById(settings.theme).theme;
  const fontFamily = cssFontFamily(settings.fontFamily);
  useEffect(() => {
    const term = termRef.current;
    if (!term || term.options.theme === theme) return;
    term.options.theme = theme;
    errorsRef.current?.refresh();
  }, [theme]);
  // Error lines follow the setting at once: coloured again when it is turned on, cleared when off.
  // New rules colour the whole buffer again (without notifying for what was already read).
  const highlightRules = settings.highlightRules;
  const highlightRulesSeen = useRef(highlightRules);
  useEffect(() => {
    if (highlightRulesSeen.current === highlightRules) return;
    highlightRulesSeen.current = highlightRules;
    compiledRulesRef.current = compileRules(highlightRules);
    rulesRef.current?.refresh();
  }, [highlightRules]);

  const errorHighlight = settings.errorHighlight;
  const errorHighlightSeen = useRef(errorHighlight);
  useEffect(() => {
    if (errorHighlightSeen.current === errorHighlight) return;
    errorHighlightSeen.current = errorHighlight;
    errorsRef.current?.refresh();
  }, [errorHighlight]);
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
      .catch(() => {
        // An image alone has no text to read; a program in bracketed paste mode still gets the paste.
        const term = termRef.current;
        if (term?.modes.bracketedPasteMode) pasteText("");
        else term?.write(red(t("terminal.view.clipboardError")));
      });
  };

  const copySelection = () => {
    const term = termRef.current;
    if (term?.hasSelection()) void writeText(term.getSelection()).catch(() => {});
  };

  /** Copies a command's output: the one under the menu's click, or the last command's. */
  const copyCommandOutput = (output = blocksRef.current?.outputAt() ?? null) => {
    if (output !== null) void writeText(output).catch(() => {});
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
    setFindText("");
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
      droppedNote: (count) => `\n${t("terminal.view.logDropped", { count })}\n`,
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

  /** Opens the find bar; with `text` (a selection) it starts again with that text. */
  const openFind = (text = "") => {
    if (text) {
      setFindText(text);
      setFindSeed((n) => n + 1);
    }
    setFindOpen(true);
  };

  const runMenuAction = (action: MenuAction) => {
    const term = termRef.current;
    const selection = menu?.selection ?? "";
    switch (action) {
      case "copy":
        copySelection();
        break;
      case "copyOutput":
        copyCommandOutput(menu?.output ?? null);
        break;
      case "askAi":
        // The chat takes the focus and the selection with it.
        return onAskAiRef.current?.();
      case "typeSelection":
        pasteText(selection);
        break;
      case "findSelection":
        return openFind(selection.split(/\r?\n/)[0]);
      case "openLink": {
        const url = linkOf(selection);
        if (url) void openUrl(url).catch(() => {});
        break;
      }
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
        return openFind();
      case "save":
        void saveOutput();
        break;
      case "log":
        void toggleLogging();
        break;
    }
    focusTerminal();
  };

  /** The pane's own shortcuts; the others are the window's. Menu actions run as from the menu. */
  const paneMenuActions: Partial<Record<Shortcut["type"], MenuAction>> = {
    selectAll: "selectAll",
    clear: "clear",
    saveOutput: "save",
    toggleLogging: "log",
    askAi: "askAi",
  };
  // The command palette runs this pane's actions as their keys would; the pane lives as long as its id.
  const registerPaneShortcutsRef = useRef(registerPaneShortcuts);
  useEffect(() => registerPaneShortcutsRef.current?.((shortcut) => paneShortcutRef.current(shortcut)), []);
  paneShortcutRef.current = (shortcut) => {
    const action = paneMenuActions[shortcut.type];
    if (action) runMenuAction(action);
    else if (shortcut.type === "find") openFind();
    else if (shortcut.type === "copy") copySelection();
    else if (shortcut.type === "paste") pasteFromClipboard();
    else if (shortcut.type === "previousCommand") blocksRef.current?.jump("previous");
    else if (shortcut.type === "nextCommand") blocksRef.current?.jump("next");
    else if (shortcut.type === "previousFailedCommand") blocksRef.current?.jump("previous", true);
    else if (shortcut.type === "nextFailedCommand") blocksRef.current?.jump("next", true);
    else if (shortcut.type === "copyCommandOutput") copyCommandOutput();
  };

  /**
   * Right click pastes, or opens the menu when that is turned off; Ctrl+right click always opens it
   * (S15.4), and so does a right click on selected text, with the selection's actions (S7).
   */
  /** The output of the command shown at viewport height `clientY`, when the shell marks its commands. */
  const outputUnder = (clientY: number) => {
    const term = termRef.current;
    const blocks = blocksRef.current;
    const screen = term?.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!term || !blocks || !screen || screen.height <= 0) return blocks?.outputAt() ?? null;
    const row = Math.floor(((clientY - screen.top) / screen.height) * term.rows);
    return blocks.outputAt(term.buffer.active.viewportY + Math.max(0, Math.min(row, term.rows - 1)));
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // The selection from before the click: on macOS xterm selects the word under a right click.
    const selection = selectionAtRightDown.current ?? "";
    selectionAtRightDown.current = null;
    if (settingsRef.current.rightClickPastes && !e.ctrlKey && !selection) pasteFromClipboard();
    else setMenu({ x: e.clientX, y: e.clientY, selection, output: outputUnder(e.clientY) });
  };

  return (
    <div className="terminal-pane" hidden={!active} ref={paneRef}>
      <div
        className="terminal-host"
        ref={hostRef}
        style={{ background: theme.background }}
        onMouseDownCapture={(e) => {
          if (e.button !== 2) return;
          const term = termRef.current;
          selectionAtRightDown.current = term?.hasSelection() ? term.getSelection() : "";
        }}
        onContextMenu={onContextMenu}
      />
      {ghost && (
        <div className="terminal-ghost" aria-hidden="true" style={ghost.style}>
          {ghost.text}
        </div>
      )}
      {findOpen && <FindBar key={findSeed} initialText={findText} onFind={find} onClose={closeFind} />}
      {menu && (
        <TerminalContextMenu
          x={menu.x}
          y={menu.y}
          logging={logPath !== null}
          selection={menu.selection}
          commandOutput={menu.output !== null}
          canAskAi={onAskAi !== undefined}
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
