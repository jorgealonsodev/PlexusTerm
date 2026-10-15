import { Channel, invoke } from "@tauri-apps/api/core";

/** Events streamed by the `scan_ports` / `scan_network` commands (see src-tauri/src/tools/scan.rs). */
export type ScanEvent =
  | { event: "started"; data: { total: number } }
  | { event: "open"; data: { host: string; port: number; service: string | null } }
  | { event: "progress"; data: { done: number; total: number } }
  | { event: "host"; data: { host: string; name: string | null; mac: string | null; ports: number[] } }
  | { event: "done"; data: { done: number; total: number; cancelled: boolean } };

export type ScanStarter = (onEvent: (event: ScanEvent) => void) => Promise<number>;

function channelFor(onEvent: (event: ScanEvent) => void): Channel<ScanEvent> {
  const channel = new Channel<ScanEvent>();
  channel.onmessage = onEvent;
  return channel;
}

/** TCP connect scan of `targets` (host, IPv4, `a.b.c.d-e` or CIDR) x `ports` (`22,80,8000-8100`). */
export const portScan =
  (targets: string, ports: string): ScanStarter =>
  (onEvent) =>
    invoke<number>("scan_ports", { targets, ports, onEvent: channelFor(onEvent) });

/** Live-host scan of an IPv4 range or CIDR over the common service ports. */
export const networkScan =
  (targets: string): ScanStarter =>
  (onEvent) =>
    invoke<number>("scan_network", { targets, onEvent: channelFor(onEvent) });

export const stopScan = (id: number) => invoke<void>("scan_stop", { id });

/** Services probed by the network scanner, in display order. */
export const NETWORK_SERVICES: ReadonlyArray<readonly [number, string]> = [
  [22, "SSH"],
  [23, "Telnet"],
  [80, "HTTP"],
  [443, "HTTPS"],
  [3389, "RDP"],
  [5900, "VNC"],
  [445, "SMB"],
  [21, "FTP"],
];

const ipv4Key = (host: string) => {
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p)) ? parts.reduce((key, p) => key * 256 + p, 0) : null;
};

/** Orders IPv4 addresses numerically, anything else after them alphabetically. */
export function compareHosts(a: string, b: string): number {
  const [ka, kb] = [ipv4Key(a), ipv4Key(b)];
  if (ka !== null && kb !== null) return ka - kb;
  if (ka !== null) return -1;
  if (kb !== null) return 1;
  return a.localeCompare(b);
}
