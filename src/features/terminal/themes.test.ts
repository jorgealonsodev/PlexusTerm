import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, TERMINAL_THEMES, themeById } from "./themes";

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

describe("terminal themes", () => {
  it("ships the requested schemes plus PlexusTerm, each with a unique id", () => {
    const names = TERMINAL_THEMES.map((t) => t.name);
    expect(TERMINAL_THEMES).toHaveLength(57);
    expect(new Set(TERMINAL_THEMES.map((t) => t.id)).size).toBe(57);
    for (const name of ["PlexusTerm", "Catppuccin Mocha", "Catppuccin Frappé", "Rosé Pine Dawn", "Laser", "3024 Day"]) {
      expect(names).toContain(name);
    }
  });

  it("leaves out the paid schemes", () => {
    const names = TERMINAL_THEMES.map((t) => t.name.toLowerCase());
    expect(names.filter((n) => n.includes("pro"))).toEqual([]);
  });

  it("gives every theme a background, a foreground, a cursor and the 16 ANSI colours", () => {
    const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
    for (const { id, theme } of TERMINAL_THEMES) {
      for (const key of ["background", "foreground", "cursor", "cursorAccent", ...ANSI] as const) {
        expect(theme[key], `${id}.${key}`).toMatch(hex);
      }
    }
  });

  it("marks light and dark themes by their background", () => {
    expect(themeById("catppuccin-latte").dark).toBe(false);
    expect(themeById("solarized-light").dark).toBe(false);
    expect(themeById("catppuccin-mocha").dark).toBe(true);
    expect(themeById("plexusterm").dark).toBe(true);
  });

  it("uses Catppuccin Mocha by default and for unknown ids", () => {
    expect(DEFAULT_THEME_ID).toBe("catppuccin-mocha");
    expect(themeById("no-such-theme").id).toBe("catppuccin-mocha");
    expect(themeById("catppuccin-mocha").theme.background).toBe("#1e1e2e");
  });
});
