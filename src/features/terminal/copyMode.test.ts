import { describe, expect, it } from "vitest";
import { copyModeKey, scrollFor, selectionRange, startCopyMode, type CopyBuffer, type CopyState } from "./copyMode";

/** A buffer of `lines`, `cols` wide, showing `rows` rows from `viewportY`. */
const buffer = (lines: string[], cols = 20, rows = 3, viewportY = 0): CopyBuffer => ({
  length: lines.length,
  cols,
  rows,
  viewportY,
  lineText: (y) => lines[y] ?? "",
});
const key = (k: string, mods: { shiftKey?: boolean; ctrlKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});
const at = (x: number, y: number, anchor: CopyState["anchor"] = null): CopyState => ({ x, y, anchor });
const press = (state: CopyState, keys: string[], buf: CopyBuffer) =>
  keys.reduce((s, k) => copyModeKey(s, key(k), buf).state, state);

describe("copy mode", () => {
  const buf = buffer(["first line", "second word here", "", "last one"], 20, 2);

  it("starts at the terminal cursor, kept inside the line width", () => {
    expect(startCopyMode({ cursorX: 4, cursorY: 1, baseY: 2 }, 20)).toEqual(at(4, 3));
    expect(startCopyMode({ cursorX: 20, cursorY: 0, baseY: 0 }, 20)).toEqual(at(19, 0));
  });

  it("moves with the arrows and h/j/k/l, never out of the buffer", () => {
    expect(press(at(0, 0), ["l", "l", "ArrowRight"], buf)).toEqual(at(3, 0));
    expect(press(at(3, 0), ["h", "ArrowLeft"], buf)).toEqual(at(1, 0));
    expect(press(at(1, 0), ["j", "ArrowDown", "j", "j", "j"], buf)).toEqual(at(1, 3));
    expect(press(at(1, 3), ["k", "ArrowUp", "k", "k", "k"], buf)).toEqual(at(1, 0));
    expect(press(at(0, 0), ["h"], buf)).toEqual(at(0, 0));
    expect(press(at(19, 0), ["l"], buf)).toEqual(at(19, 0));
  });

  it("jumps by words with w and b, across lines", () => {
    // "second word here": w from the start of "second" lands on "word", then "here".
    expect(press(at(0, 1), ["w"], buf)).toEqual(at(7, 1));
    expect(press(at(7, 1), ["w"], buf)).toEqual(at(12, 1));
    // From the last word, w goes to the next line's first word (the empty line is skipped).
    expect(press(at(12, 1), ["w"], buf)).toEqual(at(0, 3));
    expect(press(at(12, 1), ["b"], buf)).toEqual(at(7, 1));
    expect(press(at(9, 1), ["b"], buf)).toEqual(at(7, 1));
    expect(press(at(0, 1), ["b"], buf)).toEqual(at(6, 0));
  });

  it("goes to the line's start with 0 and its last character with $", () => {
    expect(press(at(5, 1), ["0"], buf)).toEqual(at(0, 1));
    expect(press(at(0, 1), ["$"], buf)).toEqual(at(15, 1));
    expect(copyModeKey(at(0, 1), key("$", { shiftKey: true }), buf).state).toEqual(at(15, 1));
    expect(press(at(3, 2), ["$"], buf)).toEqual(at(0, 2));
  });

  it("moves a screen with PgUp/PgDn and to the top or bottom with g/G", () => {
    expect(press(at(2, 0), ["PageDown"], buf)).toEqual(at(2, 2));
    expect(press(at(2, 3), ["PageUp"], buf)).toEqual(at(2, 1));
    expect(press(at(2, 2), ["g"], buf)).toEqual(at(0, 0));
    expect(copyModeKey(at(2, 0), key("G", { shiftKey: true }), buf).state).toEqual(at(0, 3));
  });

  it("starts a selection with v and drops it with a second v", () => {
    const started = press(at(2, 1), ["v"], buf);
    expect(started).toEqual(at(2, 1, { x: 2, y: 1 }));
    expect(press(started, ["l", "l"], buf)).toEqual(at(4, 1, { x: 2, y: 1 }));
    expect(press(started, ["v"], buf)).toEqual(at(2, 1));
  });

  it("copies with y or Enter, and leaves with Esc or q", () => {
    expect(copyModeKey(at(0, 0), key("y"), buf).action).toBe("copy");
    expect(copyModeKey(at(0, 0), key("Enter"), buf).action).toBe("copy");
    expect(copyModeKey(at(0, 0), key("Escape"), buf).action).toBe("exit");
    expect(copyModeKey(at(0, 0), key("q"), buf).action).toBe("exit");
    expect(copyModeKey(at(0, 0), key("j"), buf).action).toBe("stay");
    // Anything else is kept from the shell and changes nothing.
    expect(copyModeKey(at(1, 1), key("x"), buf)).toEqual({
      state: at(1, 1),
      action: "stay",
    });
    expect(copyModeKey(at(1, 1), key("c", { ctrlKey: true }), buf)).toEqual({
      state: at(1, 1),
      action: "stay",
    });
  });

  it("selects from the anchor to the cursor, both included, in either order", () => {
    expect(selectionRange(at(4, 1, { x: 2, y: 1 }), 20)).toEqual({
      column: 2,
      row: 1,
      length: 3,
    });
    expect(selectionRange(at(2, 1, { x: 4, y: 1 }), 20)).toEqual({
      column: 2,
      row: 1,
      length: 3,
    });
    // Over lines: to the end of the first, then the next one up to the cursor.
    expect(selectionRange(at(1, 2, { x: 18, y: 1 }), 20)).toEqual({
      column: 18,
      row: 1,
      length: 4,
    });
    expect(selectionRange(at(1, 2), 20)).toBeNull();
  });

  it("scrolls the viewport only when the cursor leaves it", () => {
    expect(scrollFor(5, 4, 3)).toBeNull();
    expect(scrollFor(7, 4, 3)).toBe(5);
    expect(scrollFor(2, 4, 3)).toBe(2);
  });
});
