/** Cumulative counters returned by the `monitor_sample` command (sizes in bytes). */
export interface MonitorSnapshot {
  cpuTotal: number;
  cpuIdle: number;
  memTotal: number;
  memAvailable: number;
  diskTotal: number;
  diskUsed: number;
  netRx: number;
  netTx: number;
  users: number;
}

export type MonitorSample = ({ status: "ok" } & MonitorSnapshot) | { status: "unavailable"; reason: string };

/** What the bar shows; `null` until two samples allow a rate. */
export interface MonitorStats {
  cpuPercent: number | null;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  /** Bytes per second. */
  rxRate: number | null;
  txRate: number | null;
  users: number;
}

const rate = (prev: number, curr: number, seconds: number) =>
  seconds > 0 && curr >= prev ? (curr - prev) / seconds : null;

/** Stats of `curr`, with CPU % and network rates measured since `prev`, taken `elapsedMs` earlier. */
export function computeStats(prev: MonitorSnapshot | null, curr: MonitorSnapshot, elapsedMs: number): MonitorStats {
  let cpuPercent: number | null = null;
  let rxRate: number | null = null;
  let txRate: number | null = null;
  if (prev) {
    const total = curr.cpuTotal - prev.cpuTotal;
    const idle = curr.cpuIdle - prev.cpuIdle;
    if (total > 0 && idle >= 0 && idle <= total) cpuPercent = (1 - idle / total) * 100;
    const seconds = elapsedMs / 1000;
    rxRate = rate(prev.netRx, curr.netRx, seconds);
    txRate = rate(prev.netTx, curr.netTx, seconds);
  }
  return {
    cpuPercent,
    memUsed: Math.max(0, curr.memTotal - curr.memAvailable),
    memTotal: curr.memTotal,
    diskUsed: curr.diskUsed,
    diskTotal: curr.diskTotal,
    rxRate,
    txRate,
    users: curr.users,
  };
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const PENDING = "…";

/** `512 B`, `1.5 KB`, `16 GB` (1024-based; one decimal below 10). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

export const formatRate = (bytesPerSecond: number | null) =>
  bytesPerSecond === null ? PENDING : `${formatBytes(bytesPerSecond)}/s`;

export const formatPercent = (percent: number | null) => (percent === null ? PENDING : `${Math.round(percent)}%`);
