import { invoke } from "@tauri-apps/api/core";
import type { OpenWith, SftpEntry } from "../sftp/sftpClient";

/** Wrappers around the `local_*` commands; entries have the SFTP browser's shape. */
export const local = {
  home: () => invoke<string>("local_home"),
  list: (path: string) => invoke<SftpEntry[]>("local_list", { path }),
  stat: (path: string) => invoke<SftpEntry>("local_stat", { path }),
  mkdir: (path: string) => invoke<void>("local_mkdir", { path }),
  /** Creates an empty file; fails if it already exists. */
  createFile: (path: string) => invoke<void>("local_create_file", { path }),
  /** Never replaces an existing `to`. */
  rename: (from: string, to: string) => invoke<void>("local_rename", { from, to }),
  /** A folder is removed with everything inside it. */
  remove: (path: string, isDir: boolean) => invoke<void>("local_remove", { path, isDir }),
  chmod: (path: string, mode: number) => invoke<void>("local_chmod", { path, mode }),
  open: (path: string, openWith: OpenWith) => invoke<void>("local_open", { path, with: openWith }),
  /** Working folder of a local terminal's shell (pty id), or null when the system cannot tell. */
  shellCwd: (ptyId: number) => invoke<string | null>("pty_cwd", { id: ptyId }),
};

/** The commands reject with `cannot <action> <path>: <cause>`. */
export function describeLocalError(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
