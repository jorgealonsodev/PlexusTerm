import { Channel, invoke } from "@tauri-apps/api/core";
import type { MoshTarget } from "../sessions/types";
import type { TerminalBackend, TerminalEvent } from "../terminal/backend";

/**
 * Mosh sessions (S17.2): the backend starts `mosh-server` over the SSH login (start options
 * work as for SSH tabs: trusted fingerprint, typed password, jump hosts), then runs the local
 * `mosh-client` in a PTY, so the session is driven with the PTY commands.
 */
export function moshBackend(target: MoshTarget): TerminalBackend {
  const ssh = target.ssh;
  return {
    start: ({ cols, rows, trustedFingerprint, auth, storage, jumps }, onEvent) => {
      const channel = new Channel<TerminalEvent>();
      channel.onmessage = onEvent;
      return invoke<number>("mosh_connect", {
        request: {
          host: ssh.host,
          port: ssh.port,
          username: ssh.username,
          auth: auth ?? ssh.auth,
          cols,
          rows,
          trustedFingerprint: trustedFingerprint ?? null,
          jumps: jumps ?? ssh.jumps ?? [],
          serverCommand: target.serverCommand ?? null,
        },
        storage: storage ?? ssh.storage ?? null,
        onEvent: channel,
      });
    },
    write: (id, data) => invoke<void>("pty_write", { id, data }),
    resize: (id, cols, rows) => invoke<void>("pty_resize", { id, cols, rows }),
    close: (id) => invoke<void>("pty_close", { id }),
  };
}
