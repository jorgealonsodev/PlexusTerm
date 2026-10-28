/**
 * The command palette's items: the actions, saved sessions, macros, open tabs and Settings
 * sections, each run by one click or Enter, and how typing narrows them.
 */
import { matchesQuery } from "../settings/settingsSearch";

export type PaletteGroup = "actions" | "sessions" | "macros" | "tabs" | "settings" | "history";

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Shown after the name and found by the search too: a session's folder, a tab's target. */
  detail?: string;
  /** The keys that run it without the palette. */
  shortcut?: string;
  run: () => void;
}

/** Most items listed at once; typing more narrows the rest down. */
export const MAX_SHOWN = 50;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

/**
 * The items every word of `query` is in (name or detail, any order, accents and case ignored):
 * first those whose name starts with the query, then those whose name has every word, then those
 * found by their detail; in their own order within each.
 */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const q = fold(query);
  if (!q) return items.slice(0, MAX_SHOWN);
  const tiers: PaletteItem[][] = [[], [], []];
  for (const item of items) {
    if (fold(item.label).startsWith(q)) tiers[0].push(item);
    else if (matchesQuery(item.label, query)) tiers[1].push(item);
    else if (matchesQuery(`${item.label} ${item.detail ?? ""}`, query)) tiers[2].push(item);
  }
  return tiers.flat().slice(0, MAX_SHOWN);
}
