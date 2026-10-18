/**
 * The terminal font catalogue: the fonts shipped with PlexusTerm, which look the same everywhere,
 * and the well-known monospaced fonts found installed on this computer.
 */
import { DEFAULT_FONT_FAMILY } from "./settings";

export interface BundledFont {
  name: string;
  /** The value saved in the settings: the bundled family, then the generic one. */
  family: string;
}

/**
 * Shipped with the app and loaded in main.tsx: `@fontsource-variable/*` (SIL Open Font License) and
 * Hack from `hack-font` (MIT and Bitstream Vera licenses), registered in src/fonts.ts.
 */
export const BUNDLED_FONTS: BundledFont[] = [
  { name: "JetBrains Mono", family: '"JetBrains Mono Variable", monospace' },
  { name: "Fira Code", family: '"Fira Code Variable", monospace' },
  { name: "Cascadia Code", family: '"Cascadia Code Variable", monospace' },
  { name: "Source Code Pro", family: '"Source Code Pro Variable", monospace' },
  { name: "Hack", family: '"Hack Web", monospace' },
];

/** Monospaced families looked for on this computer, beyond the bundled ones. */
export const INSTALLED_CANDIDATES = [
  "Cascadia Mono",
  "Consolas",
  "Lucida Console",
  "Courier New",
  "DejaVu Sans Mono",
  "Liberation Mono",
  "Noto Sans Mono",
  "Ubuntu Mono",
  "Droid Sans Mono",
  "Fira Mono",
  "Inconsolata",
  "Iosevka",
  "IBM Plex Mono",
  "Roboto Mono",
  "Victor Mono",
  "Anonymous Pro",
  "Space Mono",
  "Go Mono",
  "Menlo",
  "Monaco",
  "SF Mono",
  "MesloLGS NF",
  "Hack Nerd Font",
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font",
  "CaskaydiaCove Nerd Font",
  "Terminus",
];

/** Width of a sample text drawn with a CSS `font` shorthand. */
export type MeasureText = (font: string) => number;

const FALLBACKS = ["monospace", "serif", "sans-serif"];

/**
 * The candidates installed here. A font is installed when text drawn with it, falling back to a
 * generic family, differs in width from the generic family alone (the usual canvas check).
 */
export function detectInstalledFonts(measure: MeasureText = canvasMeasure()): string[] {
  try {
    const plain = FALLBACKS.map((fallback) => measure(`72px ${fallback}`));
    return INSTALLED_CANDIDATES.filter((name) =>
      FALLBACKS.some((fallback, i) => measure(`72px "${name}", ${fallback}`) !== plain[i]),
    );
  } catch {
    return [];
  }
}

const SAMPLE = "mmmmmmmmmmlli1|WW@#0Oo";

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A 2D context to measure with; none in jsdom, which cannot draw text (and logs every try). */
function measuringContext(): Context2D | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(1, 1).getContext("2d");
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) return null;
  return document.createElement("canvas").getContext("2d");
}

function canvasMeasure(): MeasureText {
  let context: Context2D | null | undefined;
  return (font) => {
    if (context === undefined) context = measuringContext();
    if (!context) return 0;
    context.font = font;
    return context.measureText(SAMPLE).width;
  };
}

/** The catalogue entry a font family setting matches, or "" when it was typed by hand. */
export function catalogChoice(fontFamily: string, installed: string[]): string {
  const value = fontFamily.trim();
  if (value === DEFAULT_FONT_FAMILY) return DEFAULT_FONT_FAMILY;
  if (BUNDLED_FONTS.some((font) => font.family === value)) return value;
  return installed.includes(value) ? value : "";
}
