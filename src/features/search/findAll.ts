/**
 * Find in all tabs (S3): the text searched in every terminal's buffer, scrollback included. It reads
 * the buffers in memory only; nothing is sent to the sessions.
 */
import { paneIds } from "../panes/paneLayout";
import { isTerminalPane, tabTitle, type Tab } from "../tabs/tabs";


/** One row of a terminal buffer as xterm holds it: untrimmed, and whether it continues the row above. */
export interface BufferRow {
  text: string;
  wrapped: boolean;
}

/** What Find in all tabs uses from a terminal pane. */
export interface FindTarget {
  /** Every row of the pane's active buffer, scrollback first. */
  rows: () => BufferRow[];
  /**
   * Scrolls `row` into sight and selects `length` characters from `column`, a character index into
   * that row's text (a wide character is one); the keyboard goes to the terminal.
   */
  reveal: (row: number, column: number, length: number) => void;
}

/** A pane to search, with the names its results are shown under. */
export interface SearchablePane {
  tabKey: string;
  paneId: string;
  tabTitle: string;
  paneTitle: string;
  rows: () => BufferRow[];
}

export interface FindResult {
  tabKey: string;
  paneId: string;
  tabTitle: string;
  paneTitle: string;
  /** The whole line the match is in (wrapped rows joined, trailing spaces trimmed), and where in it. */
  line: string;
  /** Which logical line of the pane it is: found again by it after the terminal rewraps. */
  lineOrdinal: number;
  index: number;
  /** The buffer row the match starts in, and its character index in that row. */
  row: number;
  column: number;
  length: number;
}

/** At most this many results are listed. */
export const FIND_ALL_LIMIT = 500;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What `rowText` reads of an xterm buffer line (`IBufferLine`). */
interface LineLike {
  length: number;
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
  getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
}

/**
 * A row's text as part of its logical line: when a wide character did not fit at the end of the
 * row, xterm moved it to the next one and left the last cell empty, which is no space of the line.
 */
export function rowText(line: LineLike, next: LineLike | undefined): string {
  const text = line.translateToString(false);
  const last = line.getCell(line.length - 1);
  const pushed = next?.isWrapped && last?.getChars() === "" && last.getWidth() === 1 && next.getCell(0)?.getWidth() === 2;
  return pushed ? text.slice(0, -1) : text;
}

/** A buffer's logical lines: each starts at a row that is not wrapped and takes the wrapped rows after it. */
function logicalLines(rows: BufferRow[]) {
  const lines: { row: number; parts: string[] }[] = [];
  rows.forEach((row, y) => {
    const last = lines[lines.length - 1];
    if (row.wrapped && last) last.parts.push(row.text);
    else lines.push({ row: y, parts: [row.text] });
  });
  return lines;
}

/** The row of a logical line (starting at `row`, made of `parts`) that character `index` is in, and where in it. */
function place(row: number, parts: string[], index: number) {
  let k = 0;
  let column = index;
  while (k < parts.length - 1 && column >= parts[k].length) column -= parts[k++].length;
  return { row: row + k, column };
}

/**
 * Where `result` is in `rows` now: its terminal may have rewrapped (shown at another width) or lost
 * scrollback since the search. The line it was found in is looked for by its text, nearest to the
 * logical line it was; null when it is no longer there.
 */
export function locate(rows: BufferRow[], result: FindResult): { row: number; column: number } | null {
  const lines = logicalLines(rows);
  let best: { row: number; parts: string[] } | null = null;
  let distance = Infinity;
  lines.forEach((line, ordinal) => {
    if (line.parts.join("").trimEnd() !== result.line) return;
    const d = Math.abs(ordinal - result.lineOrdinal);
    if (d < distance) [best, distance] = [line, d];
  });
  const found = best as { row: number; parts: string[] } | null;
  return found ? place(found.row, found.parts, result.index) : null;
}

/**
 * The matches of `query` (plain text) in the panes, in their order, every match of a line counting.
 * `capped` tells there were more than `FIND_ALL_LIMIT`.
 */
export function findInPanes(
  panes: readonly SearchablePane[],
  query: string,
  { matchCase }: { matchCase: boolean },
): { results: FindResult[]; capped: boolean } {
  const results: FindResult[] = [];
  if (query === "") return { results, capped: false };
  const pattern = new RegExp(escapeRegExp(query), matchCase ? "g" : "gi");
  for (const pane of panes) {
    for (const [lineOrdinal, { row, parts }] of logicalLines(pane.rows()).entries()) {
      const line = parts.join("").trimEnd();
      pattern.lastIndex = 0;
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        if (results.length === FIND_ALL_LIMIT) return { results, capped: true };
        const at = place(row, parts, match.index);
        results.push({
          tabKey: pane.tabKey,
          paneId: pane.paneId,
          tabTitle: pane.tabTitle,
          paneTitle: pane.paneTitle,
          line,
          lineOrdinal,
          index: match.index,
          row: at.row,
          column: at.column,
          length: match[0].length,
        });
      }
    }
  }
  return { results, capped: false };
}

/**
 * The panes Find in all tabs searches, tab by tab in visual order: the terminals only, never a file
 * viewer, an AI chat or a shared terminal someone else runs, and only those that handed out a target.
 */
export function searchablePanes(
  tabs: readonly Tab[],
  targetOf: (paneId: string) => FindTarget | undefined,
  paneTitleOf: (paneId: string) => string,
): SearchablePane[] {
  return tabs.flatMap((tab) => {
    if (tab.target.type === "shared") return [];
    return paneIds(tab.layout).flatMap((paneId) => {
      const target = isTerminalPane(tab, paneId) ? targetOf(paneId) : undefined;
      if (!target) return [];
      return [{ tabKey: tab.key, paneId, tabTitle: tabTitle(tab), paneTitle: paneTitleOf(paneId), rows: target.rows }];
    });
  });
}
