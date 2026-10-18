import { isLanguageSetting, type LanguageSetting } from "../../i18n/i18n";
import { DEFAULT_THEME_ID, isThemeId } from "../terminal/themes";
import {
  actionUsing,
  isShortcutActionId,
  reservedUse,
  shortcutConflict,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "../panes/shortcuts";
import { isValidShortcut } from "./shortcutCapture";

/** AI providers (S2, S4). */
export const AI_PROVIDERS = ["anthropic", "gemini", "openai", "openai-compatible", "opencode-go"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** The model a provider starts with; OpenAI, compatible endpoints and OpenCode Go leave it to the user. */
export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-opus-5-5",
  gemini: "gemini-3.5-flash-lite",
  openai: "",
  "openai-compatible": "",
  "opencode-go": "",
};

/** Terminal settings shared by every tab, stored in settings.json (S15.6). */
export interface TerminalSettings {
  /** Font size in pixels, 8..32. */
  fontSize: number;
  /** Selecting text with the mouse copies it to the clipboard. */
  copyOnSelect: boolean;
  /** Right click pastes; when off it opens the terminal context menu. */
  rightClickPastes: boolean;
  /** Pasting more than one line asks first. */
  confirmMultilinePaste: boolean;
  /** Output lines that look like errors are shown in the colour scheme's red. */
  errorHighlight: boolean;
  /** Colour scheme id (see TERMINAL_THEMES). */
  theme: string;
  /** Font family: one font name, or a CSS font list. */
  fontFamily: string;
  /** SSH tabs show the remote monitor bar (CPU, RAM, disk, network, users). */
  remoteMonitor: boolean;
  /**
   * Program that "Open with default text editor" uses: a program path, or a command line
   * with arguments; empty uses the system's default text editor.
   */
  textEditor: string;
  /** File lists (SFTP, Explorer) show each entry's size and date (L15). */
  fileDetails: boolean;
  /** Opening a folder in the SFTP browser or the Explorer runs `cd` to it in the terminal (L16). */
  terminalFollowsBrowser: boolean;
  /** How the sidebar opens with PlexusTerm: as it was left, always open or always folded (L17). */
  sidebarAtStartup: SidebarAtStartup;
  /** Grey inline suggestions of the rest of the command while typing (S1). */
  inlineSuggestions: boolean;
  /** Commands sent with Enter are recorded in history.json and suggested (S1). */
  commandHistory: boolean;
  /** Ask the AI provider when the history has no suggestion (S2). */
  aiSuggestions: boolean;
  aiProvider: AiProvider;
  /** Base URL of an OpenAI-compatible endpoint; "" for the others. */
  aiBaseUrl: string;
  /** Model name; "" leaves it for the user to fill. */
  aiModel: string;
  /** How many of the host's last commands are sent as AI context, 0..20. */
  aiHistoryContext: number;
  /** Opens the on-demand assistant (S3), e.g. "Ctrl+Shift+Space". */
  assistantShortcut: string;
  /** The sidebar is folded (Ctrl+Shift+B or the toolbar button). */
  sidebarCollapsed: boolean;
  /** Folding hides the sidebar completely instead of leaving its tab icons. */
  sidebarHideWhenCollapsed: boolean;
  /** Shell of new local terminals: a path or a name on PATH; "" runs the system default. */
  localShell: string;
  /** Its arguments as typed, split like a shell when a terminal opens. */
  localShellArgs: string;
  /** Folder new local terminals start in (`~` is the home folder); "" starts in the home folder. */
  localCwd: string;
  /** Width in px dragged by the user; null keeps the default width of each sidebar tab. */
  sidebarWidth: number | null;
  /** Ask GitHub for a newer release when PlexusTerm starts. */
  checkUpdates: boolean;
  /** Keep AI conversations in `ai-chats.json` after closing PlexusTerm (S9). */
  aiSaveChats: boolean;
  /** Interface language; "system" follows the operating system, English when it is not supported. */
  language: LanguageSetting;
  /**
   * The user's shortcut changes only (action id -> combination, "" = unbound); every other action
   * keeps its default from the shortcut table, so defaults can change in later versions.
   */
  shortcuts: ShortcutOverrides;
  /**
   * Shift+Enter sends a line feed (what Ctrl+J sends), which AI command-line tools such as Claude Code,
   * Codex, Gemini CLI and OpenCode read as "new line" instead of "submit"; off, it sends Enter's CR.
   */
  shiftEnterNewline: boolean;
  /**
   * A desktop notification when a terminal rings the bell or sends a notification (OSC 9, 777, 99)
   * while PlexusTerm is in the background; the tab is marked either way.
   */
  attentionNotifications: boolean;
  /** Terminals draw with WebGL (the GPU); off, or when WebGL fails, xterm's own renderer draws them. */
  gpuAcceleration: boolean;
  /** Tabs show the git branch of their terminal's folder (local and SSH terminals). */
  gitBranch: boolean;
  /** File lists (Explorer, SFTP) colour entries by their git status, like VS Code. */
  gitFileStatus: boolean;
}

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_FAMILY_LENGTH = 200;
export const DEFAULT_FONT_FAMILY = '"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace';
export const MAX_FONT_SIZE = 32;
export const MAX_TEXT_EDITOR_LENGTH = 1024;
export const MAX_AI_HISTORY_CONTEXT = 20;
export const MAX_AI_MODEL_LENGTH = 200;
export const MAX_AI_BASE_URL_LENGTH = 500;
export const DEFAULT_ASSISTANT_SHORTCUT = "Ctrl+Shift+Space";

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 14,
  copyOnSelect: true,
  rightClickPastes: true,
  confirmMultilinePaste: true,
  errorHighlight: true,
  theme: DEFAULT_THEME_ID,
  fontFamily: DEFAULT_FONT_FAMILY,
  remoteMonitor: true,
  textEditor: "",
  fileDetails: false,
  terminalFollowsBrowser: true,
  sidebarAtStartup: "last",
  inlineSuggestions: true,
  commandHistory: true,
  aiSuggestions: false,
  aiProvider: "anthropic",
  aiBaseUrl: "",
  aiModel: DEFAULT_AI_MODELS.anthropic,
  aiHistoryContext: 5,
  assistantShortcut: DEFAULT_ASSISTANT_SHORTCUT,
  sidebarCollapsed: false,
  sidebarHideWhenCollapsed: false,
  localShell: "",
  localShellArgs: "",
  localCwd: "",
  sidebarWidth: null,
  checkUpdates: true,
  aiSaveChats: true,
  language: "system",
  shortcuts: {},
  shiftEnterNewline: true,
  attentionNotifications: true,
  gpuAcceleration: true,
  gitBranch: true,
  gitFileStatus: true,
};

export const clampFontSize = (size: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** A trimmed, non-empty font family of at most 200 characters, or the default one. */
export function cleanFontFamily(value: unknown): string {
  const family = typeof value === "string" ? value.trim() : "";
  return family && family.length <= MAX_FONT_FAMILY_LENGTH ? family : DEFAULT_FONT_FAMILY;
}

/** A trimmed text editor command of at most 1024 characters, or "" (the system default). */
export function cleanTextEditor(value: unknown): string {
  const editor = typeof value === "string" ? value.trim() : "";
  return editor.length <= MAX_TEXT_EDITOR_LENGTH ? editor : "";
}

export const MAX_LOCAL_SHELL_LENGTH = 1024;

/** A trimmed text of at most 1024 characters (the local shell and its arguments), or "". */
export function cleanLocalShell(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= MAX_LOCAL_SHELL_LENGTH ? text : "";
}

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);

/** A trimmed model name of at most 200 characters, or the provider's default model. */
export function cleanAiModel(value: unknown, provider: AiProvider): string {
  let model = typeof value === "string" ? value.trim() : null;
  // OpenCode's own config names Go models "opencode-go/<id>"; the API wants just the id.
  if (model !== null && provider === "opencode-go") model = model.replace(/^opencode-go\//i, "");
  return model !== null && model.length <= MAX_AI_MODEL_LENGTH ? model : DEFAULT_AI_MODELS[provider];
}

/** A trimmed http(s) URL of at most 500 characters, or "". */
export function cleanAiBaseUrl(value: unknown): string {
  const url = typeof value === "string" ? value.trim() : "";
  return url.length <= MAX_AI_BASE_URL_LENGTH && /^https?:\/\/\S+$/i.test(url) ? url : "";
}

export const clampAiHistoryContext = (count: number) =>
  Math.min(MAX_AI_HISTORY_CONTEXT, Math.max(0, Math.round(count)));

/**
 * A valid shortcut that PlexusTerm does not already use (with these shortcut overrides), or the
 * default one.
 */
export const cleanAssistantShortcut = (value: unknown, overrides: ShortcutOverrides = {}): string =>
  typeof value === "string" && isValidShortcut(value) && shortcutConflict(value, overrides) === null
    ? value
    : DEFAULT_ASSISTANT_SHORTCUT;

/**
 * The usable shortcut overrides of `value`: known actions with "" (unbound) or a valid combination
 * that is not a fixed key, not the assistant's, and not one another action answers to. When two
 * overrides clash, the later one is dropped (bringing its defaults back), until none clashes.
 */
export function cleanShortcutOverrides(value: unknown, assistantShortcut: string): ShortcutOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  let kept: ShortcutOverrides = {};
  for (const [id, shortcut] of Object.entries(value)) {
    if (!isShortcutActionId(id) || typeof shortcut !== "string") continue;
    if (shortcut !== "" && (!isValidShortcut(shortcut) || reservedUse(shortcut) || shortcut === assistantShortcut)) continue;
    kept[id] = shortcut;
  }
  for (;;) {
    const ids = Object.keys(kept) as ShortcutActionId[];
    const clash = ids.reverse().find((id) => kept[id] !== "" && actionUsing(kept[id]!, kept, id) !== null);
    if (clash === undefined) return kept;
    const { [clash]: _dropped, ...rest } = kept;
    kept = rest;
  }
}

/** The CSS font list for a setting: a single name is quoted and falls back to monospace. */
export const cssFontFamily = (family: string) => (/[,"']/.test(family) ? family : `"${family}", monospace`);

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 640;

/** Rounds a dragged sidebar width and keeps it within the sidebar's limits. */
export const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));

/**
 * Reads settings.json. A missing or unreadable file gives the defaults; every invalid value
 * falls back to its default (the font size is clamped) and unknown keys are ignored.
 */
export const SIDEBAR_AT_STARTUP = ["last", "expanded", "collapsed"] as const;
export type SidebarAtStartup = (typeof SIDEBAR_AT_STARTUP)[number];
const sidebarAtStartupOf = (value: unknown): SidebarAtStartup =>
  (SIDEBAR_AT_STARTUP as readonly unknown[]).includes(value) ? (value as SidebarAtStartup) : "last";

export function parseSettings(json: string | null): TerminalSettings {
  let raw: unknown = null;
  try {
    raw = json === null ? null : JSON.parse(json);
  } catch {
    raw = null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const value = raw as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const aiProvider = isAiProvider(value.aiProvider) ? value.aiProvider : d.aiProvider;
  // The assistant and the overrides must not share a combination: the assistant keeps its own
  // unless an override makes it clash, and then the overrides are checked against the default.
  const wanted =
    typeof value.assistantShortcut === "string" && isValidShortcut(value.assistantShortcut) && !reservedUse(value.assistantShortcut)
      ? value.assistantShortcut
      : DEFAULT_ASSISTANT_SHORTCUT;
  let shortcuts = cleanShortcutOverrides(value.shortcuts, wanted);
  const assistantShortcut = cleanAssistantShortcut(wanted, shortcuts);
  if (assistantShortcut !== wanted) shortcuts = cleanShortcutOverrides(shortcuts, assistantShortcut);
  return {
    fontSize:
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize) ? clampFontSize(value.fontSize) : d.fontSize,
    copyOnSelect: bool(value.copyOnSelect, d.copyOnSelect),
    rightClickPastes: bool(value.rightClickPastes, d.rightClickPastes),
    confirmMultilinePaste: bool(value.confirmMultilinePaste, d.confirmMultilinePaste),
    errorHighlight: bool(value.errorHighlight, d.errorHighlight),
    theme: typeof value.theme === "string" && isThemeId(value.theme) ? value.theme : d.theme,
    fontFamily: cleanFontFamily(value.fontFamily),
    remoteMonitor: bool(value.remoteMonitor, d.remoteMonitor),
    textEditor: cleanTextEditor(value.textEditor),
    fileDetails: bool(value.fileDetails, d.fileDetails),
    terminalFollowsBrowser: bool(value.terminalFollowsBrowser, d.terminalFollowsBrowser),
    sidebarAtStartup: sidebarAtStartupOf(value.sidebarAtStartup),
    inlineSuggestions: bool(value.inlineSuggestions, d.inlineSuggestions),
    commandHistory: bool(value.commandHistory, d.commandHistory),
    aiSuggestions: bool(value.aiSuggestions, d.aiSuggestions),
    aiProvider,
    aiBaseUrl: cleanAiBaseUrl(value.aiBaseUrl),
    aiModel: cleanAiModel(value.aiModel, aiProvider),
    aiHistoryContext:
      typeof value.aiHistoryContext === "number" && Number.isFinite(value.aiHistoryContext)
        ? clampAiHistoryContext(value.aiHistoryContext)
        : d.aiHistoryContext,
    assistantShortcut,
    // The sidebar opens folded or not as Settings choose, or as it was left (L17).
    sidebarCollapsed:
      sidebarAtStartupOf(value.sidebarAtStartup) === "last"
        ? bool(value.sidebarCollapsed, d.sidebarCollapsed)
        : sidebarAtStartupOf(value.sidebarAtStartup) === "collapsed",
    sidebarHideWhenCollapsed: bool(value.sidebarHideWhenCollapsed, d.sidebarHideWhenCollapsed),
    localShell: cleanLocalShell(value.localShell),
    localShellArgs: cleanLocalShell(value.localShellArgs),
    localCwd: cleanLocalShell(value.localCwd),
    sidebarWidth:
      typeof value.sidebarWidth === "number" && Number.isFinite(value.sidebarWidth)
        ? clampSidebarWidth(value.sidebarWidth)
        : d.sidebarWidth,
    checkUpdates: bool(value.checkUpdates, d.checkUpdates),
    aiSaveChats: bool(value.aiSaveChats, d.aiSaveChats),
    language: isLanguageSetting(value.language) ? value.language : d.language,
    shortcuts,
    shiftEnterNewline: bool(value.shiftEnterNewline, d.shiftEnterNewline),
    attentionNotifications: bool(value.attentionNotifications, d.attentionNotifications),
    gpuAcceleration: bool(value.gpuAcceleration, d.gpuAcceleration),
    gitBranch: bool(value.gitBranch, d.gitBranch),
    gitFileStatus: bool(value.gitFileStatus, d.gitFileStatus),
  };
}

export function serializeSettings(settings: TerminalSettings): string {
  return JSON.stringify({ version: 1, ...settings }, null, 2);
}

export type FontStep = "increase" | "decrease" | "reset";

/** Ctrl+= / Ctrl+- / Ctrl+0 (S15.2). */
export function stepFontSize(size: number, step: FontStep): number {
  if (step === "reset") return DEFAULT_SETTINGS.fontSize;
  return clampFontSize(size + (step === "increase" ? 1 : -1));
}
