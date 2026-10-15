import { t } from "../../i18n/i18n";
import type { Tunnel, TunnelType } from "./tunnels";

export interface TunnelForm {
  name: string;
  type: TunnelType;
  sessionId: string;
  listenHost: string;
  listenPort: string;
  destHost: string;
  destPort: string;
}

export type TunnelFormResult = { ok: true; tunnel: Tunnel } | { ok: false; error: string };

export const DEFAULT_LISTEN_HOST = "127.0.0.1";

const fail = (error: string): TunnelFormResult => ({ ok: false, error });

function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

/** Validates the tunnel editor; `sessionIds` are the saved sessions a tunnel may use. */
export function parseTunnelForm(form: TunnelForm, id: string, sessionIds: string[]): TunnelFormResult {
  if (!sessionIds.includes(form.sessionId)) return fail(t("tunnels.form.chooseSession"));
  const listenPort = parsePort(form.listenPort);
  if (listenPort === null) return fail(t("tunnels.form.invalidListenPort"));

  let destHost = "";
  let destPort = 0;
  if (form.type !== "dynamic") {
    destHost = form.destHost.trim();
    if (!destHost) return fail(t("tunnels.form.destHostRequired"));
    const port = parsePort(form.destPort);
    if (port === null) return fail(t("tunnels.form.invalidDestPort"));
    destPort = port;
  }

  const dest = form.type === "dynamic" ? "" : `→${destHost}:${destPort}`;
  return {
    ok: true,
    tunnel: {
      id,
      name: form.name.trim() || `${form.type} ${listenPort}${dest}`,
      type: form.type,
      sessionId: form.sessionId,
      listenHost: form.listenHost.trim() || DEFAULT_LISTEN_HOST,
      listenPort,
      destHost,
      destPort,
    },
  };
}

export function formFromTunnel(tunnel: Tunnel): TunnelForm {
  return {
    name: tunnel.name,
    type: tunnel.type,
    sessionId: tunnel.sessionId,
    listenHost: tunnel.listenHost,
    listenPort: String(tunnel.listenPort),
    destHost: tunnel.destHost,
    destPort: tunnel.destPort ? String(tunnel.destPort) : "",
  };
}
