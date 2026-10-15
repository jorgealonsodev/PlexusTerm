import { Channel, invoke } from "@tauri-apps/api/core";
import type { SessionTarget, SshTarget } from "../sessions/types";

export type TerminalEvent =
  | { event: "output"; data: string }
  | { event: "exit"; data: number | null };

export interface StartOptions {
  cols: number;
  rows: number;
  /** SSH only: fingerprint the user accepted for an unknown host. */
  trustedFingerprint?: string;
}

/** One kind of terminal session (local PTY, SSH, ...) behind the Rust commands. */
export interface TerminalBackend {
  start(options: StartOptions, onEvent: (event: TerminalEvent) => void): Promise<number>;
  write(id: number, data: string): Promise<void>;
  resize(id: number, cols: number, rows: number): Promise<void>;
  close(id: number): Promise<void>;
}

function channelFor(onEvent: (event: TerminalEvent) => void) {
  const channel = new Channel<TerminalEvent>();
  channel.onmessage = onEvent;
  return channel;
}

function commands(prefix: "pty" | "ssh") {
  return {
    write: (id: number, data: string) => invoke<void>(`${prefix}_write`, { id, data }),
    resize: (id: number, cols: number, rows: number) =>
      invoke<void>(`${prefix}_resize`, { id, cols, rows }),
    close: (id: number) => invoke<void>(`${prefix}_close`, { id }),
  };
}

const localBackend: TerminalBackend = {
  start: ({ cols, rows }, onEvent) =>
    invoke<number>("pty_spawn", { request: { cols, rows }, onEvent: channelFor(onEvent) }),
  ...commands("pty"),
};

function sshBackend(target: SshTarget): TerminalBackend {
  return {
    start: ({ cols, rows, trustedFingerprint }, onEvent) =>
      invoke<number>("ssh_connect", {
        request: {
          host: target.host,
          port: target.port,
          username: target.username,
          auth: target.auth,
          cols,
          rows,
          trustedFingerprint: trustedFingerprint ?? null,
        },
        onEvent: channelFor(onEvent),
      }),
    ...commands("ssh"),
  };
}

export function backendFor(target: SessionTarget): TerminalBackend {
  return target.type === "local" ? localBackend : sshBackend(target);
}
