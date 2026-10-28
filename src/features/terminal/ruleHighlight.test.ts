import { describe, expect, it } from "vitest";
import { compileRules, type HighlightRule } from "./highlightRules";
import { attachRuleHighlight, NOTIFY_EVERY_MS, type RuleTerminal } from "./ruleHighlight";

/** CJK characters take two cells, as xterm stores them: the character, then an empty cell of width 0. */
const WIDE = /[　-鿿]/;

interface FakeMarker {
  line: number;
  isDisposed: boolean;
  dispose(): void;
}

class FakeTerminal implements RuleTerminal {
  cols = 20;
  type: "normal" | "alternate" = "normal";
  rows: { text: string; wrapped: boolean }[] = [];
  baseY = 0;
  /** The cursor's row; the row after the last one unless set. */
  cursor: number | null = null;
  markers: FakeMarker[] = [];
  decorations: { line: number; x: number; width: number; color: string; disposed: boolean }[] = [];
  private listener: () => void = () => {};

  get buffer() {
    const cursorRow = this.cursor ?? this.rows.length;
    return {
      active: {
        type: this.type,
        baseY: this.baseY,
        cursorY: cursorRow - this.baseY,
        getLine: (y: number) => {
          const row = this.rows[y];
          if (!row) return undefined;
          const cells: { chars: string; width: number }[] = [];
          for (const ch of row.text) {
            if (WIDE.test(ch)) cells.push({ chars: ch, width: 2 }, { chars: "", width: 0 });
            else cells.push({ chars: ch, width: 1 });
          }
          return {
            isWrapped: row.wrapped,
            length: cells.length,
            getCell: (x: number) => {
              const c = cells[x];
              return c ? { getChars: () => c.chars, getWidth: () => c.width } : undefined;
            },
          };
        },
      },
    };
  }
  registerMarker(offset = 0) {
    const marker: FakeMarker = { line: (this.cursor ?? this.rows.length) + offset, isDisposed: false, dispose: () => void (marker.isDisposed = true) };
    this.markers.push(marker);
    return marker;
  }
  registerDecoration(o: { marker: FakeMarker; x?: number; width?: number; foregroundColor?: string }) {
    const d = { line: o.marker.line, x: o.x ?? 0, width: o.width ?? 1, color: o.foregroundColor ?? "", disposed: false };
    this.decorations.push(d);
    return { dispose: () => void (d.disposed = true) };
  }
  onWriteParsed(listener: () => void) {
    this.listener = listener;
    return { dispose: () => void (this.listener = () => {}) };
  }
  /** Adds finished rows and lets the highlighter read them. */
  print(...lines: (string | [string, true])[]) {
    for (const line of lines) this.rows.push(typeof line === "string" ? { text: line, wrapped: false } : { text: line[0], wrapped: true });
    this.listener();
  }
  live() {
    return this.decorations.filter((d) => !d.disposed).map(({ line, x, width, color }) => ({ line, x, width, color }));
  }
}

const rule = (pattern: string, extra: Partial<HighlightRule> = {}): HighlightRule => ({
  pattern,
  color: "#ff0000",
  matchCase: false,
  notify: false,
  ...extra,
});

const setup = (rules: HighlightRule[], now = () => 0) => {
  const term = new FakeTerminal();
  const notified: { rule: number; line: string }[] = [];
  let compiled = compileRules(rules);
  const highlight = attachRuleHighlight(term, {
    rules: () => compiled,
    onNotify: (r, line) => notified.push({ rule: r, line }),
    schedule: (run) => run(),
    now,
  });
  return { term, highlight, notified, setRules: (next: HighlightRule[]) => (compiled = compileRules(next)) };
};

describe("attachRuleHighlight", () => {
  it("colours only the matched text, in each rule's colour", () => {
    const { term } = setup([rule("error"), rule("\\d+\\.\\d+\\.\\d+\\.\\d+", { color: "#00ff00" })]);
    term.print("ok", "ERROR at 10.0.0.1");
    expect(term.live()).toEqual([
      { line: 1, x: 0, width: 5, color: "#ff0000" },
      { line: 1, x: 9, width: 8, color: "#00ff00" },
    ]);
  });

  it("places matches after wide characters in the right cells", () => {
    const { term } = setup([rule("ERROR")]);
    term.print("日本 ERROR");
    expect(term.live()).toEqual([{ line: 0, x: 5, width: 5, color: "#ff0000" }]);
  });

  it("colours a match that wraps onto the next row on both rows", () => {
    const { term } = setup([rule("connection refused")]);
    term.cols = 15;
    term.print("x: connection r", ["efused", true]);
    expect(term.live()).toEqual([
      { line: 0, x: 3, width: 12, color: "#ff0000" },
      { line: 1, x: 0, width: 6, color: "#ff0000" },
    ]);
  });

  it("reads rows on the screen again when they are rewritten, and leaves the cursor's line alone", () => {
    const { term } = setup([rule("FAIL")]);
    term.print("FAIL one");
    expect(term.live()).toHaveLength(1);
    term.rows[0].text = "pass one";
    term.print("still typing FAIL");
    expect(term.live()).toEqual([{ line: 1, x: 13, width: 4, color: "#ff0000" }]);
    // The line the cursor is on may still grow: not read yet.
    term.cursor = 1;
    term.rows[1].text = "FAIL";
    term.print();
    expect(term.live()).toEqual([]);
  });

  it("notifies for new output that matches a notifying rule, at most once every 10 s per rule", () => {
    let now = 0;
    const { term, notified, highlight } = setup([rule("deploy done", { notify: true }), rule("warn")], () => now);
    term.print("warn: x", "deploy done in 3 s");
    term.print("deploy done again");
    now += NOTIFY_EVERY_MS;
    term.print("deploy done for the last time");
    expect(notified).toEqual([
      { rule: 0, line: "deploy done in 3 s" },
      { rule: 0, line: "deploy done for the last time" },
    ]);
    // Rows already read are coloured again, never notified again.
    now += NOTIFY_EVERY_MS;
    highlight.refresh();
    expect(notified).toHaveLength(2);
  });

  it("colours with the new rules after a refresh, and does nothing in the alternate screen", () => {
    const { term, highlight, setRules } = setup([rule("old")]);
    term.print("old new");
    setRules([rule("new", { color: "#0000ff" })]);
    highlight.refresh();
    expect(term.live()).toEqual([{ line: 0, x: 4, width: 3, color: "#0000ff" }]);
    term.type = "alternate";
    term.print("new in vim");
    expect(term.live()).toHaveLength(1);
  });

  it("does nothing without rules, and disposes every colour with the terminal", () => {
    const none = setup([]);
    none.term.print("ERROR");
    expect(none.term.live()).toEqual([]);
    const { term, highlight } = setup([rule("x")]);
    term.print("x x x");
    expect(term.live()).toHaveLength(3);
    highlight.dispose();
    expect(term.live()).toEqual([]);
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
  });
});
