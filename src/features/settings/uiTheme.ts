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
export const readableOn = (background: string) => (luminance(background) > 0.4 ? "#000000" : "#ffffff");

/** WCAG relative luminance of a #rrggbb colour. */
const relativeLuminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio of two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever has the higher contrast ratio on `background`. */
export const highestContrastOn = (background: string) =>
  contrastRatio(background, "#000000") >= contrastRatio(background, "#ffffff") ? "#000000" : "#ffffff";

/**
 * The colours of a toolbar painted `background`: its text, and its buttons as a shade of the same
 * colour (towards the text colour), each with the text, black or white, that contrasts most on it.
 */
export function toolbarColors(background: string): Record<string, string> {
  const fg = highestContrastOn(background);
  const button = mix(background, fg, 0.16);
  const hover = mix(background, fg, 0.26);
  return {
    "--toolbar-bg": background,
    "--toolbar-fg": fg,
    "--toolbar-btn-bg": button,
    "--toolbar-btn-fg": highestContrastOn(button),
    "--toolbar-btn-hover": hover,
    "--toolbar-btn-hover-fg": highestContrastOn(hover),
    "--toolbar-btn-border": mix(background, fg, 0.34),
  };
}

/**
 * VS Code's `gitDecoration.*ResourceForeground` defaults (dark, light), for the git status of the
 * file lists (`--git-<name>`).
 */
const GIT_COLORS: Record<string, [string, string]> = {
  added: ["#81b88b", "#587c0c"],
  modified: ["#e2c08d", "#895503"],
  deleted: ["#c74e39", "#ad0707"],
  renamed: ["#73c991", "#007100"],
  untracked: ["#73c991", "#007100"],
  ignored: ["#8c8c8c", "#8e8e90"],
  stageModified: ["#e2c08d", "#895503"],
  stageDeleted: ["#c74e39", "#ad0707"],
  conflicting: ["#e4676b", "#ad0707"],
};

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
    // Code in the file viewer, from the ANSI palette as terminal programs colour it.
    "--syntax-keyword": theme.magenta!,
    "--syntax-string": theme.green!,
    "--syntax-number": theme.yellow!,
    "--syntax-function": theme.blue!,
    "--syntax-type": theme.cyan!,
    "--syntax-tag": theme.red!,
    "--syntax-property": theme.brightBlue ?? theme.blue!,
    "--syntax-comment": mix(bg, fg, 0.6),
    ...Object.fromEntries(Object.entries(GIT_COLORS).map(([name, [onDark, onLight]]) => [`--git-${name}`, dark ? onDark : onLight])),
    "color-scheme": dark ? "dark" : "light",
  };
}

/** Applies a scheme's interface colours to the whole document. */
export function applyUiTheme(entry: TerminalThemeEntry, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(uiColors(entry))) root.style.setProperty(name, value);
  root.dataset.theme = entry.dark ? "dark" : "light";
}
