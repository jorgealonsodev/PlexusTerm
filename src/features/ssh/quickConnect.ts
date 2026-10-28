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
  forwardAgent: boolean;
  /** Keep the shell in tmux session `tmuxSession` (blank: {@link DEFAULT_TMUX_SESSION}). */
  tmux: boolean;
  tmuxSession: string;
  /** Local command that carries the connection instead of TCP (blank: none); see {@link isProxyCommand}. */
  proxyCommand: string;
}

/** The tmux session a tab is kept in when its name is left blank. */
export const DEFAULT_TMUX_SESSION = "plexus";

/** Letters, digits, `.`, `_` and `-`, 64 at most: the names the backend accepts (`valid_tmux_session`). */
export const isTmuxSessionName = (name: string) => /^[A-Za-z0-9._-]{1,64}$/.test(name);

/** Longest proxy command, as the backend accepts it (`MAX_PROXY_COMMAND`). */
export const MAX_PROXY_COMMAND = 2000;

/**
 * Whether `value` may be a proxy command: one line (no control characters) of 1 to
 * {@link MAX_PROXY_COMMAND} characters, already trimmed. The backend runs it with the platform shell.
 */
export const isProxyCommand = (value: string) =>
  value.length >= 1 &&
  value.length <= MAX_PROXY_COMMAND &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(value);

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

  const tmuxSession = form.tmuxSession.trim() || DEFAULT_TMUX_SESSION;
  if (form.tmux && !isTmuxSessionName(tmuxSession)) return fail(t("sessions.form.tmuxSessionInvalid"));
  const proxyCommand = form.proxyCommand.trim();
  if (proxyCommand && !isProxyCommand(proxyCommand)) {
    return fail(t("sessions.form.proxyCommandInvalid", { max: MAX_PROXY_COMMAND }));
  }

  return {
    ok: true,
    target: {
      type: "ssh",
      host,
      port,
      username,
      auth,
      ...(form.forwardAgent ? { forwardAgent: true } : {}),
      ...(form.tmux ? { tmuxSession } : {}),
      ...(proxyCommand ? { proxyCommand } : {}),
    },
  };
}
