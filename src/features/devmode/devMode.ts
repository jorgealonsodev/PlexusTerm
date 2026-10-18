/**
 * DEV mode (S10): a per-tab mode for working with AI command-line tools. It turns on when the
 * command line runs one of them (or, as a fallback, when a terminal takes one's title) and off when
 * the shell's prompt comes back after it, unless it was turned on by hand.
 */

/** The commands that turn DEV mode on, as Settings → Terminal lists them by default. */
export const DEFAULT_DEV_COMMANDS: readonly string[] = ["claude", "codex", "agy", "opencode", "pi", "gentle-shell"];

export const MAX_DEV_COMMANDS = 50;
const MAX_DEV_COMMAND_LENGTH = 64;
const VALID_COMMAND = /^[^\s,]+$/;

/** The saved list: names without spaces, no duplicates; the defaults when the value is missing. */
export function cleanDevCommands(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_DEV_COMMANDS];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > MAX_DEV_COMMAND_LENGTH || !VALID_COMMAND.test(name) || names.includes(name)) continue;
    names.push(name);
    if (names.length === MAX_DEV_COMMANDS) break;
  }
  return names;
}

/** The list as typed in Settings: names separated by commas or spaces. */
export const parseDevCommands = (text: string) => cleanDevCommands(text.split(/[\s,]+/));
export const devCommandsText = (commands: readonly string[]) => commands.join(", ");

/** The program of a path (`~/bin/claude`, `C:\tools\codex.exe`). */
const programName = (word: string) => {
  const name = word.slice(Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\")) + 1);
  return name.replace(/\.(exe|cmd|bat|ps1)$/i, "");
};

/** The listed CLI a command line runs (its first word), or null. */
export function cliOfCommand(command: string, commands: readonly string[]): string | null {
  const first = command.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  const name = programName(first);
  return commands.includes(name) ? name : null;
}

/** Titles some CLIs give their terminal, by command. */
const TITLE_NAMES: Record<string, string> = { "claude code": "claude", antigravity: "agy", "π": "pi" };

/**
 * The listed CLI a terminal title names, or null: the title starts with the command (after a
 * spinner or symbol, as Claude Code's "✳ Claude Code") followed by nothing, a space or a dash.
 */
export function cliOfTitle(title: string, commands: readonly string[]): string | null {
  const text = title.replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
  if (!text) return null;
  const starts = (name: string) => text === name || new RegExp(`^${escape(name)}(\\s|$)`).test(text);
  for (const [name, command] of Object.entries(TITLE_NAMES)) {
    if (commands.includes(command) && starts(name)) return command;
  }
  for (const command of commands) if (starts(command.toLowerCase())) return command;
  return null;
}

/**
 * A title that opens with a non-ASCII symbol (a spinner or mark such as Claude Code's ✳ or ⠂), as AI
 * CLIs title the terminal while they work. ASCII punctuation is the shell's (`~/proj`, `[me@box]`).
 */
const startsWithSymbol = (title: string) => /^[^\p{L}\p{N}\s\x00-\x7F]/u.test(title.trimStart());

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A tab in DEV mode. */
export interface DevTab {
  /** Identifies this DEV mode, so a slow folder lookup cannot anchor a later one. */
  id: number;
  /** Turned on by hand: only a hand (button or shortcut) turns it off. */
  manual: boolean;
  /** The CLI running in it (its icon), or null. */
  cli: string | null;
  /** The pane that ran the CLI; its prompt coming back turns DEV mode off. */
  pane: string | null;
  /** The text before the cursor when the CLI was started (the shell's prompt), or null. */
  prompt: string | null;
  /** The folder the command ran in, once known. */
  folder: string | null;
  /** The project root (the git repository holding `folder`, else `folder`), once known. */
  root: string | null;
}

/** DEV mode by tab key; a tab not listed is not in DEV mode. */
export type DevState = Readonly<Record<string, DevTab>>;

export type DevAction =
  | { type: "command"; tab: string; pane: string; command: string; prompt: string; commands: readonly string[]; id: number }
  | { type: "title"; tab: string; pane: string; title: string; commands: readonly string[]; id: number }
  /** The shell marked its prompt (OSC 7 or OSC 133). */
  | { type: "promptMark"; tab: string; pane: string }
  /** A pane's output went quiet with `row` before the cursor. */
  | { type: "quiet"; tab: string; pane: string; row: string }
  | { type: "toggle"; tab: string; pane: string; id: number }
  | { type: "anchor"; tab: string; id: number; folder: string; root: string }
  /** The open tabs and their panes. */
  | { type: "forget"; panes: ReadonlyMap<string, readonly string[]> };

/** Prompts compared loosely: spaces and changing numbers (a clock, a duration) do not count. */
const promptShape = (text: string) => text.replace(/\d+/g, "0").replace(/\s+/g, " ").trim();

const without = (state: DevState, tab: string): DevState => {
  const { [tab]: _gone, ...rest } = state;
  return rest;
};

/** The shell's prompt is back in `pane`: an automatic DEV mode ends, a hand-made one forgets its CLI. */
function promptBack(state: DevState, tab: string, pane: string): DevState {
  const dev = state[tab];
  if (!dev || dev.pane !== pane) return state;
  if (!dev.manual) return without(state, tab);
  return dev.cli === null ? state : { ...state, [tab]: { ...dev, cli: null } };
}

export function devReducer(state: DevState, action: DevAction): DevState {
  switch (action.type) {
    case "command": {
      const cli = cliOfCommand(action.command, action.commands);
      const dev = state[action.tab];
      if (!cli) return state;
      // Typed inside a running CLI: not a shell command.
      if (dev && (!dev.manual || dev.cli !== null)) return state;
      const started = { cli, pane: action.pane, prompt: action.prompt };
      if (dev) return { ...state, [action.tab]: { ...dev, ...started } };
      return { ...state, [action.tab]: { id: action.id, manual: false, folder: null, root: null, ...started } };
    }
    case "title": {
      const dev = state[action.tab];
      if (dev && dev.cli !== null) {
        // While a CLI runs its titles name it or start with a symbol (Claude Code's "✳ <task>");
        // any other title in its pane is the shell's again: the CLI has ended.
        const stillCli = cliOfTitle(action.title, action.commands) !== null || startsWithSymbol(action.title);
        return stillCli || dev.pane !== action.pane ? state : promptBack(state, action.tab, action.pane);
      }
      // A hand-made DEV mode learns its CLI from the title.
      const cli = cliOfTitle(action.title, action.commands);
      if (!cli) return state;
      if (dev) return { ...state, [action.tab]: { ...dev, cli, pane: action.pane } };
      return {
        ...state,
        [action.tab]: { id: action.id, manual: false, cli, pane: action.pane, prompt: null, folder: null, root: null },
      };
    }
    case "promptMark":
      return promptBack(state, action.tab, action.pane);
    case "quiet": {
      const dev = state[action.tab];
      const prompt = dev?.prompt ? promptShape(dev.prompt) : "";
      if (!prompt || promptShape(action.row) !== prompt) return state;
      return promptBack(state, action.tab, action.pane);
    }
    case "toggle":
      if (state[action.tab]) return without(state, action.tab);
      return {
        ...state,
        [action.tab]: { id: action.id, manual: true, cli: null, pane: action.pane, prompt: null, folder: null, root: null },
      };
    case "anchor": {
      const dev = state[action.tab];
      if (!dev || dev.id !== action.id) return state;
      return { ...state, [action.tab]: { ...dev, folder: action.folder, root: action.root } };
    }
    case "forget": {
      let next = state;
      for (const [tab, dev] of Object.entries(state)) {
        const panes = action.panes.get(tab);
        if (!panes || (!dev.manual && dev.pane !== null && !panes.includes(dev.pane))) next = without(next, tab);
      }
      return next;
    }
  }
}

/**
 * A tab's title without the mark its CLI puts in front (pi and gentle-shell's "π - ", Claude Code's
 * spinner), for rows that already show the CLI's icon; the CLI's name when nothing else is left.
 * Titles of tabs without a CLI are returned unchanged.
 */
export function titleWithoutCliMark(title: string, cli: string | null, name: string = cli ?? ""): string {
  if (!cli) return title;
  const trimmed = title.replace(/^π(\s*[-–—:]\s*|\s+|$)/u, "").replace(/^[^\p{L}\p{N}\s\x00-\x7F]+\s*/u, "").trim();
  return trimmed || name;
}
