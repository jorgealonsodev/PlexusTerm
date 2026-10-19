import { describe, expect, it } from "vitest";
import { changedLines } from "./changedLines";

const text = (...lines: string[]) => lines.join("\n");

describe("changedLines (the viewer's gutter against the last commit)", () => {
  it("finds nothing when the file is as committed", () => {
    expect(changedLines(text("a", "b"), text("a", "b"))).toEqual([]);
  });

  it("marks added lines", () => {
    expect(changedLines(text("a", "b"), text("a", "x", "y", "b"))).toEqual([
      { line: 2, kind: "added" },
      { line: 3, kind: "added" },
    ]);
  });

  it("marks changed lines as modified, each one on its own", () => {
    expect(changedLines(text("a", "b", "c", "d"), text("a", "B", "c", "x", "d"))).toEqual([
      { line: 2, kind: "modified" },
      { line: 4, kind: "added" },
    ]);
  });

  it("marks where lines were deleted on the line after them, or the last line at the end", () => {
    expect(changedLines(text("a", "b", "c"), text("a", "c"))).toEqual([{ line: 2, kind: "deleted" }]);
    expect(changedLines(text("a", "b", "c"), text("a", "b"))).toEqual([{ line: 2, kind: "deletedBelow" }]);
    expect(changedLines(text("a", "b"), text("b"))).toEqual([{ line: 1, kind: "deleted" }]);
  });

  it("marks a replaced block as modified, the lines beyond the old ones as added", () => {
    expect(changedLines(text("a", "b", "z"), text("a", "x", "y", "w", "z"))).toEqual([
      { line: 2, kind: "modified" },
      { line: 3, kind: "added" },
      { line: 4, kind: "added" },
    ]);
  });

  it("reads Windows line breaks as the same lines", () => {
    expect(changedLines("a\r\nb\r\n", "a\nb\n")).toEqual([]);
  });

  it("marks every line of a new or emptied file", () => {
    expect(changedLines("", text("a", "b"))).toEqual([
      { line: 1, kind: "added" },
      { line: 2, kind: "added" },
    ]);
    expect(changedLines(text("a", "b"), "")).toEqual([{ line: 1, kind: "deleted" }]);
  });

  it("still answers for large files with many changes", () => {
    const before = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const after = before.map((line, i) => (i % 3 === 0 ? `${line} changed` : line));
    const marks = changedLines(before.join("\n"), after.join("\n"));
    expect(marks[0]).toEqual({ line: 1, kind: "modified" });
    expect(marks.every((mark) => mark.kind === "modified")).toBe(true);
  });
});
