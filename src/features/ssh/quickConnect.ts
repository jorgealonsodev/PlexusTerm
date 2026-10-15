import type { SshAuth, SshTarget } from "../sessions/types";

export interface QuickConnectForm {
  host: string;
  port: string;
  username: string;
  method: "password" | "key" | "agent";
  password: string;
  keyPath: string;
  passphrase: string;
}

export type QuickConnectResult = { ok: true; target: SshTarget } | { ok: false; error: string };

const fail = (error: string): QuickConnectResult => ({ ok: false, error });

function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Validates the quick-connect form; the host field also accepts `user@host:port`. */
export function parseQuickConnect(form: QuickConnectForm): QuickConnectResult {
  let host = form.host.trim();
  let username = form.username.trim();
  let portText = form.port.trim();

  const at = host.lastIndexOf("@");
  if (at !== -1) {
    username = username || host.slice(0, at);
    host = host.slice(at + 1);
  }
  const hostPort = /^(.+):(\d+)$/.exec(host);
  if (hostPort) {
    host = hostPort[1];
    portText = portText || hostPort[2];
  }

  if (!host) return fail("Host is required");
  if (!username) return fail("Username is required");
  const port = portText ? parsePort(portText) : 22;
  if (port === null) return fail("Port must be a number between 1 and 65535");

  let auth: SshAuth;
  switch (form.method) {
    case "password":
      auth = { method: "password", password: form.password };
      break;
    case "key":
      if (!form.keyPath.trim()) return fail("Private key path is required");
      auth = { method: "key", path: form.keyPath.trim() };
      if (form.passphrase) auth.passphrase = form.passphrase;
      break;
    case "agent":
      auth = { method: "agent" };
      break;
  }

  return { ok: true, target: { type: "ssh", host, port, username, auth } };
}
