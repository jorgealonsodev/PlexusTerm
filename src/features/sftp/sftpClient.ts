import { invoke } from "@tauri-apps/api/core";
import { describeSshError, toSshError } from "../ssh/sshErrors";

/** Mirrors the Rust `sftp::Entry`. */
export interface SftpEntry {
  name: string;
  path: string;
  kind: "file" | "dir" | "symlink";
  size: number;
  /** Unix seconds. */
  modified: number | null;
  permissions: number | null;
  /** Owner ids, and names only when the server sends them. */
  uid: number | null;
  gid: number | null;
  user: string | null;
  group: string | null;
}

/** Mirrors the Rust `sftp::commands::OpenWith`. */
export type OpenWith =
  | { kind: "default" }
  /** `command`: the text editor chosen in Settings; without it, the system's default one. */
  | { kind: "textEditor"; command?: string }
  | { kind: "program"; path: string };

/** Payload of the `sftp-edit-saved` event: a temporary copy opened for editing was saved. */
export interface EditSaved {
  id: number;
  remote: string;
  local: string;
}

export const EDIT_SAVED_EVENT = "sftp-edit-saved";

/** Wrappers around the `sftp_*` commands; `id` is the SSH terminal session id. */
export const sftp = {
  home: (id: number) => invoke<string>("sftp_home", { id }),
  list: (id: number, path: string) => invoke<SftpEntry[]>("sftp_list", { id, path }),
  download: (id: number, remote: string, local: string) =>
    invoke<void>("sftp_download", { id, remote, local }),
  /** Resolves to the remote path of the uploaded file. */
  upload: (id: number, local: string, remoteDir: string) =>
    invoke<string>("sftp_upload", { id, local, remoteDir }),
  mkdir: (id: number, path: string) => invoke<void>("sftp_mkdir", { id, path }),
  remove: (id: number, path: string, isDir: boolean) => invoke<void>("sftp_remove", { id, path, isDir }),
  rename: (id: number, from: string, to: string) => invoke<void>("sftp_rename", { id, from, to }),
  chmod: (id: number, path: string, mode: number) => invoke<void>("sftp_chmod", { id, path, mode }),
  /** Downloads `remote` to a private temporary copy, opens it and watches it; resolves to the copy's path. */
  edit: (id: number, remote: string, openWith: OpenWith) => invoke<string>("sftp_edit", { id, remote, with: openWith }),
  /** Uploads the saved temporary copy of `remote` back to `remote`. */
  editUpload: (id: number, remote: string) => invoke<void>("sftp_edit_upload", { id, remote }),
  /** Opens a temporary copy of `remote` and the local file `local` in a diff tool. */
  compare: (id: number, remote: string, local: string) => invoke<void>("sftp_compare", { id, remote, local }),
  /** Deletes the temporary copies of a session (when the SSH session ends). */
  discardCopies: (id: number) => invoke<void>("sftp_discard_copies", { id }),
};

/** Text for an `sftp_*` rejection: `{ kind: "sftp", message }` or any `SshError`. */
export function describeSftpError(err: unknown): string {
  const parsed = toSshError(err) as { kind: string; message?: string };
  if (parsed.kind === "sftp") return parsed.message ?? "SFTP operation failed.";
  return describeSshError(toSshError(err));
}
