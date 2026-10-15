import { Channel, invoke } from "@tauri-apps/api/core";
import type { JumpTarget, PasswordStorage, SessionTarget, SshAuth, SshTarget } from "../sessions/types";
import { serialBackend } from "../serial/serialBackend";

export type TerminalEvent =
  | { event: "output"; data: string }
  | { event: "exit"; data: number | null };

export interface StartOptions {
  cols: number;
  rows: number;
  /** SSH only: fingerprint the user accepted for an unknown host. */
  trustedFingerprint?: string;
  /** SSH only: replaces the target's auth (e.g. a password typed after the saved one failed). */
  auth?: SshAuth;
  /** SSH only: replaces the target's saved-password request. */
  storage?: PasswordStorage;
  /** SSH only: replaces the target's jump hosts (e.g. after trusting one of them). */
  jumps?: JumpTarget[];
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
    start: ({ cols, rows, trustedFingerprint, auth, storage, jumps }, onEvent) =>
      invoke<number>("ssh_connect", {
        request: {
          host: target.host,
          port: target.port,
          username: target.username,
          auth: auth ?? target.auth,
          cols,
          rows,
          trustedFingerprint: trustedFingerprint ?? null,
          jumps: jumps ?? target.jumps ?? [],
        },
        storage: storage ?? target.storage ?? null,
        onEvent: channelFor(onEvent),
      }),
    ...commands("ssh"),
  };
}

export function backendFor(target: SessionTarget): TerminalBackend {
  switch (target.type) {
    case "local":
      return localBackend;
    case "ssh":
      return sshBackend(target);
    case "serial":
      return serialBackend(target);
  }
}
