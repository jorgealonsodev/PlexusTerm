import { invoke } from "@tauri-apps/api/core";
import type { OpenWith, SftpEntry } from "../sftp/sftpClient";
import type { GitStatusEntry } from "../files/gitStatus";

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
  /** Git status of the files under a folder (paths relative to it); empty outside a repository. */
  gitStatus: (path: string) => invoke<GitStatusEntry[]>("git_status", { path }),
  /** A text file's content (the first part of a long file). */
  readText: (path: string) => invoke<{ content: string }>("local_read_text", { path }).then((file) => file.content),
  /** Writes a text file, replacing it. */
  saveText: (path: string, contents: string) => invoke<void>("save_text_file", { path, contents }),
};

/** The commands reject with `cannot <action> <path>: <cause>`. */
export function describeLocalError(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
