import { invoke } from "@tauri-apps/api/core";
import { downloadDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";

/** Which way the files go, seen from this computer: `receive` when the remote runs `sz`. */
export type ZmodemDirection = "receive" | "send";

/** A ZMODEM transfer's offer or progress, as the `zmodem` terminal event carries it. */
export type ZmodemNotice =
  | { phase: "offer"; direction: ZmodemDirection }
  | { phase: "progress"; direction: ZmodemDirection; file: string; bytes: number; total: number | null }
  | { phase: "done"; direction: ZmodemDirection; files: string[] }
  | { phase: "cancelled"; direction: ZmodemDirection; files: string[] }
  | { phase: "failed"; direction: ZmodemDirection; message: string; files: string[] };

/** What the pane's transfer bar shows. */
export type ZmodemView =
  | { kind: "asking"; direction: ZmodemDirection }
  | { kind: "running"; direction: ZmodemDirection; file: string; bytes: number; total: number | null }
  | { kind: "done"; direction: ZmodemDirection; files: string[] }
  | { kind: "cancelled"; direction: ZmodemDirection }
  | { kind: "failed"; direction: ZmodemDirection; message: string };

export function zmodemView(notice: ZmodemNotice): ZmodemView {
  switch (notice.phase) {
    case "offer":
      return { kind: "asking", direction: notice.direction };
    case "progress":
      return {
        kind: "running",
        direction: notice.direction,
        file: notice.file,
        bytes: notice.bytes,
        total: notice.total,
      };
    case "done":
      return { kind: "done", direction: notice.direction, files: notice.files };
    case "cancelled":
      return { kind: "cancelled", direction: notice.direction };
    case "failed":
      return { kind: "failed", direction: notice.direction, message: notice.message };
  }
}

/** Turns ZMODEM detection on or off in every session (Settings → Terminal). */
export const setZmodemEnabled = (enabled: boolean) => invoke<void>("zmodem_enabled", { enabled });

/** Declines the offer of the session of share tap `tap`, or stops its transfer. */
export const zmodemCancel = (tap: number) => invoke<void>("zmodem_cancel", { tap });

/** The Downloads folder, where the folder picker opens; undefined when it cannot be read. */
async function downloads(): Promise<string | undefined> {
  try {
    const dir = await downloadDir();
    return typeof dir === "string" ? dir : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Answers an offer: asks the user for the folder to save into (receive) or the files to send,
 * then starts the transfer. Declined (the picker closed) tells the remote to stop and returns
 * false. Rejects with the backend's message when the transfer cannot start.
 */
export async function answerZmodemOffer(tap: number, direction: ZmodemDirection, title: string): Promise<boolean> {
  if (direction === "receive") {
    const folder = await open({ directory: true, multiple: false, defaultPath: await downloads(), title });
    if (typeof folder !== "string") {
      await zmodemCancel(tap);
      return false;
    }
    await invoke<void>("zmodem_receive", { tap, folder });
    return true;
  }
  const picked = await open({ directory: false, multiple: true, title });
  const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
  if (paths.length === 0) {
    await zmodemCancel(tap);
    return false;
  }
  await invoke<void>("zmodem_send", { tap, paths });
  return true;
}

/** The folder of a saved file's path (either separator). */
export function folderOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut > 0 ? path.slice(0, cut) : path;
}
