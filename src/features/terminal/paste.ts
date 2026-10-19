import type { TerminalSettings } from "../settings/settings";

/** How many lines the paste confirmation shows. */
export const PREVIEW_LINES = 5;

export type PastePlan =
  /** An empty clipboard is an empty paste: an AI CLI then reads an image from the clipboard itself. */
  | { kind: "direct"; text: string }
  /** More than one line: ask first, showing the line count and the first lines (S15.3). */
  | { kind: "confirm"; text: string; lineCount: number; preview: string[] };

/** Decides whether pasted text goes straight to the terminal or needs a confirmation. */
export function pastePlan(text: string, settings: Pick<TerminalSettings, "confirmMultilinePaste">): PastePlan {
  const lines = text.split(/\r\n|\r|\n/);
  // A final line break ends the last line; it does not start another one.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= 1 || !settings.confirmMultilinePaste) return { kind: "direct", text };
  return { kind: "confirm", text, lineCount: lines.length, preview: lines.slice(0, PREVIEW_LINES) };
}
