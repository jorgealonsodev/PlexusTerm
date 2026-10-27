import type { IBufferCell } from "@xterm/xterm";

/**
 * OSC 133 shell integration marks (FinalTerm's, as VS Code, Windows Terminal and WezTerm read them):
 * A the prompt starts, B the command line starts (after the prompt), C the command runs, D it
 * finished, with its exit code when the shell gives it.
 */
export type ShellMark = { kind: "A" } | { kind: "B" } | { kind: "C" } | { kind: "D"; exit: number | null };

/** The mark of an OSC 133 payload (`D;0`, `A;aid=12`...); null for the ones PlexusTerm does not use. */
export function parseOsc133(data: string): ShellMark | null {
  const [kind, first] = data.split(";");
  if (kind === "A" || kind === "B" || kind === "C") return { kind };
  if (kind !== "D") return null;
  return { kind, exit: first !== undefined && /^\d+$/.test(first) ? Number(first) : null };
}

/** The screen as `commandLineAt` reads it: xterm's buffer lines, by absolute row. */
export interface ScreenRows {
  cols: number;
  row(y: number): {
    wrapped: boolean;
    text(start?: number, end?: number, trimRight?: boolean): string;
    /** The cell is drawn dim or grey, as shells draw an autosuggestion (fish, zsh-autosuggestions). */
    drawn(col: number): boolean;
  } | null;
}

/**
 * A cell drawn dim or grey: how fish (brblack or #555) and zsh-autosuggestions (colour 8) draw the
 * suggestion after the cursor, which is not typed text.
 */
export function isDrawnGrey(cell: Pick<IBufferCell, "isDim" | "isFgPalette" | "isFgRGB" | "getFgColor">): boolean {
  if (cell.isDim()) return true;
  const fg = cell.getFgColor();
  if (cell.isFgPalette()) return fg === 8 || (fg >= 240 && fg <= 248);
  if (!cell.isFgRGB()) return false;
  const [r, g, b] = [(fg >> 16) & 0xff, (fg >> 8) & 0xff, fg & 0xff];
  return r === g && g === b && r >= 0x40 && r <= 0xa0;
}

export interface Cell {
  row: number;
  col: number;
}

/** The command line being typed, and the part of it before the cursor. */
export interface CommandLine {
  text: string;
  /**
   * What the user typed up to the cursor; after it the screen may also show a suggestion the shell
   * drew itself (fish, zsh-autosuggestions), which is not typed text.
   */
  beforeCursor: string;
}

/**
 * The command line from the B mark (`start`) to the end of the input: the cursor's row and the rows
 * that wrap from it. Lines of a multi-line command are joined with line breaks (their continuation
 * prompt included); null when the cursor is not after the mark. After the cursor, only typed text
 * counts: it ends where the shell drew a grey autosuggestion or a right prompt.
 */
export function commandLineAt(screen: ScreenRows, start: Cell, cursor: Cell): CommandLine | null {
  if (cursor.row < start.row || (cursor.row === start.row && cursor.col < start.col)) return null;
  let last = cursor.row;
  while (screen.row(last + 1)?.wrapped) last += 1;
  let beforeCursor = "";
  for (let y = start.row; y <= cursor.row; y += 1) {
    const row = screen.row(y);
    if (!row) break;
    const from = y === start.row ? start.col : 0;
    const separator = y > start.row && !row.wrapped ? "\n" : "";
    // A row the next one wraps from is full: its trailing spaces are part of the command.
    const continues = screen.row(y + 1)?.wrapped ?? false;
    beforeCursor += separator + (y < cursor.row ? row.text(from, undefined, !continues) : row.text(from, cursor.col));
  }
  return { text: (beforeCursor + typedAfter(screen, cursor, last)).trimEnd(), beforeCursor };
}

/** The typed text from the cursor to the end of row `last`, without what the shell drew there. */
function typedAfter(screen: ScreenRows, cursor: Cell, last: number): string {
  const cells: string[] = [];
  let lastRowFrom = 0;
  let firstCol = 0;
  for (let y = cursor.row; y <= last; y += 1) {
    const row = screen.row(y);
    if (!row) break;
    lastRowFrom = cells.length;
    firstCol = y === cursor.row ? cursor.col : 0;
    for (let col = firstCol; col < screen.cols; col += 1) {
      if (row.drawn(col)) return cells.join("");
      cells.push(row.text(col, col + 1));
    }
  }
  const lastRow = cells.slice(lastRowFrom).join("");
  return cells.slice(0, lastRowFrom).join("") + withoutRightPrompt(lastRow, firstCol, screen.cols);
}

/**
 * The input's last row, from `firstCol`, without a right prompt (zsh's RPROMPT, fish_right_prompt):
 * text after a gap of two or more spaces that ends one column or less from the right edge.
 */
function withoutRightPrompt(text: string, firstCol: number, cols: number): string {
  const trimmed = text.trimEnd();
  // The column after the last character, against the right edge or one column from it.
  if (firstCol + trimmed.length < cols - 1) return text;
  const gap = trimmed.search(/ {2,}\S+(?: \S+)*$/);
  return gap >= 0 ? trimmed.slice(0, gap) : text;
}

/**
 * The command line being typed on one row (or rows that wrap from it); null when it spans lines:
 * a multi-line command at its continuation prompt, or a command's output when the shell gave no
 * C mark (bash before 4.4), where the screen no longer shows what is typed.
 */
export function typedLineAt(screen: ScreenRows, start: Cell, cursor: Cell): CommandLine | null {
  const line = commandLineAt(screen, start, cursor);
  return line && !line.text.includes("\n") ? line : null;
}
