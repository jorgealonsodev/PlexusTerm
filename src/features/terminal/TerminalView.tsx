import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { shouldAskAgain, storageFor } from "../sessions/passwordFlow";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import { targetTitle, type PasswordStorage, type SessionTarget, type SshAuth } from "../sessions/types";
import { describeSerialError } from "../serial/serialSettings";
import { describeSshError, toSshError } from "../ssh/sshErrors";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { parseOsc7 } from "../sftp/osc7";
import { shortcutFor } from "../panes/shortcuts";
import { backendFor } from "./backend";
import { terminalTheme } from "./theme";

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
}

interface PendingHost {
  host: string;
  fingerprint: string;
  otherKnownKeys: string[];
}

const red = (text: string) => `\x1b[31m${text}\x1b[0m\r\n`;

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
}: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const startRef = useRef<(trustedFingerprint?: string) => void>(() => {});
  const [pendingHost, setPendingHost] = useState<PendingHost | null>(null);
  const [askPassword, setAskPassword] = useState(false);
  const typedLogin = useRef<TypedLogin | null>(null);
  /** The saved session whose keyring password this tab connects with, if any. */
  const savedLogin =
    target.type === "ssh" && target.auth.method === "storedPassword"
      ? { id: target.auth.sessionId, username: target.username, host: target.host, port: target.port }
      : null;
  // Keep callbacks current without re-creating the terminal.
  const callbacks = useRef({ onTitle, onExit, onCwd, onSession, onInput, registerWriter });
  callbacks.current = { onTitle, onExit, onCwd, onSession, onInput, registerWriter };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace',
      fontSize: 14,
      lineHeight: 1.15,
      scrollback: 10000,
      theme: terminalTheme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    // Application shortcuts must not reach the shell (Ctrl+Shift+D would send Ctrl+D, i.e. EOF);
    // returning false lets the event bubble to the window listener without xterm handling it.
    term.attachCustomKeyEventHandler((e) => shortcutFor(e) === null);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const backend = backendFor(target);
    let sessionId: number | null = null;
    let disposed = false;
    /** Set when a serial device went away: the pane stays open so its error remains readable. */
    let ended = false;

    const endSerial = () => {
      ended = true;
      term.write("\r\n[Session ended. Close this tab or open the port again.]\r\n");
      if (sessionId !== null) void backend.close(sessionId).catch(() => {});
      sessionId = null;
      callbacks.current.onSession?.(null);
    };

    const start = (trustedFingerprint?: string) => {
      if (target.type === "ssh") term.write(`Connecting to ${targetTitle(target)}...\r\n`);
      if (target.type === "serial") term.write(`Opening ${targetTitle(target)}...\r\n`);
      backend
        .start({ cols: term.cols, rows: term.rows, trustedFingerprint, ...typedLogin.current }, (msg) => {
          // A disposed view (e.g. StrictMode's first mount) must not close the live tab.
          if (disposed) return;
          if (msg.event === "output") term.write(msg.data);
          else if (target.type === "serial") endSerial();
          else {
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
          if (target.type === "serial") {
            term.write(red(describeSerialError(raw)));
            return;
          }
          const err = toSshError(raw);
          const auth = typedLogin.current?.auth ?? (target.type === "ssh" ? target.auth : null);
          if (auth && shouldAskAgain(auth, err)) {
            term.write(red(describeSshError(err)));
            setAskPassword(true);
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

    const subs = [
      term.onData((data) => {
        write(data);
        callbacks.current.onInput?.(data);
      }),
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

    return () => {
      disposed = true;
      clearTimeout(startTimer);
      unregisterWriter?.();
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

  return (
    <div className="terminal-pane" hidden={!active}>
      <div className="terminal-host" ref={hostRef} />
      {pendingHost && (
        <HostKeyPrompt
          host={pendingHost.host}
          fingerprint={pendingHost.fingerprint}
          otherKnownKeys={pendingHost.otherKnownKeys}
          onTrust={() => {
            setPendingHost(null);
            startRef.current(pendingHost.fingerprint);
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
          label={targetTitle(target)}
          remember={{ initial: true }}
          onSubmit={(password, remember) => {
            setAskPassword(false);
            typedLogin.current = {
              auth: { method: "password", password },
              storage: storageFor(savedLogin, remember, true),
            };
            startRef.current();
            termRef.current?.focus();
          }}
          onCancel={() => {
            setAskPassword(false);
            termRef.current?.write(red("Connection cancelled."));
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
