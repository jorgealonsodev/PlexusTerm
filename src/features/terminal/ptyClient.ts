import { Channel, invoke } from "@tauri-apps/api/core";

export type PtyEvent =
  | { event: "output"; data: string }
  | { event: "exit"; data: number | null };

export interface SpawnRequest {
  program?: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
}

/** Thin adapter over the Rust `pty_*` commands. */
export const ptyClient = {
  spawn(request: SpawnRequest, onEvent: (event: PtyEvent) => void): Promise<number> {
    const channel = new Channel<PtyEvent>();
    channel.onmessage = onEvent;
    return invoke<number>("pty_spawn", { request, onEvent: channel });
  },
  write: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  resize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  close: (id: number) => invoke<void>("pty_close", { id }),
};
