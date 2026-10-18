import { describe, expect, it } from "vitest";
import { BUNDLED_FONTS, catalogChoice, detectInstalledFonts, INSTALLED_CANDIDATES } from "./fontCatalog";
import { DEFAULT_FONT_FAMILY } from "./settings";

/** A measure where only `installed` fonts change the width of the text drawn with them. */
const measureWith = (installed: string[]) => (font: string) => {
  const family = /"([^"]+)"/.exec(font)?.[1];
  const fallback = font.trim().split(/[\s,]+/).pop()!;
  const base = { monospace: 600, serif: 520, "sans-serif": 540 }[fallback] ?? 500;
  return family && installed.includes(family) ? 610 : base;
};

describe("BUNDLED_FONTS", () => {
  it("lists the fonts shipped with the app, each with a CSS family list that ends in monospace", () => {
    expect(BUNDLED_FONTS.map((f) => f.name)).toEqual(["JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro", "Hack"]);
    for (const font of BUNDLED_FONTS) expect(font.family).toMatch(/^"[^"]+ (Variable|Web)", monospace$/);
    // Bundled names never take over a font of the same name installed on the computer.
    for (const font of BUNDLED_FONTS) expect(INSTALLED_CANDIDATES).not.toContain(font.name);
  });
});

describe("detectInstalledFonts", () => {
  it("finds the candidates whose text is drawn differently from every fallback", () => {
    expect(detectInstalledFonts(measureWith(["Consolas", "Ubuntu Mono"]))).toEqual(["Consolas", "Ubuntu Mono"]);
  });

  it("finds none when nothing can be measured", () => {
    expect(detectInstalledFonts(() => 0)).toEqual([]);
    expect(
      detectInstalledFonts(() => {
        throw new Error("no canvas");
      }),
    ).toEqual([]);
  });

  it("only tries known monospaced families, each once", () => {
    expect(new Set(INSTALLED_CANDIDATES).size).toBe(INSTALLED_CANDIDATES.length);
    expect(detectInstalledFonts(measureWith(["Comic Sans MS"]))).toEqual([]);
  });
});

describe("catalogChoice", () => {
  const installed = ["Consolas"];

  it("names the catalogue entry a font family setting matches", () => {
    expect(catalogChoice(DEFAULT_FONT_FAMILY, installed)).toBe(DEFAULT_FONT_FAMILY);
    expect(catalogChoice('"Fira Code Variable", monospace', installed)).toBe('"Fira Code Variable", monospace');
    expect(catalogChoice(" Consolas ", installed)).toBe("Consolas");
  });

  it("is empty for anything typed by hand", () => {
    expect(catalogChoice("Hack Nerd Font", installed)).toBe("");
    expect(catalogChoice('"Consolas", serif', installed)).toBe("");
  });
});
