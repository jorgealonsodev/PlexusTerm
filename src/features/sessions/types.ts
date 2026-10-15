export type SshAuth =
  | { method: "password"; password: string }
  | { method: "key"; path: string; passphrase?: string }
  | { method: "agent" };

export interface SshTarget {
  type: "ssh";
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
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
