import type { FontStep } from "../settings/settings";
import { shortcutFromEvent } from "../settings/shortcutCapture";
import type { SidebarView } from "../sidebar/Sidebar";
import type { FocusDirection, SplitDirection } from "./paneLayout";

/** The subset of KeyboardEvent the shortcut table needs. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type ToolId = "keyGen" | "portScan" | "networkScan" | "wakeOnLan";

export type Shortcut =
  | { type: "newTerminal" }
  | { type: "quickConnect" }
  | { type: "closePane" }
  | { type: "split"; direction: SplitDirection }
  | { type: "toggleMultiExec" }
  | { type: "focus"; direction: FocusDirection }
  /** Pane-local: handled by the focused terminal itself (S15.1, S15.3). */
  | { type: "find" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "selectAll" }
  /** Command blocks: the prompt before or after, and the last command's output (shell integration). */
  | { type: "previousCommand" }
  | { type: "nextCommand" }
  | { type: "copyCommandOutput" }
  /** Keyboard selection over the scrollback, and labels over the URLs, paths, hashes… on screen. */
  | { type: "copyMode" }
  | { type: "quickSelect" }
  | { type: "previousFailedCommand" }
  | { type: "nextFailedCommand" }
  | { type: "rerunFailedCommand" }
  | { type: "clear" }
  | { type: "saveOutput" }
  | { type: "toggleLogging" }
  | { type: "askAi" }
  /** Global font size (S15.2). */
  | { type: "fontSize"; step: FontStep }
  /** Macros (S16.2, S16.4): start or stop recording, play the macro bound to Ctrl+Alt+`hotkey`. */
  | { type: "recordMacro" }
  | { type: "playMacro"; hotkey: number }
  /** Folds the sidebar to its tab icons (or hides it) and opens it again. */
  | { type: "toggleSidebar" }
  | { type: "sidebarView"; view: SidebarView }
  | { type: "closeTab" }
  | { type: "nextTab" }
  | { type: "previousTab" }
  | { type: "newSerial" }
  | { type: "newTelnet" }
  | { type: "newMosh" }
  | { type: "tool"; tool: ToolId }
  | { type: "toggleRemoteMonitor" }
  | { type: "openSettings" }
  /** One box to reach every action, saved session, macro, tab and Settings section. */
  | { type: "commandPalette" }
  /** The commands run before on the focused terminal's computer, to type one again. */
  | { type: "searchHistory" }
  /** The active tab's DEV mode on or off (S10). */
  | { type: "toggleDevMode" }
  /** Folds DEV mode's tab column to its icons (or hides it) and opens it again. */
  | { type: "toggleDevColumn" }
  /** Lists the folders DEV mode was last used in, to open one in a new DEV tab. */
  | { type: "recentFolders" };

export type ShortcutGroup = "tabs" | "connections" | "terminal" | "font" | "sidebar" | "tools" | "ai";

interface ShortcutAction {
  shortcut: Shortcut;
  group: ShortcutGroup;
  /** Combinations as `shortcutFromEvent` names them; empty when the action starts unbound. */
  defaults: readonly string[];
}

/**
 * Every customisable action, in the order Settings lists them. A default action may have several
 * combinations (the font increase answers Ctrl+= and Ctrl++); an override replaces them with one.
 * Ctrl+Shift with a digit or a symbol is listed too, since some layouts need Shift to type them.
 */
export const SHORTCUT_ACTIONS = {
  newTerminal: { shortcut: { type: "newTerminal" }, group: "tabs", defaults: ["Ctrl+Shift+T"] },
  closePane: { shortcut: { type: "closePane" }, group: "tabs", defaults: ["Ctrl+Shift+W"] },
  closeTab: { shortcut: { type: "closeTab" }, group: "tabs", defaults: [] },
  nextTab: { shortcut: { type: "nextTab" }, group: "tabs", defaults: [] },
  previousTab: { shortcut: { type: "previousTab" }, group: "tabs", defaults: [] },
  splitRight: { shortcut: { type: "split", direction: "row" }, group: "tabs", defaults: ["Ctrl+Shift+D"] },
  splitDown: { shortcut: { type: "split", direction: "column" }, group: "tabs", defaults: ["Ctrl+Shift+E"] },
  focusLeft: { shortcut: { type: "focus", direction: "left" }, group: "tabs", defaults: ["Alt+ArrowLeft"] },
  focusRight: { shortcut: { type: "focus", direction: "right" }, group: "tabs", defaults: ["Alt+ArrowRight"] },
  focusUp: { shortcut: { type: "focus", direction: "up" }, group: "tabs", defaults: ["Alt+ArrowUp"] },
  focusDown: { shortcut: { type: "focus", direction: "down" }, group: "tabs", defaults: ["Alt+ArrowDown"] },
  toggleMultiExec: { shortcut: { type: "toggleMultiExec" }, group: "tabs", defaults: ["Ctrl+Shift+M"] },
  quickConnect: { shortcut: { type: "quickConnect" }, group: "connections", defaults: ["Ctrl+Shift+S"] },
  newSerial: { shortcut: { type: "newSerial" }, group: "connections", defaults: [] },
  newTelnet: { shortcut: { type: "newTelnet" }, group: "connections", defaults: [] },
  newMosh: { shortcut: { type: "newMosh" }, group: "connections", defaults: [] },
  find: { shortcut: { type: "find" }, group: "terminal", defaults: ["Ctrl+Shift+F"] },
  copy: { shortcut: { type: "copy" }, group: "terminal", defaults: ["Ctrl+Shift+C"] },
  paste: { shortcut: { type: "paste" }, group: "terminal", defaults: ["Ctrl+Shift+V"] },
  selectAll: { shortcut: { type: "selectAll" }, group: "terminal", defaults: [] },
  copyMode: { shortcut: { type: "copyMode" }, group: "terminal", defaults: ["Ctrl+Shift+X"] },
  quickSelect: { shortcut: { type: "quickSelect" }, group: "terminal", defaults: ["Ctrl+Shift+Q"] },
  previousCommand: { shortcut: { type: "previousCommand" }, group: "terminal", defaults: ["Ctrl+Shift+ArrowUp"] },
  nextCommand: { shortcut: { type: "nextCommand" }, group: "terminal", defaults: ["Ctrl+Shift+ArrowDown"] },
  copyCommandOutput: { shortcut: { type: "copyCommandOutput" }, group: "terminal", defaults: [] },
  previousFailedCommand: { shortcut: { type: "previousFailedCommand" }, group: "terminal", defaults: [] },
  nextFailedCommand: { shortcut: { type: "nextFailedCommand" }, group: "terminal", defaults: [] },
  rerunFailedCommand: { shortcut: { type: "rerunFailedCommand" }, group: "terminal", defaults: [] },
  clear: { shortcut: { type: "clear" }, group: "terminal", defaults: [] },
  saveOutput: { shortcut: { type: "saveOutput" }, group: "terminal", defaults: [] },
  toggleLogging: { shortcut: { type: "toggleLogging" }, group: "terminal", defaults: [] },
  toggleDevMode: { shortcut: { type: "toggleDevMode" }, group: "terminal", defaults: [] },
  recentFolders: { shortcut: { type: "recentFolders" }, group: "terminal", defaults: [] },
  askAi: { shortcut: { type: "askAi" }, group: "ai", defaults: [] },
  fontIncrease: {
    shortcut: { type: "fontSize", step: "increase" },
    group: "font",
    defaults: ["Ctrl+=", "Ctrl++", "Ctrl+Shift+=", "Ctrl+Shift++"],
  },
  fontDecrease: { shortcut: { type: "fontSize", step: "decrease" }, group: "font", defaults: ["Ctrl+-", "Ctrl+Shift+-"] },
  fontReset: { shortcut: { type: "fontSize", step: "reset" }, group: "font", defaults: ["Ctrl+0", "Ctrl+Shift+0"] },
  toggleSidebar: { shortcut: { type: "toggleSidebar" }, group: "sidebar", defaults: ["Ctrl+Shift+B"] },
  toggleDevColumn: { shortcut: { type: "toggleDevColumn" }, group: "sidebar", defaults: [] },
  showSessions: { shortcut: { type: "sidebarView", view: "sessions" }, group: "sidebar", defaults: [] },
  showSftp: { shortcut: { type: "sidebarView", view: "sftp" }, group: "sidebar", defaults: [] },
  showExplorer: { shortcut: { type: "sidebarView", view: "explorer" }, group: "sidebar", defaults: [] },
  showTunnels: { shortcut: { type: "sidebarView", view: "tunnels" }, group: "sidebar", defaults: [] },
  showMacros: { shortcut: { type: "sidebarView", view: "macros" }, group: "sidebar", defaults: [] },
  recordMacro: { shortcut: { type: "recordMacro" }, group: "sidebar", defaults: ["Ctrl+Shift+R"] },
  keyGen: { shortcut: { type: "tool", tool: "keyGen" }, group: "tools", defaults: [] },
  portScan: { shortcut: { type: "tool", tool: "portScan" }, group: "tools", defaults: [] },
  networkScan: { shortcut: { type: "tool", tool: "networkScan" }, group: "tools", defaults: [] },
  wakeOnLan: { shortcut: { type: "tool", tool: "wakeOnLan" }, group: "tools", defaults: [] },
  toggleRemoteMonitor: { shortcut: { type: "toggleRemoteMonitor" }, group: "tools", defaults: [] },
  openSettings: { shortcut: { type: "openSettings" }, group: "tools", defaults: [] },
  commandPalette: { shortcut: { type: "commandPalette" }, group: "tools", defaults: ["Ctrl+Shift+P"] },
  searchHistory: { shortcut: { type: "searchHistory" }, group: "terminal", defaults: ["Ctrl+Shift+H"] },
} satisfies Record<string, ShortcutAction>;

export type ShortcutActionId = keyof typeof SHORTCUT_ACTIONS;
export const SHORTCUT_ACTION_IDS = Object.keys(SHORTCUT_ACTIONS) as ShortcutActionId[];

/** The user's changes: action id -> its one combination, or "" when the user left it unbound. */
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;

export const isShortcutActionId = (value: string): value is ShortcutActionId =>
  Object.prototype.hasOwnProperty.call(SHORTCUT_ACTIONS, value);

/** Ctrl+Alt+1..9 play macros (see `shortcutFor`). */
export const MACRO_HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => `Ctrl+Alt+${d}`);

/** Fixed keys that no action may take, by what they do. */
export type ReservedUse = "playMacro" | "acceptWord";
export function reservedUse(shortcut: string): ReservedUse | null {
  if (MACRO_HOTKEYS.includes(shortcut)) return "playMacro";
  // Ctrl+Right accepts the next word of an inline suggestion.
  if (shortcut === "Ctrl+ArrowRight") return "acceptWord";
  return null;
}

/** The combinations an action answers to: its override when there is one ("" = none), else its defaults. */
export function bindingsOf(action: ShortcutActionId, overrides: ShortcutOverrides = {}): readonly string[] {
  const own = overrides[action];
  if (own === undefined) return SHORTCUT_ACTIONS[action].defaults;
  return own === "" ? [] : [own];
}

/** The combination shown for an action (its first one), or "" when it is unbound. */
export const shortcutLabel = (action: ShortcutActionId, overrides: ShortcutOverrides = {}) =>
  bindingsOf(action, overrides)[0] ?? "";

/** The action that answers to `shortcut` with these overrides, leaving out `except`. */
export function actionUsing(
  shortcut: string,
  overrides: ShortcutOverrides = {},
  except?: ShortcutActionId,
): ShortcutActionId | null {
  for (const id of SHORTCUT_ACTION_IDS) {
    if (id !== except && bindingsOf(id, overrides).includes(shortcut)) return id;
  }
  return null;
}

/** What already uses a combination: an action, a fixed key, or the AI assistant. */
export type ShortcutConflict =
  | { kind: "action"; action: ShortcutActionId }
  | { kind: "reserved"; use: ReservedUse }
  | { kind: "assistant" };

/**
 * Why `shortcut` cannot be given to `action` (null when it is free). Every effective binding counts,
 * plus the fixed keys and the assistant shortcut (pass `action` undefined when checking the assistant).
 */
export function shortcutConflict(
  shortcut: string,
  overrides: ShortcutOverrides,
  options: { action?: ShortcutActionId; assistantShortcut?: string } = {},
): ShortcutConflict | null {
  const use = reservedUse(shortcut);
  if (use) return { kind: "reserved", use };
  if (options.assistantShortcut !== undefined && options.action !== undefined && shortcut === options.assistantShortcut) {
    return { kind: "assistant" };
  }
  const action = actionUsing(shortcut, overrides, options.action);
  return action ? { kind: "action", action } : null;
}

/**
 * The application shortcut for a key event with the given overrides (the defaults when omitted), or
 * null when the key belongs to the terminal.
 * Terminals must not see these keys: xterm would otherwise send e.g. Ctrl+D (EOF) for Ctrl+Shift+D.
 */
export function shortcutFor(e: KeyLike, overrides: ShortcutOverrides = {}): Shortcut | null {
  const name = shortcutFromEvent(e);
  if (name === null) return null;
  const action = actionUsing(name, overrides);
  if (action) return SHORTCUT_ACTIONS[action].shortcut as Shortcut;
  // Only the digit itself: a character typed with AltGr (Ctrl+Alt on some systems) stays the terminal's.
  if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
    return { type: "playMacro", hotkey: Number(e.key) };
  }
  return null;
}
