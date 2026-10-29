import { describe, expect, it } from "vitest";
import { createKittyKeyboard, encodeKittyKey, KITTY_STACK_MAX, type KittyKey } from "./kittyKeyboard";

const key = (k: string, mods: Partial<KittyKey> = {}): KittyKey => ({
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});

describe("createKittyKeyboard", () => {
  it("answers a query with the current flags, 0 before any program asks for the protocol", () => {
    const kitty = createKittyKeyboard();
    expect(kitty.query("normal")).toBe("\x1b[?0u");
    kitty.push("normal", 1);
    expect(kitty.query("normal")).toBe("\x1b[?1u");
  });

  it("reports only the supported flag (disambiguate escape codes)", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 0b11111);
    expect(kitty.flags("normal")).toBe(1);
    expect(kitty.query("normal")).toBe("\x1b[?1u");
    kitty.push("normal", 0b11110);
    expect(kitty.query("normal")).toBe("\x1b[?0u");
  });

  it("pops what was pushed, one entry by default, and an emptied stack means no flags", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 1);
    kitty.push("normal", 0);
    expect(kitty.flags("normal")).toBe(0);
    kitty.pop("normal");
    expect(kitty.flags("normal")).toBe(1);
    kitty.pop("normal");
    expect(kitty.flags("normal")).toBe(0);
    // Popping an empty stack is harmless.
    kitty.pop("normal", 5);
    expect(kitty.flags("normal")).toBe(0);
  });

  it("pops several entries at once, all of them when asked for more than there are", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 1);
    kitty.push("normal", 0);
    kitty.push("normal", 1);
    kitty.pop("normal", 2);
    expect(kitty.flags("normal")).toBe(1);
    kitty.push("normal", 1);
    kitty.pop("normal", 10);
    expect(kitty.flags("normal")).toBe(0);
  });

  it(`keeps at most ${KITTY_STACK_MAX} entries, dropping the oldest`, () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 0);
    for (let i = 0; i < KITTY_STACK_MAX; i++) kitty.push("normal", 1);
    // The 0 at the bottom was evicted: popping all but one still leaves a 1.
    kitty.pop("normal", KITTY_STACK_MAX - 1);
    expect(kitty.flags("normal")).toBe(1);
    kitty.pop("normal");
    expect(kitty.flags("normal")).toBe(0);
  });

  it("sets the current flags: mode 1 replaces, 2 adds the set bits, 3 removes them", () => {
    const kitty = createKittyKeyboard();
    kitty.set("normal", 1, 1);
    expect(kitty.flags("normal")).toBe(1);
    kitty.set("normal", 0, 1);
    expect(kitty.flags("normal")).toBe(0);
    kitty.set("normal", 1, 2);
    expect(kitty.flags("normal")).toBe(1);
    kitty.set("normal", 0, 2);
    expect(kitty.flags("normal")).toBe(1);
    kitty.set("normal", 1, 3);
    expect(kitty.flags("normal")).toBe(0);
    // Mode defaults to 1; an unknown mode changes nothing.
    kitty.set("normal", 1);
    expect(kitty.flags("normal")).toBe(1);
    kitty.set("normal", 0, 9);
    expect(kitty.flags("normal")).toBe(1);
  });

  it("sets the top entry only: popping returns to the flags below", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 0);
    kitty.push("normal", 0);
    kitty.set("normal", 1);
    expect(kitty.flags("normal")).toBe(1);
    kitty.pop("normal");
    expect(kitty.flags("normal")).toBe(0);
  });

  it("keeps separate stacks for the main and the alternate screen", () => {
    const kitty = createKittyKeyboard();
    kitty.push("alternate", 1);
    expect(kitty.flags("alternate")).toBe(1);
    expect(kitty.flags("normal")).toBe(0);
    expect(kitty.query("normal")).toBe("\x1b[?0u");
    kitty.push("normal", 1);
    kitty.pop("alternate");
    expect(kitty.flags("alternate")).toBe(0);
    expect(kitty.flags("normal")).toBe(1);
  });

  it("empties both stacks on reset", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 1);
    kitty.push("alternate", 1);
    kitty.reset();
    expect(kitty.flags("normal")).toBe(0);
    expect(kitty.flags("alternate")).toBe(0);
  });
});

describe("encodeKittyKey", () => {
  it("sends nothing of its own while the protocol is off: every key stays xterm's", () => {
    for (const k of ["Enter", "Tab", "Backspace", "Escape", "a"]) {
      for (const mods of [{}, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { metaKey: true }]) {
        expect(encodeKittyKey(key(k, mods), 0)).toBeNull();
      }
    }
  });

  it("encodes Ctrl+Enter as CSI 13;5u and Shift+Enter as CSI 13;2u", () => {
    expect(encodeKittyKey(key("Enter", { ctrlKey: true }), 1)).toBe("\x1b[13;5u");
    expect(encodeKittyKey(key("Enter", { shiftKey: true }), 1)).toBe("\x1b[13;2u");
  });

  it("encodes Alt+Enter, Super+Enter and combined modifiers (1 + shift 1 + alt 2 + ctrl 4 + super 8)", () => {
    expect(encodeKittyKey(key("Enter", { altKey: true }), 1)).toBe("\x1b[13;3u");
    expect(encodeKittyKey(key("Enter", { metaKey: true }), 1)).toBe("\x1b[13;9u");
    expect(encodeKittyKey(key("Enter", { ctrlKey: true, shiftKey: true }), 1)).toBe("\x1b[13;6u");
    expect(encodeKittyKey(key("Enter", { shiftKey: true, altKey: true, ctrlKey: true, metaKey: true }), 1)).toBe(
      "\x1b[13;16u",
    );
  });

  it("encodes Ctrl+Backspace as CSI 127;5u and Shift+Tab as CSI 9;2u", () => {
    expect(encodeKittyKey(key("Backspace", { ctrlKey: true }), 1)).toBe("\x1b[127;5u");
    expect(encodeKittyKey(key("Backspace", { altKey: true }), 1)).toBe("\x1b[127;3u");
    expect(encodeKittyKey(key("Tab", { shiftKey: true }), 1)).toBe("\x1b[9;2u");
    expect(encodeKittyKey(key("Tab", { ctrlKey: true }), 1)).toBe("\x1b[9;5u");
  });

  it("leaves plain Enter, Tab and Backspace to xterm (\\r, \\t, \\x7f), so a shell still works", () => {
    for (const k of ["Enter", "Tab", "Backspace"]) expect(encodeKittyKey(key(k), 1)).toBeNull();
  });

  it("encodes Escape as CSI 27u, with its modifiers when held", () => {
    expect(encodeKittyKey(key("Escape"), 1)).toBe("\x1b[27u");
    expect(encodeKittyKey(key("Escape", { shiftKey: true }), 1)).toBe("\x1b[27;2u");
  });

  it("leaves every other key to xterm", () => {
    for (const k of ["a", "ArrowUp", "F1", " ", "Delete"]) {
      expect(encodeKittyKey(key(k, { ctrlKey: true }), 1)).toBeNull();
    }
  });

  it("encodes Alt, Ctrl+Alt, Shift+Alt and Super with a letter, digit or symbol by its unshifted key", () => {
    expect(encodeKittyKey(key("a", { altKey: true, code: "KeyA" }), 1)).toBe("\x1b[97;3u");
    expect(encodeKittyKey(key("K", { altKey: true, shiftKey: true, code: "KeyK" }), 1)).toBe("\x1b[107;4u");
    expect(encodeKittyKey(key("w", { altKey: true, ctrlKey: true, code: "KeyW" }), 1)).toBe("\x1b[119;7u");
    expect(encodeKittyKey(key("3", { altKey: true, code: "Digit3" }), 1)).toBe("\x1b[51;3u");
    expect(encodeKittyKey(key("/", { altKey: true, code: "Slash" }), 1)).toBe("\x1b[47;3u");
    expect(encodeKittyKey(key("]", { altKey: true, ctrlKey: true, code: "BracketRight" }), 1)).toBe("\x1b[93;7u");
    expect(encodeKittyKey(key("/", { metaKey: true, code: "Slash" }), 1)).toBe("\x1b[47;9u");
  });

  it("encodes Ctrl+Shift with a letter, which xterm sends as the bare Ctrl+letter", () => {
    expect(encodeKittyKey(key("A", { ctrlKey: true, shiftKey: true, code: "KeyA" }), 1)).toBe("\x1b[97;6u");
    expect(encodeKittyKey(key("J", { ctrlKey: true, shiftKey: true, code: "KeyJ" }), 1)).toBe("\x1b[106;6u");
  });

  it("leaves typing to xterm: plain and shifted characters, Ctrl+letter, AltGr and characters a modifier makes", () => {
    for (const [k, code] of [["a", "KeyA"], ["A", "KeyA"], ["/", "Slash"], ["?", "Slash"]] as const) {
      expect(encodeKittyKey(key(k, { code }), 1)).toBeNull();
      expect(encodeKittyKey(key(k, { code, shiftKey: k !== k.toLowerCase() || k === "?" }), 1)).toBeNull();
    }
    expect(encodeKittyKey(key("c", { ctrlKey: true, code: "KeyC" }), 1)).toBeNull();
    // AltGr (Ctrl+Alt on Windows) writes characters such as @ and €.
    expect(encodeKittyKey(key("@", { ctrlKey: true, altKey: true, code: "Digit2", getModifierState: (m) => m === "AltGraph" }), 1)).toBeNull();
    expect(encodeKittyKey(key("q", { ctrlKey: true, altKey: true, code: "KeyQ", getModifierState: (m) => m === "AltGraph" }), 1)).toBeNull();
    // macOS Option makes its own characters (Option+A is å).
    expect(encodeKittyKey(key("å", { altKey: true, code: "KeyA" }), 1)).toBeNull();
    // A shifted symbol with Alt has no unshifted key to name: it stays xterm's.
    expect(encodeKittyKey(key("!", { altKey: true, shiftKey: true, code: "Digit1" }), 1)).toBeNull();
  });

  it("leaves a key being composed by an input method alone", () => {
    expect(encodeKittyKey(key("a", { altKey: true, code: "KeyA", isComposing: true }), 1)).toBeNull();
    expect(encodeKittyKey(key("Enter", { ctrlKey: true, isComposing: true }), 1)).toBeNull();
    expect(encodeKittyKey(key("Escape", { keyCode: 229 }), 1)).toBeNull();
  });
});

describe("clear", () => {
  it("empties one screen's stack and leaves the other's", () => {
    const kitty = createKittyKeyboard();
    kitty.push("normal", 1);
    kitty.push("alternate", 1);
    kitty.clear("alternate");
    expect(kitty.flags("alternate")).toBe(0);
    expect(kitty.flags("normal")).toBe(1);
  });
});

