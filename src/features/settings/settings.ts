import { isLanguageSetting, type LanguageSetting } from "../../i18n/i18n";
import { DEFAULT_THEME_ID, isThemeId } from "../terminal/themes";
import { appShortcutConflict, isValidShortcut } from "./shortcutCapture";

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
  /** Ask GitHub for a newer release when PlexusTerm starts. */
  checkUpdates: boolean;
  /** Interface language; "system" follows the operating system, English when it is not supported. */
  language: LanguageSetting;
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
  theme: DEFAULT_THEME_ID,
  fontFamily: DEFAULT_FONT_FAMILY,
  remoteMonitor: true,
  textEditor: "",
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
  checkUpdates: true,
  language: "system",
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

/** A valid shortcut that PlexusTerm does not already use, or the default one. */
export const cleanAssistantShortcut = (value: unknown): string =>
  typeof value === "string" && isValidShortcut(value) && !appShortcutConflict(value) ? value : DEFAULT_ASSISTANT_SHORTCUT;

/** The CSS font list for a setting: a single name is quoted and falls back to monospace. */
export const cssFontFamily = (family: string) => (/[,"']/.test(family) ? family : `"${family}", monospace`);

/**
 * Reads settings.json. A missing or unreadable file gives the defaults; every invalid value
 * falls back to its default (the font size is clamped) and unknown keys are ignored.
 */
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
  return {
    fontSize:
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize) ? clampFontSize(value.fontSize) : d.fontSize,
    copyOnSelect: bool(value.copyOnSelect, d.copyOnSelect),
    rightClickPastes: bool(value.rightClickPastes, d.rightClickPastes),
    confirmMultilinePaste: bool(value.confirmMultilinePaste, d.confirmMultilinePaste),
    theme: typeof value.theme === "string" && isThemeId(value.theme) ? value.theme : d.theme,
    fontFamily: cleanFontFamily(value.fontFamily),
    remoteMonitor: bool(value.remoteMonitor, d.remoteMonitor),
    textEditor: cleanTextEditor(value.textEditor),
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
    assistantShortcut: cleanAssistantShortcut(value.assistantShortcut),
    sidebarCollapsed: bool(value.sidebarCollapsed, d.sidebarCollapsed),
    sidebarHideWhenCollapsed: bool(value.sidebarHideWhenCollapsed, d.sidebarHideWhenCollapsed),
    checkUpdates: bool(value.checkUpdates, d.checkUpdates),
    language: isLanguageSetting(value.language) ? value.language : d.language,
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
