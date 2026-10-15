export interface WolForm {
  mac: string;
  broadcast: string;
  port: string;
}

export type WolResult =
  | { ok: true; mac: string; broadcast: string; port: number }
  | { ok: false; error: string };

export const emptyWolForm: WolForm = { mac: "", broadcast: "", port: "" };

const MAC = /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Validates the Wake On LAN form; the backend checks the same rules again. */
export function parseWolForm(form: WolForm): WolResult {
  const mac = form.mac.trim();
  if (!MAC.test(mac)) return { ok: false, error: "MAC address must look like aa:bb:cc:dd:ee:ff" };
  const broadcast = form.broadcast.trim() || "255.255.255.255";
  if (!IPV4.test(broadcast)) return { ok: false, error: "Broadcast address must be an IPv4 address" };
  const portText = form.port.trim();
  const port = portText ? Number(portText) : 9;
  if (!/^\d*$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Port must be a number between 1 and 65535" };
  }
  return { ok: true, mac: mac.toLowerCase().replace(/-/g, ":"), broadcast, port };
}
