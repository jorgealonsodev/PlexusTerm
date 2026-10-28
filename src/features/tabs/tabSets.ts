/**
 * Tab sets (S2): named copies of the open tabs, saved to `tab-sets.json` and opened later next to
 * the tabs already open. Each set holds the same document tabs.json does, written and read with
 * the same sanitizer (tabsPersist.ts), so nothing secret is kept. Local to this computer.
 */
import { readTabsDocument, type TabsDocument } from "./tabsPersist";

export const TAB_SETS_VERSION = 1;
export const MAX_TAB_SET_NAME = 80;

export interface TabSet {
  name: string;
  tabs: TabsDocument;
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** The name as it is saved (trimmed), or null when it is empty or longer than MAX_TAB_SET_NAME. */
export function cleanTabSetName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed && trimmed.length <= MAX_TAB_SET_NAME ? trimmed : null;
}

/** The set called `name`, whatever the case. */
export const findTabSet = (sets: readonly TabSet[], name: string) => sets.find((set) => same(set.name, name));

export const serializeTabSets = (sets: readonly TabSet[]) => JSON.stringify({ version: TAB_SETS_VERSION, sets });

/** The sets in `json`; a missing, bad or foreign file has none. Unusable sets are dropped. */
export function parseTabSets(json: string | null): TabSet[] {
  if (json === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return [];
  }
  if (typeof value !== "object" || value === null) return [];
  const { version, sets } = value as { version?: unknown; sets?: unknown };
  if (version !== TAB_SETS_VERSION || !Array.isArray(sets)) return [];
  const read: TabSet[] = [];
  for (const raw of sets as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const { name, tabs } = raw as { name?: unknown; tabs?: unknown };
    const cleaned = typeof name === "string" ? cleanTabSetName(name) : null;
    const doc = readTabsDocument(tabs);
    if (cleaned && doc && !findTabSet(read, cleaned)) read.push({ name: cleaned, tabs: doc });
  }
  return read;
}

/** `sets` with `tabs` saved as `name`: in the place of a set with that name, else at the end. */
export function putTabSet(sets: readonly TabSet[], name: string, tabs: TabsDocument): TabSet[] {
  const set = { name, tabs };
  return findTabSet(sets, name) ? sets.map((s) => (same(s.name, name) ? set : s)) : [...sets, set];
}

/** `sets` with `from` called `to`, or null when another set already has that name. */
export function renameTabSet(sets: readonly TabSet[], from: string, to: string): TabSet[] | null {
  if (sets.some((s) => !same(s.name, from) && same(s.name, to))) return null;
  return sets.map((s) => (same(s.name, from) ? { ...s, name: to } : s));
}

export const removeTabSet = (sets: readonly TabSet[], name: string) => sets.filter((s) => !same(s.name, name));
