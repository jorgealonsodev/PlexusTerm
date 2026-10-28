import { describe, expect, it } from "vitest";
import { FIND_ALL_LIMIT, findInPanes, locate, rowText, searchablePanes, type BufferRow, type FindTarget, type SearchablePane } from "./findAll";
import type { Tab } from "../tabs/tabs";

/** Rows of a buffer from plain lines; a line given as an array is one logical line wrapped over those rows. */
const rows = (...lines: (string | string[])[]): BufferRow[] =>
  lines.flatMap((line) =>
    typeof line === "string"
      ? [{ text: line, wrapped: false }]
      : line.map((text, i) => ({ text, wrapped: i > 0 })),
  );

const pane = (tabKey: string, paneId: string, buffer: BufferRow[], tabTitle = tabKey): SearchablePane => ({
  tabKey,
  paneId,
  tabTitle,
  paneTitle: paneId,
  rows: () => buffer,
});

describe("findInPanes (S3)", () => {
  it("finds the text in every pane, scrollback included, with where each match is", () => {
    const panes = [
      pane("t1", "p1", rows("old error in scrollback", "ok", "another error here   ")),
      pane("t2", "p2", rows("nothing", "error")),
    ];
    const { results, capped } = findInPanes(panes, "error", { matchCase: false });
    expect(capped).toBe(false);
    expect(results).toEqual([
      { tabKey: "t1", paneId: "p1", tabTitle: "t1", paneTitle: "p1", line: "old error in scrollback", lineOrdinal: 0, index: 4, row: 0, column: 4, length: 5 },
      { tabKey: "t1", paneId: "p1", tabTitle: "t1", paneTitle: "p1", line: "another error here", lineOrdinal: 2, index: 8, row: 2, column: 8, length: 5 },
      { tabKey: "t2", paneId: "p2", tabTitle: "t2", paneTitle: "p2", line: "error", lineOrdinal: 1, index: 0, row: 1, column: 0, length: 5 },
    ]);
  });

  it("joins wrapped rows into one line and places a match on the row it starts in", () => {
    const panes = [pane("t", "p", rows("first", ["abcde", "fghij", "kl  "]))];
    const [split, later] = [
      findInPanes(panes, "efg", { matchCase: false }).results,
      findInPanes(panes, "jk", { matchCase: false }).results,
    ];
    expect(split).toEqual([expect.objectContaining({ line: "abcdefghijkl", index: 4, row: 1, column: 4, length: 3 })]);
    expect(later).toEqual([expect.objectContaining({ line: "abcdefghijkl", index: 9, row: 2, column: 4, length: 2 })]);
  });

  it("ignores the case unless Match case is on", () => {
    const panes = [pane("t", "p", rows("Error", "error", "ERROR"))];
    expect(findInPanes(panes, "error", { matchCase: false }).results.map((r) => r.row)).toEqual([0, 1, 2]);
    expect(findInPanes(panes, "error", { matchCase: true }).results.map((r) => r.row)).toEqual([1]);
  });

  it("takes the query as plain text, every match of a line counting", () => {
    const panes = [pane("t", "p", rows("a.b a.b axb", "(x)"))];
    expect(findInPanes(panes, "a.b", { matchCase: false }).results.map((r) => r.column)).toEqual([0, 4]);
    expect(findInPanes(panes, "(x)", { matchCase: false }).results).toHaveLength(1);
  });

  it(`stops at ${FIND_ALL_LIMIT} results and says so`, () => {
    const many = rows(...Array.from({ length: FIND_ALL_LIMIT + 20 }, (_, i) => `hit ${i}`));
    const { results, capped } = findInPanes([pane("t", "p", many)], "hit", { matchCase: false });
    expect(results).toHaveLength(FIND_ALL_LIMIT);
    expect(capped).toBe(true);
    const exact = findInPanes([pane("t", "p", many.slice(0, FIND_ALL_LIMIT))], "hit", { matchCase: false });
    expect(exact).toMatchObject({ capped: false });
    expect(exact.results).toHaveLength(FIND_ALL_LIMIT);
  });

  it("finds nothing for an empty query", () => {
    expect(findInPanes([pane("t", "p", rows("anything"))], "", { matchCase: false })).toEqual({ results: [], capped: false });
  });
});

describe("searchablePanes (S3)", () => {
  const target = (text: string): FindTarget => ({ rows: () => [{ text, wrapped: false }], reveal: () => {} });
  const split = (a: string, b: string, c: string) => ({
    kind: "split" as const,
    id: "s1",
    direction: "row" as const,
    ratio: 0.5,
    a: { kind: "split" as const, id: "s2", direction: "column" as const, ratio: 0.5, a: { kind: "pane" as const, id: a }, b: { kind: "pane" as const, id: b } },
    b: { kind: "pane" as const, id: c },
  });

  it("takes the terminal panes of every tab, in order, and leaves out viewers, AI chats and shared viewers", () => {
    const tabs: Tab[] = [
      {
        key: "t1",
        title: "web",
        target: { type: "local" },
        layout: split("p1", "chat", "viewer"),
        focusedPane: "p1",
        chats: { chat: { terminalPaneId: "p1", selection: "" } },
        viewers: { viewer: { terminalPaneId: "p1", path: "/a.txt", origin: { kind: "local" }, opened: 1 } },
      },
      {
        key: "t2",
        title: "shared",
        target: { type: "shared", url: "https://example.com/s/1" } as unknown as Tab["target"],
        layout: { kind: "pane", id: "p2" },
        focusedPane: "p2",
        chats: {},
      },
      { key: "t3", title: "db", target: { type: "local" }, layout: { kind: "pane", id: "p3" }, focusedPane: "p3", chats: {} },
    ];
    // Even a target registered for a non-terminal pane is not searched.
    const targets: Record<string, FindTarget> = { p1: target("one"), chat: target("x"), viewer: target("x"), p2: target("x"), p3: target("three") };
    const panes = searchablePanes(tabs, (id) => targets[id], (id) => `title of ${id}`);
    expect(panes.map(({ tabKey, paneId, tabTitle, paneTitle }) => ({ tabKey, paneId, tabTitle, paneTitle }))).toEqual([
      { tabKey: "t1", paneId: "p1", tabTitle: "web", paneTitle: "title of p1" },
      { tabKey: "t3", paneId: "p3", tabTitle: "db", paneTitle: "title of p3" },
    ]);
    expect(panes[1].rows()).toEqual([{ text: "three", wrapped: false }]);
  });
});

describe("locate (S3)", () => {
  it("finds a result again after its terminal rewrapped, by its line and its place in it", () => {
    const before = rows("first", ["abcde", "fghij", "kl  "]);
    const [result] = findInPanes([pane("t", "p", before)], "jk", { matchCase: false }).results;
    // Shown again wider: the line now fits in two rows.
    const after = rows("first", ["abcdefgh", "ijkl"]);
    expect(locate(after, result)).toEqual({ row: 2, column: 1 });
  });

  it("follows the line when scrollback above it went away, and gives up when the line is gone", () => {
    const [result] = findInPanes([pane("t", "p", rows("a", "b", "the error"))], "error", { matchCase: false }).results;
    expect(locate(rows("b", "the error"), result)).toEqual({ row: 1, column: 4 });
    expect(locate(rows("nothing here"), result)).toBeNull();
  });
});

describe("rowText (S3)", () => {
  const cell = (chars: string, width: number) => ({ getChars: () => chars, getWidth: () => width });
  const line = (text: string, cells: ReturnType<typeof cell>[], isWrapped = false) => ({
    length: cells.length,
    isWrapped,
    translateToString: () => text,
    getCell: (x: number) => cells[x],
  });

  it("drops the empty cell a wide character left when it did not fit at the end of the row", () => {
    const row = line("ab ", [cell("a", 1), cell("b", 1), cell("", 1)]);
    const next = line("漢c", [cell("漢", 2), cell("", 0), cell("c", 1)], true);
    expect(rowText(row, next)).toBe("ab");
  });

  it("keeps a printed space, and an empty end before a row that does not continue it", () => {
    const spaced = line("ab ", [cell("a", 1), cell("b", 1), cell(" ", 1)]);
    const next = line("漢c", [cell("漢", 2), cell("", 0), cell("c", 1)], true);
    expect(rowText(spaced, next)).toBe("ab ");
    const empty = line("ab ", [cell("a", 1), cell("b", 1), cell("", 1)]);
    expect(rowText(empty, line("漢c", [cell("漢", 2), cell("", 0), cell("c", 1)], false))).toBe("ab ");
    expect(rowText(empty, undefined)).toBe("ab ");
  });
});

