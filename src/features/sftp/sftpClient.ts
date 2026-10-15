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
}

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
};

/** Text for an `sftp_*` rejection: `{ kind: "sftp", message }` or any `SshError`. */
export function describeSftpError(err: unknown): string {
  const parsed = toSshError(err) as { kind: string; message?: string };
  if (parsed.kind === "sftp") return parsed.message ?? "SFTP operation failed.";
  return describeSshError(toSshError(err));
}
