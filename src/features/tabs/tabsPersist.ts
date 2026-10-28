/**
 * The open tabs saved to `tabs.json` and read back at startup (S2): their order, the active tab,
 * split layouts, colours, each local pane's last folder and DEV mode.
 *
 * Nothing secret is written (S2.3): a tab opened from a saved session refers to it by id, and
 * any other target is copied field by field from an allow-list, without passwords, passphrases
 * or saved-password actions. Reading validates everything: a bad or foreign file restores nothing.
 */
import { targetTitle, type JumpTarget, type SessionTarget, type SshAuth, type SshTarget } from "../sessions/types";
import { isProxyCommand, isTmuxSessionName } from "../ssh/quickConnect";
import { clampRatio, closePane, leaf, MAX_PANES, paneIds, type PaneLayout } from "../panes/paneLayout";
import type { Tab } from "./tabs";

export const TABS_DOCUMENT_VERSION = 1;

/** Where a saved tab connects: a saved session by id, or a target without secrets. */
export type SavedSource = { sessionId: string } | { target: SessionTarget };

export interface SavedTab {
  source: SavedSource;
  /** Terminal panes only: AI chats and file viewers are not restored. */
  layout: PaneLayout;
  focused: string;
  /** The last folder of each local pane (OSC 7), by pane id of `layout`. */
  panes: Record<string, { cwd?: string }>;
  color?: string;
  /** The tab was in DEV mode, turned on from `pane`, with these folders added to its workspace. */
  dev?: { pane: string; folders?: string[] };
}

export interface TabsDocument {
  version: typeof TABS_DOCUMENT_VERSION;
  /** Index of the active tab in `tabs`. */
  active: number;
  tabs: SavedTab[];
}

export interface PersistInput {
  tabs: readonly Tab[];
  activeKey: string | null;
  /** The last folder a pane's shell reported, or null. */
  cwdOf: (paneId: string) => string | null;
  /** DEV mode of a tab: the pane it runs in (null when unknown) and its folder. */
  devOf: (tabKey: string) => { pane: string | null; folder: string | null } | undefined;
  /** Folders added to a DEV tab's workspace. */
  workspaceOf: (tabKey: string) => readonly string[] | undefined;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isFilled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
const isPort = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
const COLOR = /^#[0-9a-f]{6}$/i;

function sanitizeAuth(value: unknown): SshAuth | null {
  if (!isObject(value)) return null;
  switch (value.method) {
    // A typed password is never kept: the terminal asks for it again.
    case "password":
      return { method: "password", password: "" };
    case "key":
      return isFilled(value.path) ? { method: "key", path: value.path } : null;
    case "agent":
      return { method: "agent" };
    case "storedPassword":
      return isFilled(value.sessionId) ? { method: "storedPassword", sessionId: value.sessionId } : null;
    default:
      return null;
  }
}

function sanitizeLogin(value: unknown): Omit<JumpTarget, "name"> | null {
  if (!isObject(value) || !isFilled(value.host) || !isPort(value.port) || !isText(value.username)) return null;
  const auth = sanitizeAuth(value.auth);
  return auth && { host: value.host, port: value.port, username: value.username, auth };
}

/** The shell options of an SSH target (not secret); an invalid tmux session name or proxy command is dropped. */
function shellOptions(value: Json): Pick<SshTarget, "forwardAgent" | "tmuxSession" | "proxyCommand"> {
  return {
    ...(value.forwardAgent === true ? { forwardAgent: true } : {}),
    ...(isText(value.tmuxSession) && isTmuxSessionName(value.tmuxSession) ? { tmuxSession: value.tmuxSession } : {}),
    ...(isText(value.proxyCommand) && isProxyCommand(value.proxyCommand) ? { proxyCommand: value.proxyCommand } : {}),
  };
}

function sanitizeSsh(value: unknown): SshTarget | null {
  if (!isObject(value) || value.type !== "ssh") return null;
  const found = sanitizeLogin(value);
  if (!found) return null;
  const login = { ...found, ...shellOptions(value) };
  if (value.jumps === undefined) return { type: "ssh", ...login };
  if (!Array.isArray(value.jumps)) return null;
  const jumps: JumpTarget[] = [];
  for (const jump of value.jumps) {
    const hop = sanitizeLogin(jump);
    if (!hop || !isObject(jump) || !isText(jump.name)) return null;
    jumps.push({ name: jump.name, ...hop });
  }
  return { type: "ssh", ...login, ...(jumps.length ? { jumps } : {}) };
}

/**
 * A copy of `value` with only what reopens the target, or null when it is not a target that can
 * be restored (shared tabs never are: their link holds the share's key).
 */
export function sanitizeTarget(value: unknown): SessionTarget | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "local": {
      const { program, args, cwd } = value;
      if (program !== undefined && !isText(program)) return null;
      if (args !== undefined && !(Array.isArray(args) && args.every(isText))) return null;
      if (cwd !== undefined && !isText(cwd)) return null;
      return {
        type: "local",
        ...(isFilled(program) ? { program } : {}),
        ...(args?.length ? { args: [...args] } : {}),
        ...(isFilled(cwd) ? { cwd } : {}),
      };
    }
    case "ssh":
      return sanitizeSsh(value);
    case "mosh": {
      const ssh = sanitizeSsh(value.ssh);
      if (!ssh || (value.serverCommand !== undefined && !isText(value.serverCommand))) return null;
      return { type: "mosh", ssh, ...(isFilled(value.serverCommand) ? { serverCommand: value.serverCommand } : {}) };
    }
    case "telnet":
      return isFilled(value.host) && isPort(value.port) ? { type: "telnet", host: value.host, port: value.port } : null;
    case "serial": {
      const { path, baud, dataBits, parity, stopBits, flow } = value;
      if (!isFilled(path) || typeof baud !== "number" || !(baud > 0)) return null;
      if (dataBits !== 5 && dataBits !== 6 && dataBits !== 7 && dataBits !== 8) return null;
      if (parity !== "none" && parity !== "odd" && parity !== "even") return null;
      if (stopBits !== 1 && stopBits !== 2) return null;
      if (flow !== "none" && flow !== "software" && flow !== "hardware") return null;
      return { type: "serial", path, baud, dataBits, parity, stopBits, flow };
    }
    default:
      return null;
  }
}

/** The tab's layout without its AI chats and file viewers. */
function terminalLayout(tab: Tab): PaneLayout {
  const others = [...Object.keys(tab.chats), ...Object.keys(tab.viewers ?? {})];
  return others.reduce<PaneLayout | null>((layout, id) => layout && closePane(layout, id), tab.layout) ?? tab.layout;
}

/** What tabs.json holds for the tabs open now. */
export function snapshotTabs(input: PersistInput): TabsDocument {
  const tabs: SavedTab[] = [];
  let active = 0;
  for (const tab of input.tabs) {
    const target = tab.savedId ? null : sanitizeTarget(tab.target);
    if (!tab.savedId && !target) continue;
    const layout = terminalLayout(tab);
    const ids = paneIds(layout);
    const focusedTerminal = tab.chats[tab.focusedPane]?.terminalPaneId ?? tab.viewers?.[tab.focusedPane]?.terminalPaneId;
    const focused = focusedTerminal ?? tab.focusedPane;
    const dev = input.devOf(tab.key);
    const devPane = dev ? (dev.pane !== null && ids.includes(dev.pane) ? dev.pane : focused) : null;
    const panes: SavedTab["panes"] = {};
    // Only a local shell can be started in a folder; remote folders are not kept.
    if (tab.target.type === "local") {
      for (const id of ids) {
        const cwd = input.cwdOf(id) ?? (id === devPane ? dev?.folder : null);
        if (cwd) panes[id] = { cwd };
      }
    }
    const folders = dev ? (input.workspaceOf(tab.key) ?? []).filter(isFilled) : [];
    if (tab.key === input.activeKey) active = tabs.length;
    tabs.push({
      source: tab.savedId ? { sessionId: tab.savedId } : { target: target! },
      layout,
      focused: ids.includes(focused) ? focused : ids[0],
      panes,
      ...(tab.color && COLOR.test(tab.color) ? { color: tab.color } : {}),
      ...(devPane ? { dev: { pane: devPane, ...(folders.length ? { folders } : {}) } } : {}),
    });
  }
  return { version: TABS_DOCUMENT_VERSION, active, tabs };
}

export const serializeTabs = (doc: TabsDocument) => JSON.stringify(doc);

/** A layout read from the file: pane and split nodes with unique pane ids, at most MAX_PANES. */
function parseLayout(value: unknown, depth = 0): PaneLayout | null {
  if (!isObject(value) || depth > MAX_PANES) return null;
  if (value.kind === "pane") return isFilled(value.id) ? leaf(value.id) : null;
  if (value.kind !== "split" || (value.direction !== "row" && value.direction !== "column")) return null;
  if (typeof value.ratio !== "number") return null;
  const a = parseLayout(value.a, depth + 1);
  const b = parseLayout(value.b, depth + 1);
  if (!a || !b) return null;
  return { kind: "split", id: isFilled(value.id) ? value.id : "split", direction: value.direction, ratio: clampRatio(value.ratio), a, b };
}

function parseTab(value: unknown): SavedTab | null {
  if (!isObject(value) || !isObject(value.source)) return null;
  let source: SavedSource;
  if (isFilled(value.source.sessionId)) source = { sessionId: value.source.sessionId };
  else {
    const target = sanitizeTarget(value.source.target);
    if (!target) return null;
    source = { target };
  }
  const layout = parseLayout(value.layout);
  if (!layout) return null;
  const ids = paneIds(layout);
  if (ids.length > MAX_PANES || new Set(ids).size !== ids.length) return null;
  const panes: SavedTab["panes"] = {};
  if (isObject(value.panes)) {
    for (const id of ids) {
      const pane = value.panes[id];
      if (isObject(pane) && isFilled(pane.cwd)) panes[id] = { cwd: pane.cwd };
    }
  }
  const saved: SavedTab = { source, layout, focused: ids.includes(value.focused as string) ? (value.focused as string) : ids[0], panes };
  if (isText(value.color) && COLOR.test(value.color)) saved.color = value.color;
  if (isObject(value.dev) && ids.includes(value.dev.pane as string)) {
    const folders = Array.isArray(value.dev.folders) ? value.dev.folders.filter(isFilled) : [];
    saved.dev = { pane: value.dev.pane as string, ...(folders.length ? { folders } : {}) };
  }
  return saved;
}

/** The document in `json`, keeping only the tabs that can be restored; null when it is not one. */
export function parseTabsDocument(json: string | null): TabsDocument | null {
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  return readTabsDocument(value);
}

/** A parsed tabs document (tabs.json, or a tab set's tabs), sanitized like `parseTabsDocument`. */
export function readTabsDocument(value: unknown): TabsDocument | null {
  if (!isObject(value) || value.version !== TABS_DOCUMENT_VERSION || !Array.isArray(value.tabs)) return null;
  const tabs: SavedTab[] = [];
  let active = 0;
  value.tabs.forEach((raw, index) => {
    const tab = parseTab(raw);
    if (!tab) return;
    if (index === value.active) active = tabs.length;
    tabs.push(tab);
  });
  return { version: TABS_DOCUMENT_VERSION, active, tabs };
}

export interface RestorePlan {
  /** The tabs to add with the `restore` action, in order. */
  tabs: Tab[];
  activeKey: string | null;
  /** Local panes whose shell must change to another folder than the tab's, by new pane id. */
  cwds: Record<string, string>;
  /** Tabs to turn DEV mode on in, from `pane`, with the folders of their workspace. */
  dev: { key: string; pane: string; folders: string[] }[];
}

/**
 * The tabs to open for `doc`, given the target each saved tab resolved to (null: its saved
 * session is gone, the tab is skipped). Keys and pane ids continue from `start`.
 */
export function planRestore(
  doc: TabsDocument,
  targets: readonly (SessionTarget | null)[],
  start: { nextSeq: number; nextPaneSeq: number },
): RestorePlan {
  const plan: RestorePlan = { tabs: [], activeKey: null, cwds: {}, dev: [] };
  let paneSeq = start.nextPaneSeq;
  doc.tabs.forEach((saved, index) => {
    let target = targets[index];
    if (!target) return;
    const key = `tab-${start.nextSeq + plan.tabs.length}`;
    const renamed = new Map<string, string>();
    for (const id of paneIds(saved.layout)) renamed.set(id, `pane-${paneSeq++}`);
    const rebuild = (node: PaneLayout): PaneLayout => {
      if (node.kind === "pane") return leaf(renamed.get(node.id)!);
      const b = rebuild(node.b);
      return { ...node, id: `split-${paneIds(b)[0]}`, a: rebuild(node.a), b };
    };
    const layout = rebuild(saved.layout);
    if (target.type === "local") {
      // The shell starts in the first pane's folder; the others change to theirs once ready.
      const [first, ...others] = paneIds(saved.layout);
      const cwd = saved.panes[first]?.cwd;
      if (cwd) target = { ...target, cwd };
      for (const id of others) {
        const folder = saved.panes[id]?.cwd;
        if (folder && folder !== target.cwd) plan.cwds[renamed.get(id)!] = folder;
      }
    }
    const tab: Tab = {
      key,
      title: targetTitle(target),
      renamed: false,
      target,
      layout,
      focusedPane: renamed.get(saved.focused)!,
      chats: {},
      viewers: {},
      ...(saved.color ? { color: saved.color } : {}),
      ...("sessionId" in saved.source ? { savedId: saved.source.sessionId } : {}),
    };
    if (saved.dev) plan.dev.push({ key, pane: renamed.get(saved.dev.pane)!, folders: saved.dev.folders ?? [] });
    if (index === doc.active) plan.activeKey = key;
    plan.tabs.push(tab);
  });
  plan.activeKey ??= plan.tabs[0]?.key ?? null;
  return plan;
}
