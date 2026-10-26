import { describe, expect, it } from "vitest";
import { commandLineAt, parseOsc133, typedLineAt, type ScreenRows } from "./shellMarks";

/** Rows of a 10-column screen; `wrapped` rows continue the row above. */
const screen = (...rows: (string | { text: string; wrapped: true })[]): ScreenRows => ({
  row: (y) => {
    const r = rows[y];
    if (r === undefined) return null;
    const text = typeof r === "string" ? r : r.text;
    return {
      wrapped: typeof r !== "string",
      text: (start = 0, end?: number, trimRight = false) => {
        const cells = text.padEnd(10).slice(start, end);
        return trimRight ? cells.trimEnd() : cells;
      },
    };
  },
});

describe("parseOsc133", () => {
  it("reads the prompt, command line, run and finish marks, with the exit code", () => {
    expect(parseOsc133("A")).toEqual({ kind: "A" });
    expect(parseOsc133("A;cl=m;aid=12")).toEqual({ kind: "A" });
    expect(parseOsc133("B")).toEqual({ kind: "B" });
    expect(parseOsc133("C")).toEqual({ kind: "C" });
    expect(parseOsc133("D;0")).toEqual({ kind: "D", exit: 0 });
    expect(parseOsc133("D;127;aid=12")).toEqual({ kind: "D", exit: 127 });
    expect(parseOsc133("D")).toEqual({ kind: "D", exit: null });
  });

  it("ignores marks it does not use and malformed exit codes", () => {
    expect(parseOsc133("P;k=i")).toBeNull();
    expect(parseOsc133("")).toBeNull();
    expect(parseOsc133("Bx")).toBeNull();
    expect(parseOsc133("D;oops")).toEqual({ kind: "D", exit: null });
  });
});

describe("commandLineAt", () => {
  it("is the text from the B mark, split at the cursor", () => {
    // "$ " prompt, then "git sta" with the cursor after "git".
    const rows = screen("$ git sta");
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 0, col: 5 })).toEqual({ text: "git sta", beforeCursor: "git" });
  });

  it("follows a command wrapped over several rows, and leaves out the rows below it", () => {
    const rows = screen("$ echo abc", { text: "defghijklm", wrapped: true }, { text: "nop", wrapped: true }, "output");
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 2, col: 3 })).toEqual({
      text: "echo abcdefghijklmnop",
      beforeCursor: "echo abcdefghijklmnop",
    });
  });

  it("joins the lines of a multi-line command with line breaks", () => {
    const rows = screen("$ for x in", "> do echo", "> done");
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 2, col: 6 })?.text).toBe("for x in\n> do echo\n> done");
  });

  it("is empty at a fresh prompt, and unknown when the cursor is before the mark", () => {
    const rows = screen("$ ");
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 0, col: 2 })).toEqual({ text: "", beforeCursor: "" });
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 0, col: 1 })).toBeNull();
    expect(commandLineAt(screen("$ ls", "out"), { row: 1, col: 0 }, { row: 0, col: 4 })).toBeNull();
  });
});

describe("typedLineAt", () => {
  it("is the command line while it fits one row or wraps", () => {
    const rows = screen("$ echo abc", { text: "def", wrapped: true });
    expect(typedLineAt(rows, { row: 0, col: 2 }, { row: 1, col: 3 })?.text).toBe("echo abcdef");
  });

  it("is unknown for a multi-line command or output below the mark (no C mark from an old bash)", () => {
    // A continuation prompt: each Enter would save a longer, prompt-polluted entry.
    expect(typedLineAt(screen("$ for x in", "> do"), { row: 0, col: 2 }, { row: 1, col: 4 })).toBeNull();
    // A program's output after the mark, its own prompt on the cursor's row.
    expect(typedLineAt(screen("$ python3", "Python 3.12", ">>> 1+1"), { row: 0, col: 2 }, { row: 2, col: 7 })).toBeNull();
  });
});
