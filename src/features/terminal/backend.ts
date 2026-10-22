import { Channel, invoke } from "@tauri-apps/api/core";
import type { JumpTarget, LocalTarget, PasswordStorage, SessionTarget, SshAuth, SshTarget } from "../sessions/types";
import { moshBackend } from "../mosh/moshBackend";
import { serialBackend } from "../serial/serialBackend";
import { telnetBackend } from "../telnet/telnetBackend";

export type TerminalEvent =
  /** First event: the session's share tap (see `share_start`). */
  | { event: "tap"; data: number }
  | { event: "output"; data: string }
  /** Output of a shared session, with its number for the pane's snapshots. */
  | { event: "sharedOutput"; data: { data: string; seq: number } }
  | { event: "exit"; data: number | null };

export interface StartOptions {
  cols: number;
  rows: number;
  /** SSH and Mosh (its SSH login) only: fingerprint the user accepted for an unknown host. */
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

/** Pauses or resumes reading the session of share tap `tap` (see `flowControl.ts`). */
export function setTerminalFlow(tap: number, paused: boolean) {
  return invoke<void>("terminal_flow", { tap, paused });
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

/** The PTY request of a local target; blank fields are left out so the backend uses its defaults. */
function localRequest({ program, args, cwd }: LocalTarget, cols: number, rows: number) {
  return {
    ...(program?.trim() ? { program: program.trim() } : {}),
    ...(args?.length ? { args } : {}),
    ...(cwd?.trim() ? { cwd: cwd.trim() } : {}),
    cols,
    rows,
  };
}

function localBackend(target: LocalTarget): TerminalBackend {
  return {
    start: ({ cols, rows }, onEvent) =>
      invoke<number>("pty_spawn", { request: localRequest(target, cols, rows), onEvent: channelFor(onEvent) }),
    ...commands("pty"),
  };
}

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
      return localBackend(target);
    case "ssh":
      return sshBackend(target);
    case "serial":
      return serialBackend(target);
    case "telnet":
      return telnetBackend(target);
    case "mosh":
      return moshBackend(target);
    case "shared":
      // A shared pane is drawn by SharedView, never by TerminalView.
      throw new Error("a shared pane has no terminal backend");
  }
}
