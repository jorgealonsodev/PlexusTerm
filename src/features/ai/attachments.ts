import { invoke } from "@tauri-apps/api/core";
import type { PathOrigin } from "../drop/pathDrag";

/** Files attached to one question (the backend keeps the same limit). */
export const MAX_ATTACHED_FILES = 5;

/** A file's text, or a folder's listing, attached to the next AI question (S6). */
export interface AttachedText {
  path: string;
  content: string;
  /** Only the first 64 KiB were read. */
  truncated: boolean;
}

/** Reads a dropped file from the local disk or from the SFTP session it was dragged from. */
export function readAttachment(origin: PathOrigin, path: string): Promise<AttachedText> {
  return origin.kind === "local"
    ? invoke<AttachedText>("local_read_text", { path })
    : invoke<AttachedText>("sftp_read_text", { id: origin.sessionId, path });
}

/** The commands reject with `cannot attach|read <path>: <cause>` or an `{ message }` SFTP error. */
export function describeAttachError(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

/** The last part of a local or remote path. */
export const fileName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
