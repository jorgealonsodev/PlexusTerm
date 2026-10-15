import { useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cssFontFamily, DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
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
import { readText, writeText } from "./clipboard";
import { backendFor } from "./backend";
import { FindBar, type FindDirection, type FindOptions } from "./FindBar";
import { bufferText, type BufferLine } from "./output";
import { pastePlan } from "./paste";
import { PasteConfirm } from "./PasteConfirm";
import { createSessionLog, type SessionLog } from "./sessionLog";
import { TerminalContextMenu, type MenuAction } from "./TerminalContextMenu";
import { themeById } from "./themes";

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
}

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
  `${jumps[index].name} — jump host ${index + 1} of ${jumps.length}`;

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

const TEXT_FILTERS = [{ name: "Text", extensions: ["txt", "log"] }];

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
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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
  const callbacks = useRef({ onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget });
  callbacks.current = { onTitle, onExit, onCwd, onSession, onInput, registerWriter, onLogging, registerMacroTarget };

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
        term.write(red(describeSshError(err)));
        if (shouldAskAgain(jump.auth, err.error)) {
          setAskPassword({ jump: { index, label }, rejected: savedPasswordRejected(err.error) });
        }
      }
    };

    const start = (trustedFingerprint?: string) => {
      const via = jumpsRef.current.length ? ` via ${jumpsRef.current.map((j) => j.name).join(", ")}` : "";
      if (target.type === "ssh") term.write(`Connecting to ${targetTitle(target)}${via}...\r\n`);
      if (target.type === "mosh") {
        term.write(`Starting mosh-server on ${targetTitle(target.ssh)}${via} over SSH...\r\n`);
      }
      if (target.type === "serial") term.write(`Opening ${targetTitle(target)}...\r\n`);
      if (target.type === "telnet") {
        term.write("\x1b[33mTelnet is not encrypted.\x1b[0m\r\n");
        term.write(`Connecting to ${target.host}:${target.port}...\r\n`);
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
          else if (target.type === "serial") endKeepingPane("Session ended. Close this tab or open the port again.");
          else if (target.type === "mosh" && msg.data !== 0) {
            const code = msg.data === null ? "" : ` with code ${msg.data}`;
            endKeepingPane(`mosh-client exited${code}. Close this tab or open the session again.`);
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
            term.write(red(describeSshError(err)));
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
    const unregisterWriter = callbacks.current.registerWriter?.(write);
    /** The normal input path: typing, pastes and macros all go through it (multi-execution included). */
    const typed = (data: string) => {
      write(data);
      callbacks.current.onInput?.(data);
    };
    const unregisterMacroTarget = callbacks.current.registerMacroTarget?.({
      send: typed,
      subscribe: (listener) => {
        outputListeners.add(listener);
        return () => outputListeners.delete(listener);
      },
      notice: (text) => term.write(`\r\n${red(text)}`),
    });

    const subs = [
      term.onData(typed),
      term.onResize(({ cols, rows }) => sessionId !== null && void backend.resize(sessionId, cols, rows)),
      term.onTitleChange((title) => callbacks.current.onTitle(title)),
      term.parser.registerOscHandler(7, (data) => {
        const path = parseOsc7(data);
        if (path) callbacks.current.onCwd?.(path);
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
      unregisterWriter?.();
      unregisterMacroTarget?.();
      outputListeners.clear();
      observer.disconnect();
      subs.forEach((s) => s.dispose());
      if (sessionId !== null) void backend.close(sessionId);
      term.dispose();
    };
    // The target of a tab never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      .catch(() => termRef.current?.write(red("Could not read the clipboard.")));
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
    const path = await save({ defaultPath: "terminal-output.txt", filters: TEXT_FILTERS });
    if (!path) return;
    await invoke("save_text_file", { path, contents }).catch((err) =>
      termRef.current?.write(red(`Could not save the output: ${err}`)),
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
    const path = await save({ defaultPath: "session.log", filters: TEXT_FILTERS });
    if (!path || logRef.current || !termRef.current) return;
    const log = createSessionLog(path, (file, contents) => invoke("append_text_file", { path: file, contents }), {
      onError: (err) => {
        if (logRef.current !== log) return;
        termRef.current?.write(red(`Logging stopped: ${err}`));
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
    <div className="terminal-pane" hidden={!active}>
      <div
        className="terminal-host"
        ref={hostRef}
        style={{ background: theme.background }}
        onContextMenu={onContextMenu}
      />
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
            termRef.current?.write(red("Connection cancelled: host key not trusted."));
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
            termRef.current?.write(red("Connection cancelled."));
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
