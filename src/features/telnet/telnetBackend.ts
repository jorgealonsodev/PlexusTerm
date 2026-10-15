import { Channel, invoke } from "@tauri-apps/api/core";
import type { TelnetTarget } from "../sessions/types";
import type { TerminalBackend, TerminalEvent } from "../terminal/backend";

/** Telnet sessions run in the Rust Telnet client (S17.1). */
export function telnetBackend(target: TelnetTarget): TerminalBackend {
  return {
    start: ({ cols, rows }, onEvent) => {
      const channel = new Channel<TerminalEvent>();
      channel.onmessage = onEvent;
      return invoke<number>("telnet_connect", {
        request: { host: target.host, port: target.port, cols, rows },
        onEvent: channel,
      });
    },
    write: (id, data) => invoke<void>("telnet_write", { id, data }),
    resize: (id, cols, rows) => invoke<void>("telnet_resize", { id, cols, rows }),
    close: (id) => invoke<void>("telnet_close", { id }),
  };
}
