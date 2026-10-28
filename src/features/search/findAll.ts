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
  index: number;
  /** The buffer row the match starts in, and its character index in that row. */
  row: number;
  column: number;
  length: number;
}

/** At most this many results are listed. */
export const FIND_ALL_LIMIT = 500;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    for (const { row, parts } of logicalLines(pane.rows())) {
      const line = parts.join("").trimEnd();
      pattern.lastIndex = 0;
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        if (results.length === FIND_ALL_LIMIT) return { results, capped: true };
        // The row of the line the match starts in, and where in that row.
        let k = 0;
        let start = match.index;
        while (k < parts.length - 1 && start >= parts[k].length) start -= parts[k++].length;
        results.push({
          tabKey: pane.tabKey,
          paneId: pane.paneId,
          tabTitle: pane.tabTitle,
          paneTitle: pane.paneTitle,
          line,
          index: match.index,
          row: row + k,
          column: start,
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
