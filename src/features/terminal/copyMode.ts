/**
 * Copy mode: a cursor that moves over the terminal's buffer from the keyboard (arrows or h/j/k/l,
 * w/b words, 0/$ line, PgUp/PgDn, g/G top and bottom), selects with v and copies with y or Enter.
 * Pure: the pane gives it the buffer and applies the result (selection, scroll, clipboard).
 */
import type { KeyLike } from "../panes/shortcuts";

/** What copy mode reads of the active buffer. */
export interface CopyBuffer {
  /** Lines in the buffer, scrollback included. */
  length: number;
  cols: number;
  /** Rows on screen. */
  rows: number;
  /** The first buffer line on screen. */
  viewportY: number;
  /** The text of buffer line `y`, without its trailing blanks. */
  lineText: (y: number) => string;
}

/** The cursor (buffer column and line) and where `v` started the selection, if it did. */
export interface CopyState {
  x: number;
  y: number;
  anchor: { x: number; y: number } | null;
}

/** "copy": copy the selection and leave; "exit": leave; "stay": go on (the key was used or ignored). */
export type CopyAction = "stay" | "copy" | "exit";

/** The mode starts on the terminal's cursor (`cursorY` counts from `baseY`, the screen's first line). */
export function startCopyMode(cursor: { cursorX: number; cursorY: number; baseY: number }, cols: number): CopyState {
  return {
    x: Math.min(cursor.cursorX, cols - 1),
    y: cursor.baseY + cursor.cursorY,
    anchor: null,
  };
}

const isWordChar = (char: string | undefined) => char !== undefined && char !== " " && char !== "\t";

/** The start of the next word after (x, y), on this line or the following ones; null at the end. */
function nextWord(x: number, y: number, buf: CopyBuffer): { x: number; y: number } | null {
  let line = buf.lineText(y);
  let i = x;
  // Leave the word under the cursor, then the blanks after it.
  while (isWordChar(line[i])) i++;
  for (;;) {
    while (i < line.length && !isWordChar(line[i])) i++;
    if (i < line.length) return { x: i, y };
    if (++y >= buf.length) return null;
    line = buf.lineText(y);
    i = 0;
  }
}

/** The start of the word before (x, y), or of the word the cursor is inside; null at the top. */
function previousWord(x: number, y: number, buf: CopyBuffer): { x: number; y: number } | null {
  let line = buf.lineText(y);
  let i = Math.min(x, line.length) - 1;
  for (;;) {
    while (i >= 0 && !isWordChar(line[i])) i--;
    if (i >= 0) {
      while (i > 0 && isWordChar(line[i - 1])) i--;
      return { x: i, y };
    }
    if (--y < 0) return null;
    line = buf.lineText(y);
    i = line.length - 1;
  }
}

/** Applies one key; keys with Ctrl, Alt or Meta, and keys copy mode does not know, change nothing. */
export function copyModeKey(state: CopyState, e: KeyLike, buf: CopyBuffer): { state: CopyState; action: CopyAction } {
  const stay = (next: Partial<CopyState> = {}) => ({
    state: { ...state, ...next },
    action: "stay" as const,
  });
  if (e.ctrlKey || e.altKey || e.metaKey) return stay();
  const lastLine = Math.max(0, buf.length - 1);
  const line = (y: number) => Math.max(0, Math.min(y, lastLine));
  switch (e.key) {
    case "Escape":
    case "q":
      return { state, action: "exit" };
    case "y":
    case "Enter":
      return { state, action: "copy" };
    case "v":
      return stay({ anchor: state.anchor ? null : { x: state.x, y: state.y } });
    case "ArrowLeft":
    case "h":
      return stay({ x: Math.max(0, state.x - 1) });
    case "ArrowRight":
    case "l":
      return stay({ x: Math.min(buf.cols - 1, state.x + 1) });
    case "ArrowUp":
    case "k":
      return stay({ y: line(state.y - 1) });
    case "ArrowDown":
    case "j":
      return stay({ y: line(state.y + 1) });
    case "PageUp":
      return stay({ y: line(state.y - buf.rows) });
    case "PageDown":
      return stay({ y: line(state.y + buf.rows) });
    case "0":
    case "Home":
      return stay({ x: 0 });
    case "$":
    case "End":
      return stay({
        x: Math.max(0, Math.min(buf.cols - 1, buf.lineText(state.y).length - 1)),
      });
    case "g":
      return stay({ x: 0, y: 0 });
    case "G":
      return stay({ x: 0, y: lastLine });
    case "w":
      return stay(nextWord(state.x, state.y, buf) ?? {});
    case "b":
      return stay(previousWord(state.x, state.y, buf) ?? {});
    default:
      return stay();
  }
}

/** The selection from the anchor to the cursor, both cells included, as xterm's `select` takes it. */
export function selectionRange(state: CopyState, cols: number): { column: number; row: number; length: number } | null {
  const anchor = state.anchor;
  if (!anchor) return null;
  const before = anchor.y < state.y || (anchor.y === state.y && anchor.x <= state.x);
  const [start, end] = before ? [anchor, state] : [state, anchor];
  return {
    column: start.x,
    row: start.y,
    length: (end.y - start.y) * cols + end.x - start.x + 1,
  };
}

/** The viewport's new first line so that line `y` is on screen, or null when it already is. */
export function scrollFor(y: number, viewportY: number, rows: number): number | null {
  if (y < viewportY) return y;
  if (y >= viewportY + rows) return y - rows + 1;
  return null;
}
