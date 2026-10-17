import { t } from "../../i18n/i18n";
import { shellNameOf } from "../terminal/localShell";

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
  /** Device node or port name, e.g. /dev/ttyUSB0 or COM3. */
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

/** A Telnet connection (S17.1); Telnet is not encrypted. */
export interface TelnetTarget {
  type: "telnet";
  host: string;
  port: number;
}

/**
 * A Mosh session (S17.2): `ssh` is the login that starts `mosh-server` (with its jump hosts
 * and saved-password handling, like an SSH tab); `serverCommand` replaces the default one.
 */
export interface MoshTarget {
  type: "mosh";
  ssh: SshTarget;
  serverCommand?: string;
}

/**
 * A terminal on this machine. Missing or blank fields keep the defaults: the shell from
 * Settings (or the system's), no arguments, the home directory.
 */
export interface LocalTarget {
  type: "local";
  /** Shell to run: a full path or a name found on PATH. */
  program?: string;
  args?: string[];
  /** Starting directory; a leading `~` is the home directory. */
  cwd?: string;
}

export type SessionTarget = LocalTarget | SshTarget | SerialTarget | TelnetTarget | MoshTarget;

/** The SSH login of a target: its own for SSH, the one that starts the server for Mosh. */
export function sshLoginOf(target: SessionTarget): SshTarget | null {
  if (target.type === "ssh") return target;
  if (target.type === "mosh") return target.ssh;
  return null;
}

export function targetTitle(target: SessionTarget): string {
  switch (target.type) {
    case "local":
      return target.program?.trim() ? shellNameOf(target.program) : t("sessions.target.local");
    case "serial":
      return `${target.path} @ ${target.baud}`;
    case "telnet":
      return `telnet ${target.host}${target.port === 23 ? "" : `:${target.port}`}`;
    case "mosh":
      return `mosh ${target.ssh.username}@${target.ssh.host}`;
    case "ssh":
      return `${target.username}@${target.host}${target.port === 22 ? "" : `:${target.port}`}`;
  }
}
