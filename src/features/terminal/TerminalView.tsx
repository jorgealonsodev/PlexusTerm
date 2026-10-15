import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { ptyClient } from "./ptyClient";
import { terminalTheme } from "./theme";

interface TerminalViewProps {
  active: boolean;
  onTitle: (title: string) => void;
  onExit: (code: number | null) => void;
}

/** One xterm.js instance bound to one local PTY for its whole lifetime. */
export function TerminalView({ active, onTitle, onExit }: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  // Keep callbacks current without re-creating the terminal.
  const callbacks = useRef({ onTitle, onExit });
  callbacks.current = { onTitle, onExit };

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

    let ptyId: number | null = null;
    let disposed = false;

    ptyClient
      .spawn({ cols: term.cols, rows: term.rows }, (msg) => {
        // A disposed view (e.g. StrictMode's first mount) must not close the live tab.
        if (disposed) return;
        if (msg.event === "output") term.write(msg.data);
        else callbacks.current.onExit(msg.data);
      })
      .then((id) => {
        if (disposed) void ptyClient.close(id);
        else ptyId = id;
      })
      .catch((err) => term.write(`\r\n\x1b[31mFailed to start shell: ${err}\x1b[0m\r\n`));

    const subs = [
      term.onData((data) => ptyId !== null && void ptyClient.write(ptyId, data)),
      term.onResize(({ cols, rows }) => ptyId !== null && void ptyClient.resize(ptyId, cols, rows)),
      term.onTitleChange((title) => callbacks.current.onTitle(title)),
    ];

    const observer = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit();
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      subs.forEach((s) => s.dispose());
      if (ptyId !== null) void ptyClient.close(ptyId);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    termRef.current?.focus();
  }, [active]);

  return <div className="terminal-host" ref={hostRef} hidden={!active} />;
}
