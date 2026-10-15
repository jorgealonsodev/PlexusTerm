import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { patchJump } from "../sessions/jumpHosts";
import { shouldAskAgain, storageFor } from "../sessions/passwordFlow";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import { targetTitle, type JumpTarget, type PasswordStorage, type SessionTarget, type SshAuth } from "../sessions/types";
import { describeSerialError } from "../serial/serialSettings";
import { describeSshError, toSshError, type SshError } from "../ssh/sshErrors";
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
  /** Set when the host is a jump host. */
  jump?: { index: number; label: string };
}

/** Which login the password prompt is for: the target, or jump host `index`. */
type PasswordFor = { jump: null } | { jump: { index: number; label: string } };

/** "bastion — jump host 1 of 2" */
const jumpLabel = (jumps: JumpTarget[], index: number) =>
  `${jumps[index].name} — jump host ${index + 1} of ${jumps.length}`;

/** The saved session whose keyring password a login uses, if any. */
const savedLoginOf = (where: { host: string; port: number; username: string; auth: SshAuth }) =>
  where.auth.method === "storedPassword"
    ? { id: where.auth.sessionId, username: where.username, host: where.host, port: where.port }
    : null;

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
  const [askPassword, setAskPassword] = useState<PasswordFor | null>(null);
  const typedLogin = useRef<TypedLogin | null>(null);
  /** Jump hosts, updated when one of them is trusted or gets a typed password. */
  const jumpsRef = useRef<JumpTarget[]>(target.type === "ssh" ? (target.jumps ?? []) : []);
  /** The saved session whose keyring password the prompted login replaces, if any. */
  const savedLogin =
    askPassword?.jump != null
      ? savedLoginOf(jumpsRef.current[askPassword.jump.index])
      : target.type === "ssh"
        ? savedLoginOf(target)
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

    /** Handles a failure of jump host `err.hop`: trust prompt, password prompt or message. */
    const jumpFailed = (err: Extract<SshError, { kind: "hop" }>) => {
      const index = err.hop - 1;
      const jump = jumpsRef.current[index];
      if (!jump) return term.write(red(describeSshError(err)));
      const label = jumpLabel(jumpsRef.current, index);
      if (err.error.kind === "unknownHost") setPendingHost({ ...err.error, jump: { index, label } });
      else {
        term.write(red(describeSshError(err)));
        if (shouldAskAgain(jump.auth, err.error)) setAskPassword({ jump: { index, label } });
      }
    };

    const start = (trustedFingerprint?: string) => {
      if (target.type === "ssh") {
        const via = jumpsRef.current.length ? ` via ${jumpsRef.current.map((j) => j.name).join(", ")}` : "";
        term.write(`Connecting to ${targetTitle(target)}${via}...\r\n`);
      }
      if (target.type === "serial") term.write(`Opening ${targetTitle(target)}...\r\n`);
      backend
        .start({ cols: term.cols, rows: term.rows, trustedFingerprint, jumps: jumpsRef.current, ...typedLogin.current }, (msg) => {
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
          if (err.kind === "hop") return jumpFailed(err);
          const auth = typedLogin.current?.auth ?? (target.type === "ssh" ? target.auth : null);
          if (auth && shouldAskAgain(auth, err)) {
            term.write(red(describeSshError(err)));
            setAskPassword({ jump: null });
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
          label={askPassword.jump?.label ?? targetTitle(target)}
          remember={{ initial: true }}
          onSubmit={(password, remember) => {
            setAskPassword(null);
            const login = { auth: { method: "password" as const, password }, storage: storageFor(savedLogin, remember, true) };
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
