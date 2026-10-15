import { invoke } from "@tauri-apps/api/core";
import type { SshTarget } from "../../sessions/types";

/** Key types and sizes the backend generates (Rust `KeyType`). */
export type KeyType = "ed25519" | "rsa-2048" | "rsa-3072" | "rsa-4096" | "ecdsa-p256" | "ecdsa-p384" | "ecdsa-p521";

/** Public half of a key kept by the backend; the private key never leaves it. */
export interface GeneratedKey {
  id: number;
  /** One `authorized_keys` line: `ssh-ed25519 AAAA... comment`. */
  publicKey: string;
  /** `SHA256:...`. */
  fingerprint: string;
  comment: string;
  /** `ED25519`, `RSA 3072`, `ECDSA P-256`... */
  keyType: string;
  /** Whether the private key is saved protected by a passphrase. */
  encrypted: boolean;
}

/** Mirrors the Rust `KeygenError` (`#[serde(tag = "kind")]`). */
export type KeygenError =
  | { kind: "invalid"; message: string }
  | { kind: "exists"; path: string }
  | { kind: "unknownKey" }
  | { kind: "io"; message: string }
  | { kind: "passphraseRequired" }
  | { kind: "wrongPassphrase" };

export type InstallOutcome = "added" | "alreadyPresent";

export function isKeygenError(err: unknown): err is KeygenError {
  return typeof err === "object" && err !== null && typeof (err as { kind?: unknown }).kind === "string";
}

export function describeKeygenError(err: unknown): string {
  if (!isKeygenError(err)) return String(err);
  switch (err.kind) {
    case "exists":
      return `${err.path} already exists.`;
    case "unknownKey":
      return "The key is no longer available; generate or load it again.";
    case "passphraseRequired":
      return "The key is protected by a passphrase.";
    case "wrongPassphrase":
      return "Wrong passphrase.";
    case "invalid":
    case "io":
      return err.message;
  }
}

export const generateKey = (keyType: KeyType, passphrase: string | null, comment: string) =>
  invoke<GeneratedKey>("keygen_generate", { keyType, passphrase, comment });

/** Reads a private key file (OpenSSH or PuTTY .ppk) in the backend. */
export const loadKey = (path: string, passphrase: string | null) =>
  invoke<GeneratedKey>("keygen_load", { path, passphrase });

/** Sets the comment and passphrase (`null` removes it) of key `id`. */
export const updateKey = (id: number, comment: string, passphrase: string | null) =>
  invoke<GeneratedKey>("keygen_update", { id, comment, passphrase });

/** Where a key is saved: public key (0644), OpenSSH private key or PuTTY .ppk (0600). */
export type SaveKind = "public" | "private" | "ppk";

const SAVE_COMMANDS: Record<SaveKind, string> = {
  public: "keygen_save_public",
  private: "keygen_save_private",
  ppk: "keygen_export_ppk",
};

/** Writes one file; rejects with `exists` unless `overwrite`. */
export const saveKeyFile = (kind: SaveKind, id: number, path: string, overwrite: boolean) =>
  invoke<void>(SAVE_COMMANDS[kind], { id, path, overwrite });

export const installKey = (id: number, target: SshTarget, trustedFingerprint: string | null) =>
  invoke<InstallOutcome>("keygen_install", { id, target, trustedFingerprint });

export const discardKey = (id: number) => invoke<void>("keygen_discard", { id });
