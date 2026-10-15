import type { ITheme } from "@xterm/xterm";
import { IMPORTED_THEMES } from "./themes.generated";

/** A colour scheme the terminal can use; `dark` groups it in the settings. */
export interface TerminalThemeEntry {
  id: string;
  name: string;
  dark: boolean;
  theme: ITheme;
}

/** PlexusTerm's own dark palette (the only scheme before colour schemes were added). */
const PLEXUSTERM: TerminalThemeEntry = {
  id: "plexusterm",
  name: "PlexusTerm",
  dark: true,
  theme: {
    background: "#0f1419",
    foreground: "#d8dee9",
    cursor: "#5ec4ff",
    cursorAccent: "#0f1419",
    selectionBackground: "#2a3b4d",
    black: "#1b2229",
    red: "#ef6b73",
    green: "#8bd49c",
    yellow: "#ebcb8b",
    blue: "#5ec4ff",
    magenta: "#c594c5",
    cyan: "#70e1e8",
    white: "#d8dee9",
    brightBlack: "#4f5b66",
    brightRed: "#ff8a91",
    brightGreen: "#a6e3b4",
    brightYellow: "#f5dba5",
    brightBlue: "#8ad4ff",
    brightMagenta: "#dbb3db",
    brightCyan: "#9aeef2",
    brightWhite: "#ffffff",
  },
};

export const TERMINAL_THEMES: TerminalThemeEntry[] = [PLEXUSTERM, ...IMPORTED_THEMES];

export const DEFAULT_THEME_ID = "catppuccin-mocha";

const byId = new Map(TERMINAL_THEMES.map((entry) => [entry.id, entry]));

export const isThemeId = (id: string) => byId.has(id);

/** The scheme with this id, or the default one for an unknown id. */
export const themeById = (id: string): TerminalThemeEntry => byId.get(id) ?? byId.get(DEFAULT_THEME_ID)!;
