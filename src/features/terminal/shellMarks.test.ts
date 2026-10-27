import { describe, expect, it } from "vitest";
import { commandLineAt, isDrawnGrey, parseOsc133, typedLineAt, type ScreenRows } from "./shellMarks";

type Row = string | { text: string; wrapped?: true; drawn?: string };

/**
 * Rows of a `cols`-column screen; `wrapped` rows continue the row above, and `drawn` marks with `~`
 * the columns the shell drew in grey (an autosuggestion).
 */
const screenOf = (cols: number, ...rows: Row[]): ScreenRows => ({
  cols,
  row: (y) => {
    const r = rows[y];
    if (r === undefined) return null;
    const text = typeof r === "string" ? r : r.text;
    const drawn = typeof r === "string" ? "" : (r.drawn ?? "");
    return {
      wrapped: typeof r !== "string" && r.wrapped === true,
      text: (start = 0, end?: number, trimRight = false) => {
        const cells = text.padEnd(cols).slice(start, end);
        return trimRight ? cells.trimEnd() : cells;
      },
      drawn: (col) => drawn[col] === "~",
    };
  },
});
const screen = (...rows: Row[]) => screenOf(10, ...rows);

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

describe("commandLineAt, with what the shell draws after the cursor", () => {
  it("leaves out an autosuggestion drawn in grey after the cursor", () => {
    // fish: "git st" typed, "atus --short" suggested from history.
    const rows = screenOf(30, { text: "> git status --short", drawn: "        ~~~~~~~~~~~~" });
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 0, col: 8 })).toEqual({ text: "git st", beforeCursor: "git st" });
  });

  it("leaves out a right prompt drawn against the right edge", () => {
    // zsh leaves one column free after RPROMPT (ZLE_RPROMPT_INDENT=1); fish's reaches the edge.
    for (const right of ["~/src main ", "~/src main"]) {
      const row = "$ ls" + right.padStart(16);
      expect(commandLineAt(screenOf(20, row), { row: 0, col: 2 }, { row: 0, col: 4 })?.text).toBe("ls");
    }
  });

  it("keeps typed text after the cursor, spaces included, when it does not reach the right edge", () => {
    const rows = screenOf(20, "$ echo a  b");
    expect(commandLineAt(rows, { row: 0, col: 2 }, { row: 0, col: 2 })).toEqual({ text: "echo a  b", beforeCursor: "" });
    const suggested = screenOf(30, { text: "$ git commit --amend", drawn: "             ~~~~~~~" });
    expect(commandLineAt(suggested, { row: 0, col: 2 }, { row: 0, col: 5 })?.text).toBe("git commit");
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

describe("isDrawnGrey", () => {
  const cell = (fg: number, mode: "default" | "palette" | "rgb", dim = false) => ({
    isDim: () => (dim ? 1 : 0),
    isFgPalette: () => mode === "palette",
    isFgRGB: () => mode === "rgb",
    getFgColor: () => fg,
  });

  it("is true for how shells draw autosuggestions: dim, colour 8, the grey ramp or a mid grey", () => {
    expect(isDrawnGrey(cell(-1, "default", true))).toBe(true);
    expect(isDrawnGrey(cell(8, "palette"))).toBe(true);
    expect(isDrawnGrey(cell(244, "palette"))).toBe(true);
    expect(isDrawnGrey(cell(0x555555, "rgb"))).toBe(true);
  });

  it("is false for typed text, plain or highlighted", () => {
    expect(isDrawnGrey(cell(-1, "default"))).toBe(false);
    expect(isDrawnGrey(cell(2, "palette"))).toBe(false);
    expect(isDrawnGrey(cell(15, "palette"))).toBe(false);
    expect(isDrawnGrey(cell(0xffffff, "rgb"))).toBe(false);
    expect(isDrawnGrey(cell(0x5f87af, "rgb"))).toBe(false);
  });
});
