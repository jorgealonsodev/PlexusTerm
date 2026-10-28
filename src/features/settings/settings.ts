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
import { cleanToolbarLayout, type ToolbarLayout } from "../toolbar/toolbarLayout";
import { cleanDevCommands, DEFAULT_DEV_COMMANDS } from "../devmode/devMode";
import { DEFAULT_RECENT_FOLDERS, MAX_RECENT_FOLDERS } from "../devmode/recentFolders";
import { DEFAULT_ICON_PACKS, isIconPack, type IconPack } from "../files/iconPacks";
import { EXAMPLE_RULE, parseHighlightRules, type HighlightRule } from "../terminal/highlightRules";

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
  /** Local shells mark their prompt and commands (OSC 133); for terminals opened from now on. */
  shellIntegration: boolean;
  /** `sz`/`rz` on the other end start a ZMODEM file transfer (local, SSH, Telnet, serial). */
  zmodem: boolean;
  /** Colour scheme id (see TERMINAL_THEMES). */
  theme: string;
  /** Font family: one font name, or a CSS font list. */
  fontFamily: string;
  /** Weight of the terminal's text, one of FONT_WEIGHTS; bold text is BOLD_STEP heavier. */
  fontWeight: number;
  /**
   * Height of a terminal row, as a multiple of the font size (one of LINE_HEIGHTS). Taller rows sit on
   * fractions of a pixel, which blurs the text with GPU acceleration; without it block and box
   * characters come from the font, so only 1 joins them without gaps.
   */
  lineHeight: number;
  /** SSH tabs show the remote monitor bar (CPU, RAM, disk, network, users). */
  remoteMonitor: boolean;
  /** A dropped SSH session keeps its pane and reconnects by itself (Settings → Connections). */
  sshAutoReconnect: boolean;
  /** The folder the saved sessions are synced through (Syncthing, Drive…); "" when they are not. */
  syncFolder: string;
  /** The folder the settings are synced through, apart from the ones of each computer; "" when they are not. */
  settingsSyncFolder: string;
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
  /** Where the + opens a new local terminal: the starting folder, or the active local terminal's folder. */
  newTerminalFolder: NewTerminalFolder;
  /** The same for the + of the DEV tab column. */
  devNewTerminalFolder: NewTerminalFolder;
  /** Width in px dragged by the user; null keeps the default width of each sidebar tab. */
  sidebarWidth: number | null;
  /** Ask GitHub for a newer release when PlexusTerm starts. */
  checkUpdates: boolean;
  /** Reopen the tabs of the last run at startup, from `tabs.json` (S2). */
  restoreTabs: boolean;
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
  /**
   * A command the shell marks (shell integration) that runs at least this many seconds says when it
   * finishes, like a program asking for attention; 0 turns it off.
   */
  commandNotifySeconds: number;
  /** Logs to a file (Log to file…) start each line with its date and time. */
  logTimestamps: boolean;
  /** The user's highlight rules: expressions coloured in every terminal, optionally asking for attention. */
  highlightRules: HighlightRule[];
  /** Terminals draw with WebGL (the GPU); off, or when WebGL fails, xterm's own renderer draws them. */
  gpuAcceleration: boolean;
  /** File lists (Explorer, SFTP) colour entries by their git status, like VS Code. */
  gitFileStatus: boolean;
  /** The file viewer saves an edited file by itself a moment after typing stops. */
  viewerAutoSave: boolean;
  /** Where a file viewer opens next to its terminal. */
  viewerPosition: ViewerPosition;
  /** The file viewer marks the lines changed since the file's last commit, like VS Code (its own button). */
  viewerChangedLines: boolean;
  /** Hide toolbar labels visually, keeping tooltips and accessible names. */
  toolbarIconsOnly: boolean;
  /** Where each toolbar action sits (Settings → Toolbar); null follows the default layout. */
  toolbarLayout: ToolbarLayout | null;
  /** Text size of the interface (bars, lists, dialogs) in pixels, 10..20; the terminal has its own. */
  uiFontSize: number;
  /** Text size of the AI chat in pixels, 10..24. */
  chatFontSize: number;
  /** Text size of the file viewer's code and Markdown in pixels, 10..24. */
  viewerFontSize: number;
  /** Commands that turn a tab's DEV mode on when the command line runs them (S10). */
  devCommands: string[];
  /** Width in px of DEV mode's tab column, dragged by the user (S13); null keeps the default width. */
  tabColumnWidth: number | null;
  /** DEV mode's tab column is folded to its icons (the toolbar button or its shortcut). */
  devColumnCollapsed: boolean;
  /** Folding hides DEV mode's tab column completely instead of leaving its icons. */
  devColumnHideWhenCollapsed: boolean;
  /** How DEV mode's tab column opens with PlexusTerm: as it was left, always open or always folded. */
  devColumnAtStartup: SidebarAtStartup;
  /** How many recent DEV mode folders the Explorer keeps, 1..50. */
  recentFolderLimit: number;
  /** In DEV mode the bar under each terminal names its folder (the last part of the path). */
  devFolderInFooter: boolean;
  /** The bar under each terminal shows the plan usage of an AI CLI (Claude Code, Codex, Antigravity, OpenCode Go). */
  aiUsageInFooter: boolean;
  /** Whose usage that bar shows: the CLI running in the terminal (`auto`), always one provider, or
   * nobody's (`off`: the bar keeps an "off" icon to turn it on again). */
  aiUsageProvider: AiUsageChoice;
  /** Terminal sharing: the relay's `wss://` URL ("" until set). The relay token is in the keyring. */
  shareRelayUrl: string;
  /** Terminal sharing: the `https://` origin that serves the viewer page ("" until set). */
  shareViewerOrigin: string;
  /** View only joins ask the sharer first; Can type joins always do. */
  shareViewNeedsApproval: boolean;
  /** Run `sudo -k` in the tab when a Can type share starts, so typing viewers find no cached sudo. */
  shareSudoReset: boolean;
  /** Linux: block lid-close sleep too while sharing (idle sleep is always blocked). */
  shareBlockLid: boolean;
  /** The share audit log records what viewers type; otherwise only the time and the byte count. */
  shareRecordInput: boolean;
  /** Write a diagnostic log (sessions, errors, freezes) to help find why PlexusTerm stops responding. */
  diagnosticLog: boolean;
  /** Folder of the diagnostic log; "" uses the app's log folder. */
  diagnosticLogDir: string;
  /** File icon pack of the plain file lists (Explorer and SFTP outside DEV mode). */
  fileIconsList: IconPack;
  /** File icon pack of DEV mode's file trees. */
  fileIconsTree: IconPack;
  /** Colour of the focused pane's border (#rrggbb); "" uses the colour scheme's accent. */
  focusBorderColor: string;
  /** How much of that colour shows over the background, in percent (FOCUS_BORDER_STRENGTHS bounds). */
  focusBorderStrength: number;
  /** Height of the bar under each terminal and viewer, in px (PANE_FOOTER_HEIGHTS bounds); its text grows with it. */
  paneFooterHeight: number;
}

export const MIN_FOCUS_BORDER_STRENGTH = 10;
export const MAX_FOCUS_BORDER_STRENGTH = 100;
export const clampFocusBorderStrength = (value: number) =>
  Math.min(MAX_FOCUS_BORDER_STRENGTH, Math.max(MIN_FOCUS_BORDER_STRENGTH, Math.round(value)));
export const MIN_PANE_FOOTER_HEIGHT = 18;
export const MAX_PANE_FOOTER_HEIGHT = 48;
/** The height the bar under a terminal is drawn at (its text is sized for it). */
export const BASE_PANE_FOOTER_HEIGHT = 22;
export const clampPaneFooterHeight = (value: number) =>
  Math.min(MAX_PANE_FOOTER_HEIGHT, Math.max(MIN_PANE_FOOTER_HEIGHT, Math.round(value)));
/** A #rrggbb colour in lower case, or "" (the scheme's accent). */
export const cleanHexColor = (value: unknown): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : "";

/** The CSS colour of the focused pane's border. */
export const focusBorderCss = (color: string, strength: number) =>
  `color-mix(in srgb, ${color || "var(--accent)"} ${strength}%, var(--bg))`;

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_FAMILY_LENGTH = 200;
export const DEFAULT_FONT_FAMILY = '"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace';
export const MAX_FONT_SIZE = 32;
/** Terminal text weights offered: light, regular, medium and semibold (variable fonts draw them all). */
export const FONT_WEIGHTS = [300, 400, 500, 600];
/** Bold text is this much heavier than the chosen weight. */
export const BOLD_STEP = 300;
export const boldWeight = (weight: number) => Math.min(900, weight + BOLD_STEP);
/** Terminal line heights offered. */
export const LINE_HEIGHTS = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3];
/** The interface and the AI chat are drawn for 13 px text; their sizes scale from it. */
export const BASE_TEXT_SIZE = 13;
export const MIN_UI_FONT_SIZE = 10;
export const MAX_UI_FONT_SIZE = 20;
export const MIN_CHAT_FONT_SIZE = 10;
export const MAX_CHAT_FONT_SIZE = 24;
export const MIN_VIEWER_FONT_SIZE = 10;
export const MAX_VIEWER_FONT_SIZE = 24;
export const MAX_TEXT_EDITOR_LENGTH = 1024;
export const MAX_AI_HISTORY_CONTEXT = 20;
export const MAX_AI_MODEL_LENGTH = 200;
export const MAX_AI_BASE_URL_LENGTH = 500;
export const MAX_SHARE_URL_LENGTH = 500;
export const DEFAULT_ASSISTANT_SHORTCUT = "Ctrl+Shift+Space";

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 14,
  copyOnSelect: true,
  rightClickPastes: true,
  confirmMultilinePaste: true,
  errorHighlight: true,
  shellIntegration: true,
  zmodem: true,
  theme: DEFAULT_THEME_ID,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontWeight: 400,
  lineHeight: 1,
  remoteMonitor: true,
  sshAutoReconnect: true,
  syncFolder: "",
  settingsSyncFolder: "",
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
  newTerminalFolder: "start",
  devNewTerminalFolder: "terminal",
  sidebarWidth: null,
  checkUpdates: true,
  restoreTabs: true,
  aiSaveChats: true,
  language: "system",
  shortcuts: {},
  shiftEnterNewline: true,
  attentionNotifications: true,
  commandNotifySeconds: 10,
  logTimestamps: true,
  // One rule to show how they work; removing it keeps the list empty.
  highlightRules: [EXAMPLE_RULE],
  gpuAcceleration: true,
  gitFileStatus: true,
  viewerAutoSave: false,
  viewerPosition: "left",
  viewerChangedLines: true,
  toolbarIconsOnly: false,
  toolbarLayout: null,
  uiFontSize: 13,
  chatFontSize: 13,
  viewerFontSize: 13,
  devCommands: [...DEFAULT_DEV_COMMANDS],
  tabColumnWidth: null,
  shareRelayUrl: "",
  shareViewerOrigin: "",
  shareViewNeedsApproval: true,
  shareSudoReset: true,
  shareBlockLid: false,
  shareRecordInput: false,
  diagnosticLog: false,
  diagnosticLogDir: "",
  fileIconsList: DEFAULT_ICON_PACKS.list,
  fileIconsTree: DEFAULT_ICON_PACKS.tree,
  focusBorderColor: "",
  focusBorderStrength: 55,
  paneFooterHeight: 22,
  devColumnCollapsed: false,
  devColumnHideWhenCollapsed: false,
  devColumnAtStartup: "last",
  recentFolderLimit: DEFAULT_RECENT_FOLDERS,
  devFolderInFooter: true,
  aiUsageInFooter: true,
  aiUsageProvider: "off",
};

export const clampFontSize = (size: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
export const clampUiFontSize = (size: number) => Math.min(MAX_UI_FONT_SIZE, Math.max(MIN_UI_FONT_SIZE, Math.round(size)));
export const clampChatFontSize = (size: number) =>
  Math.min(MAX_CHAT_FONT_SIZE, Math.max(MIN_CHAT_FONT_SIZE, Math.round(size)));
export const clampRecentFolderLimit = (count: number) => Math.min(MAX_RECENT_FOLDERS, Math.max(1, Math.round(count)));
/** Longest wait a command notice can ask for: an hour. */
export const MAX_COMMAND_NOTIFY_SECONDS = 3600;
export const clampCommandNotifySeconds = (seconds: number) =>
  Math.min(MAX_COMMAND_NOTIFY_SECONDS, Math.max(0, Math.round(seconds)));
export const clampViewerFontSize = (size: number) =>
  Math.min(MAX_VIEWER_FONT_SIZE, Math.max(MIN_VIEWER_FONT_SIZE, Math.round(size)));
const size = (value: unknown, clamp: (size: number) => number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value) : fallback;

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

/** A sharing URL of one of `schemes` (`wss` for the relay, `https` for the viewer page), or "". */
export function cleanShareUrl(value: unknown, schemes: string[]): string {
  const url = typeof value === "string" ? value.trim() : "";
  const scheme = url.split("://")[0]?.toLowerCase() ?? "";
  return url.length <= MAX_SHARE_URL_LENGTH && schemes.includes(scheme) && /^[a-z]+:\/\/\S+$/i.test(url) ? url : "";
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

export const TAB_COLUMN_MIN_WIDTH = 140;
export const TAB_COLUMN_MAX_WIDTH = 480;

/** Rounds a dragged width of DEV mode's tab column and keeps it within its limits (S13). */
export const clampTabColumnWidth = (width: number) =>
  Math.min(TAB_COLUMN_MAX_WIDTH, Math.max(TAB_COLUMN_MIN_WIDTH, Math.round(width)));

/**
 * Reads settings.json. A missing or unreadable file gives the defaults; every invalid value
 * falls back to its default (the font size is clamped) and unknown keys are ignored.
 */
export const VIEWER_POSITIONS = ["left", "right", "below"] as const;
/** Where the + starts a new local terminal: the starting folder, or the folder the active terminal is in. */
export const NEW_TERMINAL_FOLDERS = ["start", "terminal"] as const;
export type NewTerminalFolder = (typeof NEW_TERMINAL_FOLDERS)[number];
/** Whose plan usage the bar under a terminal shows. */
export const AI_USAGE_CHOICES = ["auto", "claude", "codex", "agy", "opencodeGo", "off"] as const;
export type AiUsageChoice = (typeof AI_USAGE_CHOICES)[number];
export type ViewerPosition = (typeof VIEWER_POSITIONS)[number];

export const SIDEBAR_AT_STARTUP = ["last", "expanded", "collapsed"] as const;
export type SidebarAtStartup = (typeof SIDEBAR_AT_STARTUP)[number];
const sidebarAtStartupOf = (value: unknown): SidebarAtStartup =>
  (SIDEBAR_AT_STARTUP as readonly unknown[]).includes(value) ? (value as SidebarAtStartup) : "last";

/**
 * Settings files before version 2 kept WebGL on by default; on Linux it is turned off once when
 * they are read (WebKitGTK shows a WebGL terminal several frames late: measured 50-70 ms a key,
 * against 11 ms with xterm's own renderer), and kept as the user sets it from then on.
 */
const SETTINGS_VERSION = 2;

export function parseSettings(json: string | null): TerminalSettings {
  let raw: unknown = null;
  try {
    raw = json === null ? null : JSON.parse(json);
  } catch {
    raw = null;
  }
  const d = DEFAULT_SETTINGS;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...d };
  const value = raw as Record<string, unknown>;
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
    shellIntegration: bool(value.shellIntegration, d.shellIntegration),
    zmodem: bool(value.zmodem, d.zmodem),
    theme: typeof value.theme === "string" && isThemeId(value.theme) ? value.theme : d.theme,
    fontFamily: cleanFontFamily(value.fontFamily),
    fontWeight: FONT_WEIGHTS.includes(value.fontWeight as number) ? (value.fontWeight as number) : d.fontWeight,
    lineHeight: LINE_HEIGHTS.includes(value.lineHeight as number) ? (value.lineHeight as number) : d.lineHeight,
    remoteMonitor: bool(value.remoteMonitor, d.remoteMonitor),
    sshAutoReconnect: bool(value.sshAutoReconnect, d.sshAutoReconnect),
    syncFolder: typeof value.syncFolder === "string" ? value.syncFolder.trim() : d.syncFolder,
    settingsSyncFolder:
      typeof value.settingsSyncFolder === "string" ? value.settingsSyncFolder.trim() : d.settingsSyncFolder,
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
    // DEV mode's tab column too, with its own choice.
    devColumnCollapsed:
      sidebarAtStartupOf(value.devColumnAtStartup) === "last"
        ? bool(value.devColumnCollapsed, d.devColumnCollapsed)
        : sidebarAtStartupOf(value.devColumnAtStartup) === "collapsed",
    devColumnHideWhenCollapsed: bool(value.devColumnHideWhenCollapsed, d.devColumnHideWhenCollapsed),
    devColumnAtStartup: sidebarAtStartupOf(value.devColumnAtStartup),
    recentFolderLimit: size(value.recentFolderLimit, clampRecentFolderLimit, d.recentFolderLimit),
    devFolderInFooter: bool(value.devFolderInFooter, d.devFolderInFooter),
    aiUsageInFooter: bool(value.aiUsageInFooter, d.aiUsageInFooter),
    aiUsageProvider: (AI_USAGE_CHOICES as readonly unknown[]).includes(value.aiUsageProvider)
      ? (value.aiUsageProvider as AiUsageChoice)
      : d.aiUsageProvider,
    localShell: cleanLocalShell(value.localShell),
    localShellArgs: cleanLocalShell(value.localShellArgs),
    localCwd: cleanLocalShell(value.localCwd),
    newTerminalFolder: (NEW_TERMINAL_FOLDERS as readonly unknown[]).includes(value.newTerminalFolder)
      ? (value.newTerminalFolder as NewTerminalFolder)
      : d.newTerminalFolder,
    devNewTerminalFolder: (NEW_TERMINAL_FOLDERS as readonly unknown[]).includes(value.devNewTerminalFolder)
      ? (value.devNewTerminalFolder as NewTerminalFolder)
      : d.devNewTerminalFolder,
    sidebarWidth:
      typeof value.sidebarWidth === "number" && Number.isFinite(value.sidebarWidth)
        ? clampSidebarWidth(value.sidebarWidth)
        : d.sidebarWidth,
    checkUpdates: bool(value.checkUpdates, d.checkUpdates),
    restoreTabs: bool(value.restoreTabs, d.restoreTabs),
    aiSaveChats: bool(value.aiSaveChats, d.aiSaveChats),
    language: isLanguageSetting(value.language) ? value.language : d.language,
    shortcuts,
    shiftEnterNewline: bool(value.shiftEnterNewline, d.shiftEnterNewline),
    attentionNotifications: bool(value.attentionNotifications, d.attentionNotifications),
    commandNotifySeconds: size(value.commandNotifySeconds, clampCommandNotifySeconds, d.commandNotifySeconds),
    logTimestamps: bool(value.logTimestamps, d.logTimestamps),
    highlightRules: Array.isArray(value.highlightRules) ? parseHighlightRules(value.highlightRules) : d.highlightRules,
    gpuAcceleration: bool(value.gpuAcceleration, d.gpuAcceleration),
    gitFileStatus: bool(value.gitFileStatus, d.gitFileStatus),
    viewerAutoSave: bool(value.viewerAutoSave, d.viewerAutoSave),
    viewerPosition: (VIEWER_POSITIONS as readonly unknown[]).includes(value.viewerPosition)
      ? (value.viewerPosition as ViewerPosition)
      : d.viewerPosition,
    viewerChangedLines: bool(value.viewerChangedLines, d.viewerChangedLines),
    toolbarIconsOnly: bool(value.toolbarIconsOnly, d.toolbarIconsOnly),
    toolbarLayout: cleanToolbarLayout(value.toolbarLayout),
    uiFontSize: size(value.uiFontSize, clampUiFontSize, d.uiFontSize),
    chatFontSize: size(value.chatFontSize, clampChatFontSize, d.chatFontSize),
    viewerFontSize: size(value.viewerFontSize, clampViewerFontSize, d.viewerFontSize),
    devCommands: cleanDevCommands(value.devCommands),
    tabColumnWidth:
      typeof value.tabColumnWidth === "number" && Number.isFinite(value.tabColumnWidth)
        ? clampTabColumnWidth(value.tabColumnWidth)
        : d.tabColumnWidth,
    shareRelayUrl: cleanShareUrl(value.shareRelayUrl, ["wss", "ws"]),
    shareViewerOrigin: cleanShareUrl(value.shareViewerOrigin, ["https", "http"]),
    shareViewNeedsApproval: bool(value.shareViewNeedsApproval, d.shareViewNeedsApproval),
    shareSudoReset: bool(value.shareSudoReset, d.shareSudoReset),
    shareBlockLid: bool(value.shareBlockLid, d.shareBlockLid),
    shareRecordInput: bool(value.shareRecordInput, d.shareRecordInput),
    diagnosticLog: bool(value.diagnosticLog, d.diagnosticLog),
    diagnosticLogDir: cleanLocalShell(value.diagnosticLogDir),
    fileIconsList: isIconPack(value.fileIconsList) ? value.fileIconsList : d.fileIconsList,
    fileIconsTree: isIconPack(value.fileIconsTree) ? value.fileIconsTree : d.fileIconsTree,
    focusBorderColor: cleanHexColor(value.focusBorderColor),
    focusBorderStrength: size(value.focusBorderStrength, clampFocusBorderStrength, d.focusBorderStrength),
    paneFooterHeight: size(value.paneFooterHeight, clampPaneFooterHeight, d.paneFooterHeight),
  };
}

export function serializeSettings(settings: TerminalSettings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, ...settings }, null, 2);
}

export type FontStep = "increase" | "decrease" | "reset";

/** Ctrl+= / Ctrl+- / Ctrl+0 (S15.2). */
export function stepFontSize(size: number, step: FontStep): number {
  if (step === "reset") return DEFAULT_SETTINGS.fontSize;
  return clampFontSize(size + (step === "increase" ? 1 : -1));
}

/** The same keys while the AI chat has the focus change its text only. */
export function stepChatFontSize(size: number, step: FontStep): number {
  if (step === "reset") return DEFAULT_SETTINGS.chatFontSize;
  return clampChatFontSize(size + (step === "increase" ? 1 : -1));
}
