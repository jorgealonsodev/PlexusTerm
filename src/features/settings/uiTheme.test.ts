import { describe, expect, it } from "vitest";
import { themeById } from "../terminal/themes";
import { mix, uiColors } from "./uiTheme";

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
});
