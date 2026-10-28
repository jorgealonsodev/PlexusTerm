/**
 * Where each toolbar action sits: on the bar, inside a drop-down group, or hidden (Settings → Toolbar).
 * The logo and the Settings button are not part of it: they never move.
 */

export const TOOLBAR_ACTIONS = [
  "sidebar",
  "terminal",
  "ssh",
  "serial",
  "telnet",
  "mosh",
  "openShared",
  "playRecording",
  "keyGen",
  "portScan",
  "networkScan",
  "wakeOnLan",
  "remoteMonitor",
  "splitRight",
  "splitDown",
  "multiExec",
  "recordMacro",
  "devColumn",
] as const;
export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

/** A drop-down button listing its actions. `name` "" shows the group's default name (More, Tools, Group). */
export interface ToolbarGroup {
  kind: "group";
  id: string;
  name: string;
  items: ToolbarAction[];
}
export type ToolbarEntry = { kind: "action"; id: ToolbarAction } | ToolbarGroup;

export interface ToolbarLayout {
  bar: ToolbarEntry[];
  hidden: ToolbarAction[];
}

/** A spot to put an action: on the bar, in the hidden list, or in the group with that id. */
export interface ToolbarPlace {
  zone: string;
  index: number;
}

export const MAX_GROUP_NAME = 40;
const GROUP_ID = /^[\w-]{1,40}$/;

const action = (id: ToolbarAction): ToolbarEntry => ({ kind: "action", id });

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  bar: [
    action("sidebar"),
    action("terminal"),
    action("ssh"),
    action("serial"),
    { kind: "group", id: "more", name: "", items: ["telnet", "mosh", "openShared", "playRecording"] },
    { kind: "group", id: "tools", name: "", items: ["keyGen", "portScan", "networkScan", "wakeOnLan", "remoteMonitor"] },
    action("splitRight"),
    action("splitDown"),
    action("multiExec"),
    action("recordMacro"),
    action("devColumn"),
  ],
  hidden: [],
};

const isAction = (value: unknown): value is ToolbarAction => (TOOLBAR_ACTIONS as readonly unknown[]).includes(value);
const cleanName = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, MAX_GROUP_NAME) : "");

/**
 * A saved layout, or null (the default layout) when there is none. Unknown or repeated actions and
 * groups are dropped; actions it misses (added by a later version) are appended to the bar.
 */
export function cleanToolbarLayout(value: unknown): ToolbarLayout | null {
  if (typeof value !== "object" || value === null) return null;
  const { bar, hidden } = value as { bar?: unknown; hidden?: unknown };
  if (!Array.isArray(bar)) return null;
  const seen = new Set<ToolbarAction>();
  const groups = new Set<string>();
  const take = (id: unknown): id is ToolbarAction => isAction(id) && !seen.has(id) && !!seen.add(id);
  const entries: ToolbarEntry[] = [];
  for (const raw of bar as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (entry.kind === "action" && take(entry.id)) entries.push(action(entry.id));
    if (entry.kind === "group" && typeof entry.id === "string" && GROUP_ID.test(entry.id) && !groups.has(entry.id)) {
      groups.add(entry.id);
      const items = Array.isArray(entry.items) ? entry.items.filter(take) : [];
      entries.push({ kind: "group", id: entry.id, name: cleanName(entry.name), items });
    }
  }
  const hiddenActions = Array.isArray(hidden) ? hidden.filter(take) : [];
  for (const id of TOOLBAR_ACTIONS) if (take(id)) entries.push(action(id));
  return { bar: entries, hidden: hiddenActions };
}

/** Where an action is now, or null when the layout does not have it. */
export function whereIs(layout: ToolbarLayout, id: ToolbarAction): ToolbarPlace | null {
  const hidden = layout.hidden.indexOf(id);
  if (hidden >= 0) return { zone: "hidden", index: hidden };
  for (const [index, entry] of layout.bar.entries()) {
    if (entry.kind === "action" && entry.id === id) return { zone: "bar", index };
    if (entry.kind === "group" && entry.items.includes(id)) return { zone: entry.id, index: entry.items.indexOf(id) };
  }
  return null;
}

const insert = <T,>(list: readonly T[], index: number, item: T) => {
  const at = Math.max(0, Math.min(index, list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
};

/** Moves an action to `place`; its index counts the destination's items without the moved one. */
export function moveAction(layout: ToolbarLayout, id: ToolbarAction, place: ToolbarPlace): ToolbarLayout {
  const bar = layout.bar
    .filter((entry) => !(entry.kind === "action" && entry.id === id))
    .map((entry) => (entry.kind === "group" ? { ...entry, items: entry.items.filter((item) => item !== id) } : entry));
  const hidden = layout.hidden.filter((item) => item !== id);
  if (place.zone === "hidden") return { bar, hidden: insert(hidden, place.index, id) };
  if (place.zone === "bar") return { bar: insert(bar, place.index, action(id)), hidden };
  if (!bar.some((entry) => entry.kind === "group" && entry.id === place.zone)) return layout;
  return {
    bar: bar.map((entry) =>
      entry.kind === "group" && entry.id === place.zone ? { ...entry, items: insert(entry.items, place.index, id) } : entry,
    ),
    hidden,
  };
}

/** Moves a group to `index` on the bar (counted without it). */
export function moveGroup(layout: ToolbarLayout, groupId: string, index: number): ToolbarLayout {
  const group = layout.bar.find((entry) => entry.kind === "group" && entry.id === groupId);
  if (!group) return layout;
  return { ...layout, bar: insert(layout.bar.filter((entry) => entry !== group), index, group) };
}

/** Adds an empty group at the end of the bar. */
export function addGroup(layout: ToolbarLayout, id: string, name: string): ToolbarLayout {
  return { ...layout, bar: [...layout.bar, { kind: "group", id, name: cleanName(name), items: [] }] };
}

/** Renames a group as typed (spaces are kept while typing; the saved name is trimmed when read back). */
export function renameGroup(layout: ToolbarLayout, id: string, name: string): ToolbarLayout {
  const typed = name.slice(0, MAX_GROUP_NAME);
  return {
    ...layout,
    bar: layout.bar.map((entry) => (entry.kind === "group" && entry.id === id ? { ...entry, name: typed } : entry)),
  };
}

/** Removes a group; its actions take its place on the bar. */
export function removeGroup(layout: ToolbarLayout, id: string): ToolbarLayout {
  return {
    ...layout,
    bar: layout.bar.flatMap((entry) => (entry.kind === "group" && entry.id === id ? entry.items.map(action) : [entry])),
  };
}
