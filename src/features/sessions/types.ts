export type SshAuth =
  | { method: "password"; password: string }
  | { method: "key"; path: string; passphrase?: string }
  | { method: "agent" }
  /** The password saved in the system keyring for this saved session; read by the backend only. */
  | { method: "storedPassword"; sessionId: string };

/** What the backend does with a session's saved password once a login succeeded. */
export type PasswordStorage =
  | { action: "remember"; sessionId: string; label: string }
  | { action: "forget"; sessionId: string };

export interface SshTarget {
  type: "ssh";
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  /** Applied after a successful login with a typed password. */
  storage?: PasswordStorage;
  /** Jump hosts to go through, outermost first (S14). */
  jumps?: JumpTarget[];
}

/**
 * One jump host on the way to an SSH target, sent to the backend as is
 * (`jumps` of the Rust `SshTarget`/`ConnectRequest`).
 */
export interface JumpTarget {
  /** Saved session name, shown in errors and prompts. */
  name: string;
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
  /** Fingerprint the user accepted for this hop when it was unknown. */
  trustedFingerprint?: string;
  /** Applied to this hop's saved password after its login succeeded. */
  storage?: PasswordStorage;
}

export type SerialParity = "none" | "odd" | "even";
export type SerialFlow = "none" | "software" | "hardware";

/** Line settings of a serial console (e.g. 115200 8N1). */
export interface SerialSettings {
  /** Device node, e.g. /dev/ttyUSB0. */
  path: string;
  baud: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: SerialParity;
  stopBits: 1 | 2;
  flow: SerialFlow;
}

export interface SerialTarget extends SerialSettings {
  type: "serial";
}

export type SessionTarget = { type: "local" } | SshTarget | SerialTarget;

export function targetTitle(target: SessionTarget): string {
  if (target.type === "local") return "Local shell";
  if (target.type === "serial") return `${target.path} @ ${target.baud}`;
  const port = target.port === 22 ? "" : `:${target.port}`;
  return `${target.username}@${target.host}${port}`;
}
