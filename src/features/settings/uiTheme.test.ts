import { describe, expect, it } from "vitest";
import { themeById } from "../terminal/themes";
import { contrastRatio, highestContrastOn, mix, toolbarColors, uiColors } from "./uiTheme";

describe("uiColors", () => {
  it("builds the interface colours from the scheme", () => {
    const nord = themeById("nord");
    const colors = uiColors(nord);
    expect(colors["--bg"]).toBe("#2e3440");
    expect(colors["--text"]).toBe(nord.theme.foreground);
    expect(colors["--accent"]).toBe(nord.theme.blue);
    expect(colors["--danger"]).toBe(nord.theme.red);
    expect(colors["--warning"]).toBe(nord.theme.yellow);
    expect(colors["--success"]).toBe(nord.theme.green);
    expect(colors["color-scheme"]).toBe("dark");
  });

  it("layers panels and borders between the background and the text", () => {
    const colors = uiColors(themeById("catppuccin-mocha"));
    const bg = "#1e1e2e";
    const fg = "#cdd6f4";
    expect(colors["--surface"]).toBe(mix(bg, fg, 0.04));
    expect(colors["--surface-2"]).toBe(mix(bg, fg, 0.08));
    expect(colors["--border"]).toBe(mix(bg, fg, 0.16));
    expect(colors["--muted"]).toBe(mix(bg, fg, 0.6));
  });

  it("marks light schemes so native controls are drawn light", () => {
    const colors = uiColors(themeById("solarized-light"));
    expect(colors["color-scheme"]).toBe("light");
    expect(colors["--bg"]).toBe(themeById("solarized-light").theme.background);
  });

  it("picks dark or light text for buttons by the accent's brightness", () => {
    expect(uiColors(themeById("catppuccin-mocha"))["--on-accent"]).toBe("#000000");
    expect(uiColors(themeById("github-light"))["--on-accent"]).toBe("#ffffff");
    expect(uiColors(themeById("catppuccin-mocha"))["--on-warning"]).toBe("#000000");
  });

  it("keeps the original look for the PlexusTerm scheme", () => {
    const colors = uiColors(themeById("plexusterm"));
    expect(colors["--bg"]).toBe("#0f1419");
    expect(colors["--accent"]).toBe("#5ec4ff");
  });
});

describe("mix", () => {
  it("blends two colours by a weight and ignores alpha", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff80", 0.5)).toBe("#808080");
  });

  it("colours git statuses in the file lists with VS Code's defaults for dark and light schemes", () => {
    const dark = uiColors(themeById("nord"));
    expect(dark["--git-modified"]).toBe("#e2c08d");
    expect(dark["--git-added"]).toBe("#81b88b");
    expect(dark["--git-deleted"]).toBe("#c74e39");
    expect(dark["--git-renamed"]).toBe("#73c991");
    expect(dark["--git-untracked"]).toBe("#73c991");
    expect(dark["--git-ignored"]).toBe("#8c8c8c");
    expect(dark["--git-stageModified"]).toBe("#e2c08d");
    expect(dark["--git-stageDeleted"]).toBe("#c74e39");
    expect(dark["--git-conflicting"]).toBe("#e4676b");
    const light = uiColors(themeById("solarized-light"));
    expect(light["--git-modified"]).toBe("#895503");
    expect(light["--git-added"]).toBe("#587c0c");
    expect(light["--git-deleted"]).toBe("#ad0707");
    expect(light["--git-renamed"]).toBe("#007100");
    expect(light["--git-untracked"]).toBe("#007100");
    expect(light["--git-ignored"]).toBe("#8e8e90");
    expect(light["--git-stageModified"]).toBe("#895503");
    expect(light["--git-stageDeleted"]).toBe("#ad0707");
    expect(light["--git-conflicting"]).toBe("#ad0707");
  });

  it("colours code in the file viewer from the scheme's ANSI palette", () => {
    const nord = themeById("nord");
    const colors = uiColors(nord);
    expect(colors["--syntax-keyword"]).toBe(nord.theme.magenta);
    expect(colors["--syntax-string"]).toBe(nord.theme.green);
    expect(colors["--syntax-number"]).toBe(nord.theme.yellow);
    expect(colors["--syntax-function"]).toBe(nord.theme.blue);
    expect(colors["--syntax-type"]).toBe(nord.theme.cyan);
    expect(colors["--syntax-tag"]).toBe(nord.theme.red);
    expect(colors["--syntax-property"]).toBe(nord.theme.brightBlue);
    expect(colors["--syntax-comment"]).toBe(colors["--muted"]);
  });
});

describe("toolbar colours", () => {
  it("keep the toolbar's and its buttons' text readable (WCAG AA, 4.5:1) on any colour", () => {
    const samples = ["#c0392b", "#e74c3c", "#808080", "#777777", "#1e88e5", "#2ecc71", "#f1c40f", "#ffffff", "#000000", "#8e44ad", "#ff6600", "#00bcd4"];
    for (let i = 0; i < 64; i++) samples.push(`#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6)}`);
    for (const colour of samples) {
      const c = toolbarColors(colour);
      expect(contrastRatio(c["--toolbar-bg"], c["--toolbar-fg"]), colour).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c["--toolbar-btn-bg"], c["--toolbar-btn-fg"]), colour).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c["--toolbar-btn-hover"], c["--toolbar-btn-hover-fg"]), colour).toBeGreaterThanOrEqual(4.5);
      expect(c["--toolbar-btn-bg"], colour).not.toBe(colour);
    }
  });

  it("picks black on mid tones where white would be hard to read", () => {
    expect(highestContrastOn("#808080")).toBe("#000000");
    expect(highestContrastOn("#c0392b")).toBe("#ffffff");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  });
});
