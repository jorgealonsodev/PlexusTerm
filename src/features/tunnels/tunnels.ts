import type { AppKey } from "../../i18n/catalogs";
import { t } from "../../i18n/i18n";

/** Kinds of SSH port forwarding: `-L`, `-R` and `-D`. */
export type TunnelType = "local" | "remote" | "dynamic";

/** `label` is a catalogue key, resolved with `t()` when shown. */
export const tunnelTypes: { value: TunnelType; label: AppKey }[] = [
  { value: "local", label: "tunnels.types.local" },
  { value: "remote", label: "tunnels.types.remote" },
  { value: "dynamic", label: "tunnels.types.dynamic" },
];

/** A saved tunnel; it never contains secrets. Dynamic tunnels have no destination ("" and 0). */
export interface Tunnel {
  id: string;
  name: string;
  type: TunnelType;
  /** Id of the saved session whose SSH connection carries the tunnel. */
  sessionId: string;
  listenHost: string;
  listenPort: number;
  destHost: string;
  destPort: number;
}

export interface TunnelList {
  version: 1;
  tunnels: Tunnel[];
}

export type TunnelAction = { type: "save"; tunnel: Tunnel } | { type: "delete"; id: string };

/** Mirrors the Rust `TunnelStatus` enum serialized with `#[serde(tag = "state")]`. */
export type TunnelStatus =
  | { state: "stopped" }
  | { state: "starting" }
  /** `warning`: something went wrong next to the tunnel (e.g. the password could not be saved). */
  | { state: "running"; warning?: string }
  | { state: "error"; message: string };

export const emptyTunnels: TunnelList = { version: 1, tunnels: [] };

export function tunnelsReducer(list: TunnelList, action: TunnelAction): TunnelList {
  switch (action.type) {
    case "save": {
      const tunnel = pick(action.tunnel);
      const exists = list.tunnels.some((t) => t.id === tunnel.id);
      return {
        ...list,
        tunnels: exists ? list.tunnels.map((t) => (t.id === tunnel.id ? tunnel : t)) : [...list.tunnels, tunnel],
      };
    }
    case "delete":
      return { ...list, tunnels: list.tunnels.filter((t) => t.id !== action.id) };
  }
}

/** Keeps only the saved fields, so nothing else (e.g. a password) is ever written. */
function pick(t: Tunnel): Tunnel {
  const { id, name, type, sessionId, listenHost, listenPort, destHost, destPort } = t;
  return { id, name, type, sessionId, listenHost, listenPort, destHost, destPort };
}

const isString = (v: unknown): v is string => typeof v === "string";
const isPort = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= 65535;

function isTunnel(v: unknown): v is Tunnel {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return (
    isString(t.id) &&
    isString(t.name) &&
    tunnelTypes.some((type) => type.value === t.type) &&
    isString(t.sessionId) &&
    isString(t.listenHost) &&
    isPort(t.listenPort, 1) &&
    isString(t.destHost) &&
    isPort(t.destPort, 0)
  );
}

export type ParseResult = { ok: true; list: TunnelList } | { ok: false; error: string };

/** A missing file is an empty list; anything unreadable is an error, never silently emptied. */
export function parseTunnels(json: string | null): ParseResult {
  if (json === null) return { ok: true, list: emptyTunnels };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: t("tunnels.file.invalidJson", { error: String(err) }) };
  }
  const list = data as Partial<TunnelList>;
  if (list?.version !== 1) return { ok: false, error: t("tunnels.file.unsupportedVersion") };
  if (!Array.isArray(list.tunnels) || !list.tunnels.every(isTunnel)) {
    return { ok: false, error: t("tunnels.file.invalidTunnels") };
  }
  return { ok: true, list: { version: 1, tunnels: list.tunnels.map(pick) } };
}

export function serializeTunnels(list: TunnelList): string {
  return JSON.stringify({ version: 1, tunnels: list.tunnels.map(pick) }, null, 2);
}

const hostPort = (host: string, port: number) => (host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`);

/** One-line summary, e.g. "L 127.0.0.1:5433 → db:5432". */
export function describeTunnel(t: Tunnel): string {
  const listen = hostPort(t.listenHost, t.listenPort);
  switch (t.type) {
    case "local":
      return `L ${listen} → ${hostPort(t.destHost, t.destPort)}`;
    case "remote":
      return `R ${listen} → ${hostPort(t.destHost, t.destPort)}`;
    case "dynamic":
      return `D ${listen} (SOCKS5)`;
  }
}

/** Listen addresses only reachable from this machine. */
export function isLoopback(host: string): boolean {
  return ["127.0.0.1", "localhost", "::1"].includes(host.trim().toLowerCase());
}
