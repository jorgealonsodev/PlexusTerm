import { describe, expect, it } from "vitest";
import { attachErrorHighlight, errorColor, isErrorLine, type HighlightTerminal } from "./errorHighlight";

describe("isErrorLine", () => {
  it.each([
    "error: could not compile `app` (bin \"app\") due to 2 previous errors",
    "error[E0308]: mismatched types",
    "main.c:3:5: error: expected ';' before 'return'",
    "fatal: not a git repository (or any of the parent directories): .git",
    "Error: Cannot find module 'express'",
    "npm ERR! code ENOENT",
    "E: Unable to locate package nginxx",
    "bash: foo: command not found",
    "zsh: command not found: foo",
    "ls: cannot access '/nope': No such file or directory",
    "mkdir: cannot create directory '/root/x': Permission denied",
    "Traceback (most recent call last):",
    "ValueError: invalid literal for int() with base 10: 'x'",
    "Exception in thread \"main\" java.lang.NullPointerException",
    "Segmentation fault (core dumped)",
    "Job for nginx.service failed because the control process exited with error code.",
    "[ERROR] Failed to execute goal on project app",
    "panic: runtime error: index out of range [3] with length 3",
    "'foo' is not recognized as an internal or external command,",
    "foo: The term 'foo' is not recognized as a name of a cmdlet, function, script file, or executable program.",
    "    + CategoryInfo          : ObjectNotFound: (foo:String) [], CommandNotFoundException",
    "    + FullyQualifiedErrorId : CommandNotFoundException",
    "Access is denied.",
    "The system cannot find the path specified.",
    // The same messages when the system speaks another language (Ubuntu and upstream wordings).
    "ls: no se puede acceder a '/no': No existe el archivo o el directorio",
    "cat: x: No existe el fichero o el directorio",
    "foo: orden no encontrada",
    "ls: Zugriff auf '/nope' nicht möglich: Datei oder Verzeichnis nicht gefunden",
    "ls: '/nope' にアクセスできません: そのようなファイルやディレクトリはありません",
    "ls: 无法访问 '/nope': 没有那个文件或目录",
    "rm: impossible de supprimer 'x': Permission non accordée",
    "2026-10-18 12:00:01 ERROR connection lost",
  ])("marks %s", (line) => {
    expect(isErrorLine(line)).toBe(true);
  });

  it.each([
    "",
    "total 12",
    "drwxr-xr-x 2 me me 4096 Oct 18 12:00 errors",
    "Tests  5 passed, 0 failed",
    "error_log  access_log",
    "Compiling app v0.1.0",
    "me@host:~$ ls",
    "No errors found.",
    "level counts: ERROR=0 WARN=2",
    "Die Datei wird geöffnet, das ist nicht möglich zu übersehen",
    "Ejecutando: no se puede efectuar sin red",
  ])("leaves %s alone", (line) => {
    expect(isErrorLine(line)).toBe(false);
  });
});

describe("errorColor", () => {
  it("is the scheme's red, or a default red when the scheme has none in #RRGGBB form", () => {
    expect(errorColor({ red: "#ef6b73" })).toBe("#ef6b73");
    expect(errorColor({})).toBe("#cd3131");
    expect(errorColor({ red: "rgb(255,0,0)" })).toBe("#cd3131");
  });
});

/** A terminal with a normal buffer of `rows` (`[text, wrapped]`), the cursor on the last row. */
class FakeTerminal implements HighlightTerminal {
  cols = 80;
  type: "normal" | "alternate" = "normal";
  rows: [string, boolean][] = [];
  markers: { line: number; isDisposed: boolean; dispose(): void; onDispose(listener: () => void): { dispose(): void } }[] = [];
  decorations: { line: number; color: string; width: number; disposed: boolean; disposeCalls: number }[] = [];
  /** How many times each row's text was read. */
  reads = new Map<number, number>();
  /** The cursor's row; the last row unless a test moves it (as `clear` does). */
  cursor: number | null = null;
  /** The first row of the screen; rows above it are scrollback. */
  baseY = 0;
  private listeners: (() => void)[] = [];

  private get cursorRow() {
    return this.cursor ?? this.rows.length - 1;
  }
  get buffer() {
    const rows = this.rows;
    return {
      active: {
        type: this.type,
        length: rows.length,
        baseY: this.baseY,
        cursorY: this.cursorRow - this.baseY,
        getLine: (i: number) =>
          rows[i] && {
            isWrapped: rows[i][1],
            translateToString: (trim?: boolean) => {
              this.reads.set(i, (this.reads.get(i) ?? 0) + 1);
              return trim ? rows[i][0].trimEnd() : rows[i][0];
            },
          },
      },
    };
  }
  registerMarker(offset = 0) {
    let listeners: (() => void)[] = [];
    const marker = {
      line: this.cursorRow + offset,
      isDisposed: false,
      dispose() {
        if (marker.isDisposed) return;
        marker.isDisposed = true;
        listeners.forEach((l) => l());
      },
      onDispose(listener: () => void) {
        listeners.push(listener);
        return { dispose: () => (listeners = listeners.filter((l) => l !== listener)) };
      },
    };
    this.markers.push(marker);
    return marker;
  }
  registerDecoration(options: { marker: { line: number }; foregroundColor?: string; width?: number }) {
    if (this.type === "alternate") return undefined;
    const decoration = { line: options.marker.line, color: options.foregroundColor ?? "", width: options.width ?? 1, disposed: false, disposeCalls: 0 };
    this.decorations.push(decoration);
    return {
      dispose() {
        decoration.disposed = true;
        decoration.disposeCalls++;
      },
    };
  }
  onWriteParsed(listener: () => void) {
    this.listeners.push(listener);
    return { dispose: () => (this.listeners = this.listeners.filter((l) => l !== listener)) };
  }
  /** Prints lines (the last one is where the cursor stays) and fires onWriteParsed. */
  print(...lines: (string | [string, boolean])[]) {
    for (const line of lines) this.rows.push(typeof line === "string" ? [line, false] : line);
    this.listeners.forEach((l) => l());
  }
  /** Rewrites the screen in place, as `clear` does: rows are blanked and the cursor goes back to `row`. */
  rewrite(row: number, ...lines: string[]) {
    for (let r = row; r < this.rows.length; r++) this.rows[r] = ["", false];
    lines.forEach((line, i) => (this.rows[row + i] = [line, false]));
    this.cursor = row + lines.length - 1;
    this.listeners.forEach((l) => l());
  }
  live() {
    return this.decorations.filter((d) => !d.disposed).map((d) => [d.line, d.color]);
  }
}

describe("attachErrorHighlight", () => {
  const setup = (enabled = true, color = "#ef6b73") => {
    const term = new FakeTerminal();
    const state = { enabled, color };
    // Scans run at once here; the app runs them once per frame.
    const highlight = attachErrorHighlight(term, {
      enabled: () => state.enabled,
      color: () => state.color,
      schedule: (scan) => scan(),
    });
    return { term, state, highlight };
  };

  it("reads the new output once for many writes before the next frame", () => {
    const term = new FakeTerminal();
    const frames: (() => void)[] = [];
    attachErrorHighlight(term, { enabled: () => true, color: () => "#f00", schedule: (scan) => frames.push(scan) });
    const markersBefore = term.markers.length;
    for (let i = 0; i < 10; i++) term.print(i === 5 ? "error: x" : `line ${i}`);
    term.print("$ ");
    expect(frames).toHaveLength(1);
    expect(term.live()).toEqual([]);
    frames.shift()!();
    expect(term.live()).toEqual([[5, "#f00"]]);
    // One marker for where the next scan starts, not one per write.
    expect(term.markers.length - markersBefore).toBeLessThanOrEqual(2);
  });

  it("colours the finished lines that look like errors, across the whole width", () => {
    const { term } = setup();
    term.print("$ cat nope", "cat: nope: No such file or directory", "$ ls", "file", "$ ");
    expect(term.live()).toEqual([[1, "#ef6b73"]]);
    expect(term.decorations[0].width).toBe(80);
  });

  it("leaves the cursor's line until it is finished, and never colours a line twice", () => {
    const { term } = setup();
    term.print("$ make", "error: build failed");
    expect(term.live()).toEqual([]);
    term.print("$ ");
    term.print("x", "$ ");
    expect(term.live()).toEqual([[1, "#ef6b73"]]);
  });

  it("keeps at most the limit of coloured rows, dropping the oldest", () => {
    const term = new FakeTerminal();
    attachErrorHighlight(term, { enabled: () => true, color: () => "#f00", schedule: (scan) => scan(), maxColoured: 2 });
    term.print("error: one", "error: two", "error: three", "$ ");
    expect(term.live()).toEqual([
      [1, "#f00"],
      [2, "#f00"],
    ]);
  });

  it("uncolours a row the scrollback gave back to the screen once it is rewritten", () => {
    const { term } = setup();
    term.print("error: old", "x", "y", "$ ");
    expect(term.live()).toEqual([[0, "#ef6b73"]]);
    // The error scrolls above the screen, then a taller pane brings it back and the screen is cleared.
    term.baseY = 2;
    term.print("$ ");
    term.baseY = 0;
    term.rewrite(0, "$ ls", "notes", "$ ");
    expect(term.live()).toEqual([]);
  });

  it("colours every row of a wrapped error line", () => {
    const { term } = setup();
    term.print("$ cmd", "fatal: a very long", [" message that wraps", true], "$ ");
    expect(term.live()).toEqual([
      [1, "#ef6b73"],
      [2, "#ef6b73"],
    ]);
  });

  it("does nothing while it is off or a full-screen program runs", () => {
    const { term, state } = setup(false);
    term.print("error: one", "$ ");
    expect(term.live()).toEqual([]);
    state.enabled = true;
    term.type = "alternate";
    term.print("error: in vim", "~");
    expect(term.live()).toEqual([]);
  });

  it("refresh recolours everything with the current colour, or clears it when off", () => {
    const { term, state, highlight } = setup();
    term.print("error: one", "$ ");
    state.color = "#ff0000";
    highlight.refresh();
    expect(term.live()).toEqual([[0, "#ff0000"]]);
    state.enabled = false;
    highlight.refresh();
    expect(term.live()).toEqual([]);
  });

  it("never lets a failing decoration get in the way of the output", () => {
    const { term } = setup();
    term.registerDecoration = () => {
      throw new Error("You must set the allowProposedApi option to true to use proposed API");
    };
    expect(() => term.print("error: one", "$ ")).not.toThrow();
  });

  it("drops the colour of a screen row that is rewritten, and colours the errors printed after a clear", () => {
    const { term } = setup();
    term.print("$ cat nope", "cat: nope: No such file or directory", "$ ls", "a", "b", "$ ");
    expect(term.live()).toEqual([[1, "#ef6b73"]]);
    // `clear`: the screen is blanked and the cursor goes back to its top.
    term.rewrite(0, "$ ls", "notes.txt", "$ git status", "fatal: not a git repository", "$ ");
    expect(term.live()).toEqual([[3, "#ef6b73"]]);
  });

  it("keeps the colours of scrollback rows, which can no longer change", () => {
    const { term } = setup();
    term.print("error: old", "x", "y", "$ ");
    term.baseY = 2;
    term.rewrite(2, "$ ");
    expect(term.live()).toEqual([[0, "#ef6b73"]]);
  });

  it("never colours a row twice, even when it reads the buffer again", () => {
    const { term } = setup();
    term.print("error: one", "$ ");
    // The marker of the next row to read left the scrollback: everything is read again.
    term.markers[term.markers.length - 1].dispose();
    term.print("x", "$ ");
    expect(term.live()).toEqual([[0, "#ef6b73"]]);
  });

  it("keeps no marker behind when a decoration cannot be drawn", () => {
    const { term } = setup();
    term.registerDecoration = () => {
      throw new Error("no decorations");
    };
    term.print("error: one", "$ ");
    term.print("x", "$ ");
    expect(term.markers.filter((m) => !m.isDisposed).length).toBeLessThanOrEqual(1);
  });

  it("dispose removes the colours and stops listening", () => {
    const { term, highlight } = setup();
    term.print("error: one", "$ ");
    highlight.dispose();
    term.print("error: two", "$ ");
    expect(term.live()).toEqual([]);
  });

  it("never touches the coloured rows that scrolled above the screen again", () => {
    const { term } = setup();
    for (let i = 0; i < 50; i++) term.print(`error: ${i}`);
    term.print("$ ");
    expect(term.live()).toHaveLength(50);
    // The screen moves down past every coloured row; the next scan lets them go.
    term.baseY = 50;
    term.print("x", "$ ");
    // From now on a scan reads nothing of them: neither their markers nor their text.
    let touched = 0;
    for (const marker of term.markers.filter((m) => m.line < 50)) {
      const { line, isDisposed } = marker;
      Object.defineProperty(marker, "line", { get: () => (touched++, line) });
      Object.defineProperty(marker, "isDisposed", { get: () => (touched++, isDisposed) });
    }
    term.reads.clear();
    term.print("y", "$ ");
    term.print("z", "$ ");
    expect(touched).toBe(0);
    expect([...term.reads.keys()].filter((row) => row < 50)).toEqual([]);
    expect(term.live()).toHaveLength(50);
  });

  it("reads a wrapped error line on the screen once per scan", () => {
    const { term } = setup();
    term.print("$ cmd", "fatal: a very long", [" message", true], [" that wraps", true], [" four rows", true], "$ ");
    expect(term.live()).toHaveLength(4);
    term.reads.clear();
    term.print("x", "$ ");
    expect([1, 2, 3, 4].map((row) => term.reads.get(row))).toEqual([1, 1, 1, 1]);
    expect(term.live()).toHaveLength(4);
  });

  it("forgets a colour whose row left the scrollback", () => {
    const { term, highlight } = setup();
    term.print("error: one", "$ ");
    const [decoration] = term.decorations;
    // The terminal drops the oldest row: its marker and decoration go with it.
    term.markers.find((m) => m.line === 0 && !m.isDisposed)!.dispose();
    decoration.disposed = true;
    highlight.dispose();
    expect(decoration.disposeCalls).toBe(0);
  });
});
