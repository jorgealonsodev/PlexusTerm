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
  /** Moves a file or folder into the folder `dir`; never replaces an entry. Resolves to its new path. */
  move: (from: string, dir: string) => invoke<string>("local_move", { from, dir }),
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
  /** The git repository of a file or folder: its folder, branch and whether it has changes; null outside one. */
  repoInfo: (path: string) => invoke<{ root: string; branch: string; dirty: boolean } | null>("git_repo", { path }),
  /** A text file for the file viewer (the first 4 MiB). */
  viewText: (path: string) => invoke<{ path: string; content: string; truncated: boolean }>("local_view_text", { path }),
  /** Saves the viewer's text over a file that still holds `expected` (the text the edits started from). */
  writeText: (path: string, expected: string, content: string) =>
    invoke<void>("local_write_text", { path, expected, content }),
  /** Writes a text file, replacing it. */
  saveText: (path: string, contents: string) => invoke<void>("save_text_file", { path, contents }),
};

/** The commands reject with `cannot <action> <path>: <cause>`. */
export function describeLocalError(err: unknown): string {
  return typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
}
