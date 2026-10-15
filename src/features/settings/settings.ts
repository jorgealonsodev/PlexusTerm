import { DEFAULT_THEME_ID, isThemeId } from "../terminal/themes";

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
}

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_FAMILY_LENGTH = 200;
export const DEFAULT_FONT_FAMILY = '"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace';
export const MAX_FONT_SIZE = 32;

export const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 14,
  copyOnSelect: true,
  rightClickPastes: true,
  confirmMultilinePaste: true,
  theme: DEFAULT_THEME_ID,
  fontFamily: DEFAULT_FONT_FAMILY,
  remoteMonitor: true,
};

export const clampFontSize = (size: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));

const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/** A trimmed, non-empty font family of at most 200 characters, or the default one. */
export function cleanFontFamily(value: unknown): string {
  const family = typeof value === "string" ? value.trim() : "";
  return family && family.length <= MAX_FONT_FAMILY_LENGTH ? family : DEFAULT_FONT_FAMILY;
}

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
  return {
    fontSize:
      typeof value.fontSize === "number" && Number.isFinite(value.fontSize) ? clampFontSize(value.fontSize) : d.fontSize,
    copyOnSelect: bool(value.copyOnSelect, d.copyOnSelect),
    rightClickPastes: bool(value.rightClickPastes, d.rightClickPastes),
    confirmMultilinePaste: bool(value.confirmMultilinePaste, d.confirmMultilinePaste),
    theme: typeof value.theme === "string" && isThemeId(value.theme) ? value.theme : d.theme,
    fontFamily: cleanFontFamily(value.fontFamily),
    remoteMonitor: bool(value.remoteMonitor, d.remoteMonitor),
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
