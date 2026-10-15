import { Channel, invoke } from "@tauri-apps/api/core";
import type { SerialTarget } from "../sessions/types";
import type { TerminalBackend, TerminalEvent } from "../terminal/backend";

/** Serial devices detected on this machine (e.g. /dev/ttyUSB0 or COM3); listing never opens them. */
export function listSerialPorts(): Promise<string[]> {
  return invoke<string[]>("serial_list_ports");
}

export function serialBackend(target: SerialTarget): TerminalBackend {
  const { path, baud, dataBits, parity, stopBits, flow } = target;
  return {
    start: (_options, onEvent) => {
      const channel = new Channel<TerminalEvent>();
      channel.onmessage = onEvent;
      return invoke<number>("serial_open", {
        request: { path, baud, dataBits, parity, stopBits, flow },
        onEvent: channel,
      });
    },
    write: (id, data) => invoke<void>("serial_write", { id, data }),
    // A serial line has no window size.
    resize: () => Promise.resolve(),
    close: (id) => invoke<void>("serial_close", { id }),
  };
}
