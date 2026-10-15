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

export type SessionTarget = { type: "local" } | SshTarget;

export function targetTitle(target: SessionTarget): string {
  if (target.type === "local") return "Local shell";
  const port = target.port === 22 ? "" : `:${target.port}`;
  return `${target.username}@${target.host}${port}`;
}
