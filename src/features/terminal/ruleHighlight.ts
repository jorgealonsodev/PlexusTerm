/**
 * Colours the matches of the user's highlight rules in a terminal as output arrives, and tells
 * when new output matches a rule that notifies. Only the matched text is coloured (decorations drawn
 * over it: the output itself never changes). Rows on the screen can be rewritten, so they are read
 * again on every write; rows that scrolled away keep their colours and are never read again.
 */
import { ruleMatches, type CompiledRule } from "./highlightRules";

interface Disposable {
  dispose(): void;
}
interface Marker extends Disposable {
  readonly line: number;
  readonly isDisposed: boolean;
}
interface Cell {
  getChars(): string;
  getWidth(): number;
}
interface Row {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number): Cell | undefined;
}

/** The part of xterm's Terminal this module uses. */
export interface RuleTerminal {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      readonly baseY: number;
      readonly cursorY: number;
      getLine(y: number): Row | undefined;
    };
  };
  registerMarker(cursorYOffset?: number): Marker | undefined;
  registerDecoration(options: { marker: Marker; x?: number; width?: number; foregroundColor?: string; layer?: "bottom" | "top" }): Disposable | undefined;
  onWriteParsed(listener: () => void): Disposable;
}

export interface RuleHighlight {
  /** The rules changed, or the colours must be drawn again (size, scheme): clears and reads everything. */
  refresh(): void;
  dispose(): void;
}

/** Most coloured matches kept; older ones lose their colour (xterm calls every marker on each scrolled row). */
export const MAX_COLOURED = 1000;
/** A rule that notifies does so at most this often. */
export const NOTIFY_EVERY_MS = 10_000;

/** One line (a row and the rows wrapped after it): its text, and for each character its row and column. */
function lineText(rows: Row[], first: number) {
  let text = "";
  const at: { row: number; col: number; width: number }[] = [];
  rows.forEach((row, i) => {
    for (let x = 0; x < row.length; x++) {
      const cell = row.getCell(x);
      const width = cell?.getWidth() ?? 1;
      if (width === 0) continue; // the second half of a wide character
      const chars = cell?.getChars() || " ";
      for (let u = 0; u < chars.length; u++) at.push({ row: first + i, col: x, width });
      text += chars;
    }
  });
  return { text, at };
}

export function attachRuleHighlight(
  term: RuleTerminal,
  options: {
    rules: () => readonly CompiledRule[];
    /** New output matched rule number `rule`; `line` is its text. */
    onNotify?: (rule: number, line: string) => void;
    schedule?: (scan: () => void) => void;
    now?: () => number;
    maxColoured?: number;
  },
): RuleHighlight {
  const maxColoured = options.maxColoured ?? MAX_COLOURED;
  const now = options.now ?? (() => Date.now());
  /** Every colour kept, oldest first. */
  let coloured: { marker: Marker; decoration: Disposable }[] = [];
  /** The first row never read; rows below it are new output (they may notify). */
  let unread: Marker | null = null;
  const lastNotified = new Map<number, number>();

  const drop = (c: { marker: Marker; decoration: Disposable }) => {
    c.decoration.dispose();
    c.marker.dispose();
  };

  /** Colours the matches on the line starting at row `first`; returns the row after it. */
  const colourLine = (first: number, end: number, cursor: number, fresh: boolean, rules: readonly CompiledRule[]) => {
    const buffer = term.buffer.active;
    const rows: Row[] = [];
    let last = first;
    for (let r = first; r < end; r++) {
      const row = buffer.getLine(r);
      if (!row || (r > first && !row.isWrapped)) break;
      rows.push(row);
      last = r;
    }
    if (rows.length === 0) return first + 1;
    const { text, at } = lineText(rows, first);
    const matches = ruleMatches(text, rules);
    for (const match of matches) {
      // One decoration per row the match covers.
      let i = match.start;
      while (i < match.end) {
        const startAt = at[i];
        let j = i;
        while (j + 1 < match.end && at[j + 1].row === startAt.row) j++;
        const endAt = at[j];
        const marker = term.registerMarker(startAt.row - cursor);
        if (marker) {
          const decoration = term.registerDecoration({
            marker,
            x: startAt.col,
            width: endAt.col + endAt.width - startAt.col,
            foregroundColor: match.color,
            layer: "top",
          });
          if (decoration) coloured.push({ marker, decoration });
          else marker.dispose();
        }
        i = j + 1;
      }
      if (fresh && rules[match.rule]?.notify && options.onNotify) {
        const previous = lastNotified.get(match.rule) ?? -Infinity;
        if (now() - previous >= NOTIFY_EVERY_MS) {
          lastNotified.set(match.rule, now());
          options.onNotify(match.rule, text.trimEnd());
        }
      }
    }
    return last + 1;
  };

  /** `again`: every row is read again (rules changed), but only rows never read before may notify. */
  const scan = (again = false) => {
    const buffer = term.buffer.active;
    const rules = options.rules();
    if (buffer.type !== "normal" || rules.every((r) => !r.regex)) return;
    const cursor = buffer.baseY + buffer.cursorY;
    // Only finished lines: the one the cursor is on may still grow.
    let end = cursor;
    while (end > 0 && buffer.getLine(end)?.isWrapped) end--;
    const firstUnread = unread && !unread.isDisposed ? unread.line : 0;
    // The screen can be rewritten: its colours are read again.
    const from = again ? 0 : Math.min(buffer.baseY, firstUnread);
    coloured = coloured.filter((c) => {
      if (c.marker.isDisposed) return false;
      if (c.marker.line >= from) {
        drop(c);
        return false;
      }
      return true;
    });
    let row = from;
    // A line that starts above `from` and wraps onto it is read whole.
    while (row > 0 && buffer.getLine(row)?.isWrapped) row--;
    while (row < end) row = colourLine(row, end, cursor, row >= firstUnread, rules);
    while (coloured.length > maxColoured) drop(coloured.shift()!);
    unread?.dispose();
    unread = term.registerMarker(end - cursor) ?? null;
  };

  const safeScan = (again = false) => {
    try {
      scan(again);
    } catch {
      // Colouring is cosmetic: it never gets in the way of the output.
    }
  };
  const schedule =
    options.schedule ??
    ((run: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 16)));
  let pending = false;
  let disposed = false;
  const subscription = term.onWriteParsed(() => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (!disposed) safeScan();
    });
  });

  const clear = () => {
    coloured.forEach(drop);
    coloured = [];
  };

  return {
    refresh() {
      clear();
      // Already-read rows are coloured again but do not notify again.
      safeScan(true);
    },
    dispose() {
      disposed = true;
      subscription.dispose();
      clear();
      unread?.dispose();
    },
  };
}
