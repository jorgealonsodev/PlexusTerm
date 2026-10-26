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
  row(y: number): { wrapped: boolean; text(start?: number, end?: number, trimRight?: boolean): string } | null;
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
 * prompt included); null when the cursor is not after the mark.
 */
export function commandLineAt(screen: ScreenRows, start: Cell, cursor: Cell): CommandLine | null {
  if (cursor.row < start.row || (cursor.row === start.row && cursor.col < start.col)) return null;
  let last = cursor.row;
  while (screen.row(last + 1)?.wrapped) last += 1;
  let text = "";
  let beforeCursor = "";
  for (let y = start.row; y <= last; y += 1) {
    const row = screen.row(y);
    if (!row) break;
    const from = y === start.row ? start.col : 0;
    // A row the next one wraps from is full: its trailing spaces are part of the command.
    const continues = screen.row(y + 1)?.wrapped ?? false;
    const separator = y > start.row && !row.wrapped ? "\n" : "";
    if (y < cursor.row) beforeCursor += separator + row.text(from, undefined, !continues);
    if (y === cursor.row) beforeCursor += separator + row.text(from, cursor.col);
    text += separator + row.text(from, undefined, !continues || y === last);
  }
  return { text: text.trimEnd(), beforeCursor };
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
