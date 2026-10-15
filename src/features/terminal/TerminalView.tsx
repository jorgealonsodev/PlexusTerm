import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { targetTitle, type SessionTarget } from "../sessions/types";
import { describeSshError, toSshError } from "../ssh/sshErrors";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { parseOsc7 } from "../sftp/osc7";
import { backendFor } from "./backend";
import { terminalTheme } from "./theme";

interface TerminalViewProps {
  target: SessionTarget;
  active: boolean;
  onTitle: (title: string) => void;
  onExit: (code: number | null) => void;
  /** Working directory reported by the shell through OSC 7. */
  onCwd?: (path: string) => void;
  /** Backend session id once connected, null when the session ends. */
  onSession?: (id: number | null) => void;
}

interface PendingHost {
  host: string;
  fingerprint: string;
  otherKnownKeys: string[];
}

const red = (text: string) => `\x1b[31m${text}\x1b[0m\r\n`;

/** One xterm.js instance bound to one backend session for its whole lifetime. */
export function TerminalView({ target, active, onTitle, onExit, onCwd, onSession }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const startRef = useRef<(trustedFingerprint?: string) => void>(() => {});
  const [pendingHost, setPendingHost] = useState<PendingHost | null>(null);
  // Keep callbacks current without re-creating the terminal.
  const callbacks = useRef({ onTitle, onExit, onCwd, onSession });
  callbacks.current = { onTitle, onExit, onCwd, onSession };

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
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const backend = backendFor(target);
    let sessionId: number | null = null;
    let disposed = false;

    const start = (trustedFingerprint?: string) => {
      if (target.type === "ssh") term.write(`Connecting to ${targetTitle(target)}...\r\n`);
      backend
        .start({ cols: term.cols, rows: term.rows, trustedFingerprint }, (msg) => {
          // A disposed view (e.g. StrictMode's first mount) must not close the live tab.
          if (disposed) return;
          if (msg.event === "output") term.write(msg.data);
          else {
            callbacks.current.onSession?.(null);
            callbacks.current.onExit(msg.data);
          }
        })
        .then((id) => {
          if (disposed) void backend.close(id);
          else {
            sessionId = id;
            callbacks.current.onSession?.(id);
          }
        })
        .catch((raw) => {
          if (disposed) return;
          const err = toSshError(raw);
          if (err.kind === "unknownHost") setPendingHost(err);
          else term.write(red(describeSshError(err)));
        });
    };
    startRef.current = start;
    start();

    const subs = [
      term.onData((data) => sessionId !== null && void backend.write(sessionId, data)),
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
    termRef.current?.focus();
  }, [active]);

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
    </div>
  );
}
