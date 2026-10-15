import { describe, expect, it } from "vitest";
import {
  emptyMacros,
  formatEscapes,
  hotkeyLabel,
  macrosReducer,
  parseEscapes,
  parseMacros,
  recordedSteps,
  recorderReduce,
  serializeMacros,
  type Macro,
  type MacroList,
} from "./macros";

const macro = (id: string, extra: Partial<Macro> = {}): Macro => ({
  id,
  name: id,
  steps: [{ kind: "send", text: "ls\\r" }],
  ...extra,
});
const listOf = (...macros: Macro[]): MacroList => ({ version: 1, macros });

describe("parseEscapes (S16.1)", () => {
  it("turns \\r \\n \\t \\e \\\\ and \\xHH into characters", () => {
    expect(parseEscapes("a\\rb\\nc\\td\\ee\\\\f")).toBe("a\rb\nc\td\x1be\\f");
    expect(parseEscapes("\\x41\\x1b\\x7F")).toBe("A\x1b\x7f");
  });

  it("turns ^A..^Z, ^[ and ^? into control characters", () => {
    expect(parseEscapes("^C^D^Z")).toBe("\x03\x04\x1a");
    expect(parseEscapes("^[[A")).toBe("\x1b[A");
    expect(parseEscapes("^?")).toBe("\x7f");
  });

  it("leaves invalid escapes literal", () => {
    expect(parseEscapes("\\q \\x4 \\xZZ \\")).toBe("\\q \\x4 \\xZZ \\");
    expect(parseEscapes("^a ^1 ^ x^")).toBe("^a ^1 ^ x^");
  });
});

describe("formatEscapes", () => {
  it("shows control characters as escapes", () => {
    expect(formatEscapes("ls -la\r")).toBe("ls -la\\r");
    expect(formatEscapes("\x03\n\t\x1b\\\x7f\x00")).toBe("^C\\n\\t\\e\\\\^?\\x00");
  });

  it("escapes a caret that would otherwise read as a control character", () => {
    expect(formatEscapes("^A ^a")).toBe("\\x5EA ^a");
  });

  it("round-trips every ASCII character and non-ASCII text", () => {
    let all = "";
    for (let c = 0; c < 128; c++) all += String.fromCharCode(c) + "A?[x41";
    all += "ñ€😀 \\x41 ^C";
    expect(parseEscapes(formatEscapes(all))).toBe(all);
  });
});

describe("parseMacros / serializeMacros (S16.5)", () => {
  it("reads a missing file as an empty list", () => {
    expect(parseMacros(null)).toEqual({ ok: true, list: emptyMacros });
  });

  it("round-trips every step kind and the hotkey", () => {
    const list = listOf(
      macro("m1", {
        hotkey: 3,
        steps: [
          { kind: "send", text: "ssh host\\r" },
          { kind: "wait", ms: 500 },
          { kind: "waitFor", text: "password:", timeoutSec: 10 },
        ],
      }),
      macro("m2"),
    );
    expect(parseMacros(serializeMacros(list))).toEqual({ ok: true, list });
  });

  it("never silently empties a corrupt file", () => {
    expect(parseMacros("{")).toMatchObject({ ok: false });
    expect(parseMacros(JSON.stringify({ version: 2, macros: [] }))).toEqual({
      ok: false,
      error: "unsupported macros file version",
    });
    expect(parseMacros(JSON.stringify({ version: 1, macros: "x" }))).toEqual({
      ok: false,
      error: "macros file has invalid macros",
    });
  });

  it("rejects values out of range", () => {
    const bad = (m: unknown) => parseMacros(JSON.stringify({ version: 1, macros: [m] })).ok;
    expect(bad(macro("m", { hotkey: 0 }))).toBe(false);
    expect(bad(macro("m", { hotkey: 10 }))).toBe(false);
    expect(bad(macro("m", { steps: [{ kind: "wait", ms: -1 }] }))).toBe(false);
    expect(bad(macro("m", { steps: [{ kind: "wait", ms: 1.5 }] }))).toBe(false);
    expect(bad(macro("m", { steps: [{ kind: "waitFor", text: "", timeoutSec: 10 }] }))).toBe(false);
    expect(bad(macro("m", { steps: [{ kind: "waitFor", text: "$", timeoutSec: 0 }] }))).toBe(false);
    expect(bad({ id: "m", name: "m", steps: [{ kind: "beep" }] })).toBe(false);
    expect(bad(macro("m", { steps: [{ kind: "send", text: "ok" }] }))).toBe(true);
  });

  it("rejects two macros with the same hotkey", () => {
    const json = serializeMacros(listOf(macro("a", { hotkey: 1 }), macro("b", { hotkey: 1 })));
    expect(parseMacros(json)).toEqual({ ok: false, error: "macros file has two macros on Ctrl+Alt+1" });
  });

  it("writes only the known fields", () => {
    const extra = { ...macro("m"), password: "x", steps: [{ kind: "send", text: "a", junk: 1 }] } as unknown as Macro;
    expect(serializeMacros(listOf(extra))).not.toMatch(/password|junk/);
  });
});

describe("macrosReducer (S16.3, S16.4)", () => {
  it("adds and replaces macros on save", () => {
    let list = macrosReducer(emptyMacros, { type: "save", macro: macro("a") });
    list = macrosReducer(list, { type: "save", macro: macro("b") });
    list = macrosReducer(list, { type: "save", macro: macro("a", { name: "renamed" }) });
    expect(list.macros.map((m) => m.name)).toEqual(["renamed", "b"]);
  });

  it("deletes a macro", () => {
    const list = macrosReducer(listOf(macro("a"), macro("b")), { type: "delete", id: "a" });
    expect(list.macros.map((m) => m.id)).toEqual(["b"]);
  });

  it("duplicates a macro right after the original, without its hotkey", () => {
    const list = macrosReducer(listOf(macro("a", { hotkey: 2 }), macro("b")), { type: "duplicate", id: "a", newId: "c" });
    expect(list.macros.map((m) => m.id)).toEqual(["a", "c", "b"]);
    expect(list.macros[1]).toEqual({ id: "c", name: "a (copy)", steps: [{ kind: "send", text: "ls\\r" }] });
    expect(list.macros[0].hotkey).toBe(2);
  });

  it("moves a hotkey that another macro used", () => {
    const list = macrosReducer(listOf(macro("a", { hotkey: 4 }), macro("b")), {
      type: "save",
      macro: macro("b", { hotkey: 4 }),
    });
    expect(list.macros[0].hotkey).toBeUndefined();
    expect(list.macros[1].hotkey).toBe(4);
  });

  it("labels hotkeys", () => {
    expect(hotkeyLabel(7)).toBe("Ctrl+Alt+7");
  });
});

describe("recorder (S16.2)", () => {
  it("merges consecutive keystrokes and starts a new send step after Enter", () => {
    let raw: string[] = [];
    for (const key of ["l", "s", "\r", "p", "w", "d", "\r", "\x03"]) raw = recorderReduce(raw, key);
    expect(raw).toEqual(["ls\r", "pwd\r", "\x03"]);
    expect(recordedSteps(raw)).toEqual([
      { kind: "send", text: "ls\\r" },
      { kind: "send", text: "pwd\\r" },
      { kind: "send", text: "^C" },
    ]);
  });

  it("records a paste as one chunk, merged like typing", () => {
    const raw = recorderReduce(recorderReduce([], "echo "), "^A pasted\n");
    expect(raw).toEqual(["echo ^A pasted\n"]);
    // A caret followed by a letter split across chunks is still escaped once merged.
    expect(recordedSteps(recorderReduce(recorderReduce([], "^"), "A"))).toEqual([{ kind: "send", text: "\\x5EA" }]);
  });

  it("ignores empty input", () => {
    expect(recorderReduce([], "")).toEqual([]);
  });
});
