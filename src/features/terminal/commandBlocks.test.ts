// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { attachCommandBlocks, JUMP_FLASH_MS, jumpColor, type BlockTerminal } from "./commandBlocks";
import { parseOsc133 } from "./shellMarks";

interface FakeMarker {
  line: number;
  isDisposed: boolean;
  dispose(): void;
}

/** A normal buffer of rows (`[text, wrapped]`) with a cursor, a scrollback of `baseY` rows and a screen. */
class FakeTerminal implements BlockTerminal {
  cols = 40;
  type: "normal" | "alternate" = "normal";
  rows: [string, boolean][] = [];
  cursor = { x: 0, y: 0 };
  baseY = 0;
  viewportY = 0;
  markers: FakeMarker[] = [];
  decorations: { line: number; disposed: boolean; element: HTMLElement; background?: string }[] = [];

  get buffer() {
    return {
      active: {
        type: this.type,
        baseY: this.baseY,
        viewportY: this.viewportY,
        cursorX: this.cursor.x,
        cursorY: this.cursor.y - this.baseY,
        getLine: (y: number) => {
          const row = this.rows[y];
          if (!row) return undefined;
          return {
            isWrapped: row[1],
            translateToString: (trim = false, start = 0, end?: number) => {
              const text = row[0].slice(start, end);
              return trim ? text.trimEnd() : text;
            },
          };
        },
      },
    };
  }
  registerMarker(offset = 0) {
    const marker: FakeMarker = { line: this.cursor.y + offset, isDisposed: false, dispose: () => void (marker.isDisposed = true) };
    this.markers.push(marker);
    return marker;
  }
  registerDecoration({ marker, backgroundColor }: { marker: FakeMarker; backgroundColor?: string }) {
    const decoration = { line: marker.line, disposed: false, element: document.createElement("div"), background: backgroundColor };
    this.decorations.push(decoration);
    return {
      onRender: (listener: (element: HTMLElement) => void) => {
        listener(decoration.element);
        return { dispose() {} };
      },
      dispose: () => void (decoration.disposed = true),
    };
  }
  scrollToLine(line: number) {
    this.viewportY = Math.max(0, Math.min(line, this.baseY));
  }
  scrollToBottom() {
    this.viewportY = this.baseY;
  }

  /** Writes rows starting at the cursor's row; the cursor ends after the last one's text. */
  print(...rows: (string | [string, boolean])[]) {
    rows.forEach((row, i) => {
      this.rows[this.cursor.y + i] = typeof row === "string" ? [row, false] : row;
    });
    this.cursor = { y: this.cursor.y + rows.length - 1, x: this.rows[this.cursor.y + rows.length - 1][0].length };
  }
  newline() {
    this.cursor = { y: this.cursor.y + 1, x: 0 };
    this.rows[this.cursor.y] ??= ["", false];
  }
  mark(payload: string) {
    blocksOf.get(this)!.mark(parseOsc133(payload)!);
  }
  /** A whole command: prompt, typed line, output rows and its exit code. */
  run(command: string, output: string[], exit: number) {
    this.mark("A");
    this.print(`$ ${command}`);
    this.mark("B");
    this.newline();
    this.mark("C");
    if (output.length > 0) {
      this.print(...output);
      this.newline();
    }
    clock.now += 1000;
    this.mark(`D;${exit}`);
  }
}

const blocksOf = new Map<FakeTerminal, ReturnType<typeof attachCommandBlocks>>();
/** The test clock: `run` advances it by a second between a command's C and D marks. */
const clock = { now: 0 };
const setup = (maxBlocks?: number) => {
  const term = new FakeTerminal();
  term.rows[0] = ["", false];
  const blocks = attachCommandBlocks(term, {
    failedColor: () => "#ff0000",
    jumpColor: () => "#334455",
    failedTitle: (exit, ms) => `exit ${exit} after ${ms} ms`,
    now: () => clock.now,
    maxBlocks,
  });
  blocksOf.set(term, blocks);
  return { term, blocks };
};

describe("outputAt", () => {
  it("is the output of the last command, without the prompt, the command line or the next prompt", () => {
    const { term, blocks } = setup();
    term.run("ls", ["a.txt  b.txt", "c.txt"], 0);
    term.mark("A");
    term.print("$ ");
    expect(blocks.outputAt()).toBe("a.txt  b.txt\nc.txt");
  });

  it("is the output of the command whose prompt or output holds the row", () => {
    const { term, blocks } = setup();
    term.run("echo one", ["one"], 0); // rows 0-1
    term.run("echo two", ["two"], 0); // rows 2-3
    expect(blocks.outputAt(0)).toBe("one");
    expect(blocks.outputAt(1)).toBe("one");
    expect(blocks.outputAt(3)).toBe("two");
  });

  it("joins wrapped rows, keeps output without a final newline and reads a command still running", () => {
    const { term, blocks } = setup();
    term.mark("A");
    term.print("$ cat long");
    term.mark("B");
    term.newline();
    term.mark("C");
    term.print("abcdef", ["ghi", true], "no newline");
    term.mark("D;0");
    term.print("no newline$ ");
    expect(blocks.outputAt()).toBe("abcdefghi\nno newline");

    term.newline();
    term.mark("A");
    term.print("$ tail -f log");
    term.mark("B");
    term.newline();
    term.mark("C");
    term.print("first line");
    expect(blocks.outputAt()).toBe("first line");
  });

  it("is empty for a command that printed nothing, and null without marks or before any command ran", () => {
    const { term, blocks } = setup();
    expect(blocks.outputAt()).toBeNull();
    term.mark("A");
    term.print("$ ");
    expect(blocks.outputAt()).toBeNull();
    term.print("$ true");
    term.mark("B");
    term.newline();
    term.mark("C");
    term.mark("D;0");
    expect(blocks.outputAt()).toBe("");
  });

  it("ignores marks printed in the alternate screen", () => {
    const { term, blocks } = setup();
    term.type = "alternate";
    term.run("vim", ["~"], 0);
    term.type = "normal";
    expect(blocks.outputAt()).toBeNull();
  });
});

describe("failed commands", () => {
  it("get a dot beside their prompt in the failure colour; commands that succeed or never ran get none", () => {
    const { term } = setup();
    term.run("true", [], 0); // row 0
    term.run("false", [], 1); // row 1
    term.mark("A");
    term.print("$ "); // row 2: Ctrl+C at the prompt
    term.mark("D;130");
    expect(term.decorations.map((d) => d.line)).toEqual([1]);
    expect(term.decorations[0].element.classList.contains("command-failed")).toBe(true);
    const dot = term.decorations[0].element.firstElementChild as HTMLElement;
    expect(dot.style.background).toBe("rgb(255, 0, 0)");
    expect(dot.style.borderRadius).toBe("50%");
    expect(dot.style.left).toBe("-9.5px");
    expect(dot.style.width).toBe("7px");
    expect(term.decorations[0].element.style.pointerEvents).toBe("none");
    // The dot itself takes the pointer, to say how the command ended.
    expect(dot.style.pointerEvents).toBe("auto");
    expect(dot.title).toBe("exit 1 after 1000 ms");
  });

  it("are marked once when the shell sends its marks twice (fish 4 and ours)", () => {
    const { term } = setup();
    term.mark("A");
    term.mark("A");
    term.print("$ false");
    term.mark("B");
    term.mark("B");
    term.newline();
    term.mark("C");
    term.mark("C");
    term.mark("D;1");
    term.mark("D;1");
    expect(term.decorations).toHaveLength(1);
  });
});

describe("jump", () => {
  /** Ten commands of 9 rows each (prompt + 8 output rows), on a 10-row screen. */
  const tenCommands = () => {
    const ctx = setup();
    for (let i = 0; i < 10; i++) ctx.term.run(`cmd ${i}`, Array.from({ length: 8 }, (_, n) => `out ${i}.${n}`), 0);
    ctx.term.mark("A");
    ctx.term.print("$ ");
    ctx.term.baseY = ctx.term.cursor.y - 9;
    ctx.term.viewportY = ctx.term.baseY;
    return ctx;
  };

  it("goes back prompt by prompt from the bottom, also through prompts already on the screen", () => {
    const { term, blocks } = tenCommands();
    // The prompt rows are 0, 9, 18 ... 81; the current one is 90, the screen starts at 81.
    expect(blocks.jump("previous")).toBe(true);
    expect(term.viewportY).toBe(81);
    expect(blocks.jump("previous")).toBe(true);
    expect(term.viewportY).toBe(72);
    expect(blocks.jump("next")).toBe(true);
    expect(term.viewportY).toBe(81);
  });

  it("starts from the screen's top row after the user scrolls, and stops at the first prompt", () => {
    const { term, blocks } = tenCommands();
    term.viewportY = 20;
    blocks.jump("previous");
    expect(term.viewportY).toBe(18);
    blocks.jump("previous");
    blocks.jump("previous");
    expect(term.viewportY).toBe(0);
    expect(blocks.jump("previous")).toBe(false);
    expect(term.viewportY).toBe(0);
  });

  it("ends at the current prompt, at the bottom", () => {
    const { term, blocks } = tenCommands();
    term.viewportY = 75;
    expect(blocks.jump("next")).toBe(true);
    expect(term.viewportY).toBe(81);
    expect(blocks.jump("next")).toBe(true);
    expect(term.viewportY).toBe(term.baseY);
    expect(blocks.jump("next")).toBe(false);
  });

  it("scrolls to the bottom from below the last prompt", () => {
    const { term, blocks } = tenCommands();
    term.mark("D;0"); // the current prompt ran a command that is still printing
    term.baseY += 20;
    term.viewportY = 95;
    expect(blocks.jump("next")).toBe(true);
    expect(term.viewportY).toBe(term.baseY);
  });

  it("highlights the prompt it went to for a moment, also when it was already on the screen", () => {
    vi.useFakeTimers();
    try {
      const { term, blocks } = tenCommands();
      blocks.jump("previous");
      expect(term.viewportY).toBe(81);
      const flashes = () => term.decorations.filter((d) => d.background === "#334455");
      expect(flashes().map((d) => [d.line, d.disposed])).toEqual([[81, false]]);
      blocks.jump("previous");
      expect(flashes().map((d) => [d.line, d.disposed])).toEqual([
        [81, true],
        [72, false],
      ]);
      vi.advanceTimersByTime(JUMP_FLASH_MS);
      expect(flashes().every((d) => d.disposed)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without marks, and is not offered then nor in a full-screen program", () => {
    const { term, blocks } = setup();
    expect(blocks.canJump()).toBe(false);
    term.mark("A");
    expect(blocks.canJump()).toBe(true);
    term.type = "alternate";
    expect(blocks.canJump()).toBe(false);
    blocks.dispose();
    term.type = "normal";
    term.print("plain shell $ ");
    expect(blocks.jump("previous")).toBe(false);
    expect(blocks.jump("next")).toBe(false);
  });
});

describe("limits", () => {
  it("keeps the newest commands and forgets those whose rows left the buffer", () => {
    const { term, blocks } = setup(2);
    term.run("echo one", ["one"], 1); // rows 0-1
    term.run("echo two", ["two"], 0); // rows 2-3
    term.run("echo three", ["three"], 0); // rows 4-5
    expect(blocks.outputAt(1)).toBeNull();
    expect(term.decorations[0].disposed).toBe(true);
    expect(blocks.outputAt(3)).toBe("two");

    term.markers.filter((m) => m.line === 2).forEach((m) => m.dispose());
    expect(blocks.outputAt(3)).toBeNull();
    expect(blocks.outputAt()).toBe("three");
  });

  it("disposes every marker and dot with the pane", () => {
    const { term, blocks } = setup();
    term.run("false", ["oops"], 1);
    blocks.dispose();
    expect(term.markers.every((m) => m.isDisposed)).toBe(true);
    expect(term.decorations.every((d) => d.disposed)).toBe(true);
    expect(blocks.outputAt()).toBeNull();
  });
});

describe("jumpColor", () => {
  it("is the scheme's selection colour, blended over the background when it is translucent", () => {
    expect(jumpColor({ selectionBackground: "#2a3b4d", background: "#000000" })).toBe("#2a3b4d");
    expect(jumpColor({ selectionBackground: "#ffffff80", background: "#000000" })).toBe("#808080");
    expect(jumpColor({ selectionBackground: "#ff000080" })).toBe("#800000");
    expect(jumpColor({ selectionBackground: "rgba(1,2,3,0.5)" })).toBe("#3a3d41");
    expect(jumpColor({})).toBe("#3a3d41");
  });
});
