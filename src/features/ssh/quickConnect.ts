import { t } from "../../i18n/i18n";
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
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(host);
  if (bracketed) {
    // [IPv6] or [IPv6]:port
    host = bracketed[1];
    portText = portText || (bracketed[2] ?? "");
  } else if ((host.match(/:/g) ?? []).length === 1) {
    // host:port; a bare IPv6 address (several colons) carries no port.
    const [name, port] = host.split(":");
    host = name;
    portText = portText || port;
  }

  if (!host) return fail(t("sessions.form.hostRequired"));
  if (!username) return fail(t("sessions.form.usernameRequired"));
  const port = portText ? parsePort(portText) : 22;
  if (port === null) return fail(t("sessions.form.portRange"));

  let auth: SshAuth;
  switch (form.method) {
    case "password":
      auth = { method: "password", password: form.password };
      break;
    case "key":
      if (!form.keyPath.trim()) return fail(t("sessions.form.keyPathRequired"));
      auth = { method: "key", path: form.keyPath.trim() };
      if (form.passphrase) auth.passphrase = form.passphrase;
      break;
    case "agent":
      auth = { method: "agent" };
      break;
  }

  return { ok: true, target: { type: "ssh", host, port, username, auth } };
}
