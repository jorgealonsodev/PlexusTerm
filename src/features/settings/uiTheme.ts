import type { TerminalThemeEntry } from "../terminal/themes";

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

const toHex = (values: number[]) => `#${values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** `weight` of the way from `from` to `to` (both #rrggbb, an alpha suffix is ignored). */
export function mix(from: string, to: string, weight: number): string {
  const a = channels(from);
  const b = channels(to);
  return toHex(a.map((v, i) => v + (b[i] - v) * weight));
}

const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever reads better on `background`. */
const readableOn = (background: string) => (luminance(background) > 0.4 ? "#000000" : "#ffffff");

/**
 * CSS custom properties of the window (toolbar, sidebar, dialogs) for a colour scheme,
 * so the whole interface follows the terminal's scheme. Panels and borders are layered
 * from the background towards the text; status colours come from the ANSI palette.
 */
export function uiColors({ dark, theme }: TerminalThemeEntry): Record<string, string> {
  const bg = theme.background!;
  const fg = theme.foreground!;
  const accent = theme.blue!;
  return {
    "--bg": bg,
    "--surface": mix(bg, fg, 0.04),
    "--surface-2": mix(bg, fg, 0.08),
    "--border": mix(bg, fg, 0.16),
    "--text": fg,
    "--muted": mix(bg, fg, 0.6),
    "--accent": accent,
    "--on-accent": readableOn(accent),
    "--on-warning": readableOn(theme.yellow!),
    "--danger": theme.red!,
    "--warning": theme.yellow!,
    "--success": theme.green!,
    "color-scheme": dark ? "dark" : "light",
  };
}

/** Applies a scheme's interface colours to the whole document. */
export function applyUiTheme(entry: TerminalThemeEntry, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(uiColors(entry))) root.style.setProperty(name, value);
  root.dataset.theme = entry.dark ? "dark" : "light";
}
