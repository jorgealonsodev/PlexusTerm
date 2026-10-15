import type { SessionTarget } from "../sessions/types";

/** One command of a host's history. */
export interface HistoryEntry {
  command: string;
  /** How many times it was run. */
  count: number;
  /** When it was last run (ms since the epoch). */
  last: number;
}

/**
 * The command history behind inline suggestions (S1), stored in history.json.
 * Each host's entries are ordered by `last`, oldest first.
 */
export interface HistoryData {
  hosts: Record<string, HistoryEntry[]>;
}

export const EMPTY_HISTORY: HistoryData = { hosts: {} };
export const MAX_PER_HOST = 2000;
export const MAX_HOSTS = 200;
/** Longer lines are not commands worth suggesting (e.g. a pasted script). */
export const MAX_COMMAND_LENGTH = 1000;

const DAY = 24 * 60 * 60 * 1000;

/** The history a session's commands go to: `user@host:port`, `telnet:host:port`, `serial:path` or `local`. */
export function hostKeyOf(target: SessionTarget): string {
  switch (target.type) {
    case "local":
      return "local";
    case "ssh":
      return `${target.username}@${target.host}:${target.port}`;
    case "mosh":
      return `${target.ssh.username}@${target.ssh.host}:${target.ssh.port}`;
    case "telnet":
      return `telnet:${target.host}:${target.port}`;
    case "serial":
      return `serial:${target.path}`;
  }
}

const lastUse = (entries: HistoryEntry[]) => entries[entries.length - 1]?.last ?? 0;

/** Adds one run of `command` to `hostKey`'s history (deduplicated, capped). */
export function recordCommand(data: HistoryData, hostKey: string, command: string, now: number): HistoryData {
  const line = command.trimEnd();
  if (!line.trim() || line.length > MAX_COMMAND_LENGTH) return data;
  const entries = data.hosts[hostKey] ?? [];
  const previous = entries.find((e) => e.command === line);
  const next = entries.filter((e) => e !== previous);
  next.push({ command: line, count: (previous?.count ?? 0) + 1, last: now });
  if (next.length > MAX_PER_HOST) next.splice(0, next.length - MAX_PER_HOST);
  const hosts = { ...data.hosts, [hostKey]: next };
  const keys = Object.keys(hosts);
  if (keys.length > MAX_HOSTS) {
    const oldest = keys.reduce((a, b) => (lastUse(hosts[b]) < lastUse(hosts[a]) ? b : a));
    delete hosts[oldest];
  }
  return { hosts };
}

/** Recency first; every doubling of the use count weighs as much as one day of recency. */
const score = (e: HistoryEntry) => e.last + Math.log2(e.count) * DAY;

const best = (entries: Iterable<HistoryEntry>, prefix: string): string | null => {
  let found: HistoryEntry | null = null;
  for (const e of entries) {
    if (e.command.length > prefix.length && e.command.startsWith(prefix) && (!found || score(e) > score(found))) found = e;
  }
  return found?.command ?? null;
};

/** Merged histories by data snapshot: typing asks again on every key. */
const mergedCache = new WeakMap<HistoryData, HistoryEntry[]>();

/** Every host's commands merged: counts add up, the latest run wins. */
const everyHost = (data: HistoryData): HistoryEntry[] => {
  const cached = mergedCache.get(data);
  if (cached) return cached;
  const merged = new Map<string, HistoryEntry>();
  for (const entries of Object.values(data.hosts)) {
    for (const e of entries) {
      const seen = merged.get(e.command);
      merged.set(e.command, seen ? { ...e, count: seen.count + e.count, last: Math.max(seen.last, e.last) } : e);
    }
  }
  const result = [...merged.values()];
  mergedCache.set(data, result);
  return result;
};

/** The whole command suggested for a typed prefix: the host's own history first, then every host's. */
export function suggest(data: HistoryData, hostKey: string, prefix: string): string | null {
  if (!prefix) return null;
  return best(data.hosts[hostKey] ?? [], prefix) ?? best(everyHost(data), prefix);
}

/** The host's last `count` commands, oldest first (context for AI suggestions). */
export function recentCommands(data: HistoryData, hostKey: string, count: number): string[] {
  if (count <= 0) return [];
  return (data.hosts[hostKey] ?? []).slice(-count).map((e) => e.command);
}

const validEntry = (e: unknown): e is HistoryEntry => {
  if (typeof e !== "object" || e === null) return false;
  const { command, count, last } = e as Record<string, unknown>;
  return (
    typeof command === "string" &&
    command.trim() !== "" &&
    command.length <= MAX_COMMAND_LENGTH &&
    Number.isInteger(count) &&
    (count as number) > 0 &&
    typeof last === "number" &&
    Number.isFinite(last)
  );
};

/** Reads history.json; anything missing or invalid gives an empty history, invalid entries are dropped. */
export function parseHistory(json: unknown): HistoryData {
  let raw: unknown = null;
  try {
    raw = typeof json === "string" ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  const hosts = (raw as { hosts?: unknown } | null)?.hosts;
  if (typeof hosts !== "object" || hosts === null || Array.isArray(hosts)) return { hosts: {} };
  const result: Record<string, HistoryEntry[]> = {};
  for (const [key, entries] of Object.entries(hosts)) {
    if (!Array.isArray(entries)) continue;
    const valid = entries
      .filter(validEntry)
      .map(({ command, count, last }) => ({ command, count, last }))
      .sort((a, b) => a.last - b.last)
      .slice(-MAX_PER_HOST);
    if (valid.length) result[key] = valid;
  }
  return { hosts: result };
}

export function serializeHistory(data: HistoryData): string {
  return JSON.stringify({ version: 1, hosts: data.hosts });
}
