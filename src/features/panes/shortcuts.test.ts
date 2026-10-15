import { describe, expect, it } from "vitest";
import { shortcutFor, type KeyLike } from "./shortcuts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});
const ctrlShift = (k: string) => key(k, { ctrlKey: true, shiftKey: true });

describe("shortcutFor", () => {
  it("maps the Ctrl+Shift shortcuts, whatever the letter case", () => {
    expect(shortcutFor(ctrlShift("T"))).toEqual({ type: "newTerminal" });
    expect(shortcutFor(ctrlShift("S"))).toEqual({ type: "quickConnect" });
    expect(shortcutFor(ctrlShift("W"))).toEqual({ type: "closePane" });
    expect(shortcutFor(ctrlShift("D"))).toEqual({ type: "split", direction: "row" });
    expect(shortcutFor(ctrlShift("e"))).toEqual({ type: "split", direction: "column" });
    expect(shortcutFor(ctrlShift("M"))).toEqual({ type: "toggleMultiExec" });
  });

  it("maps Alt+Arrow to focus moves", () => {
    expect(shortcutFor(key("ArrowLeft", { altKey: true }))).toEqual({ type: "focus", direction: "left" });
    expect(shortcutFor(key("ArrowRight", { altKey: true }))).toEqual({ type: "focus", direction: "right" });
    expect(shortcutFor(key("ArrowUp", { altKey: true }))).toEqual({ type: "focus", direction: "up" });
    expect(shortcutFor(key("ArrowDown", { altKey: true }))).toEqual({ type: "focus", direction: "down" });
  });

  it("maps find, copy and paste (S15.1, S15.3)", () => {
    expect(shortcutFor(ctrlShift("F"))).toEqual({ type: "find" });
    expect(shortcutFor(ctrlShift("c"))).toEqual({ type: "copy" });
    expect(shortcutFor(ctrlShift("V"))).toEqual({ type: "paste" });
  });

  it("maps Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 to font size changes (S15.2)", () => {
    expect(shortcutFor(key("=", { ctrlKey: true }))).toEqual({ type: "fontSize", step: "increase" });
    expect(shortcutFor(key("+", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "fontSize", step: "increase" });
    expect(shortcutFor(key("+", { ctrlKey: true }))).toEqual({ type: "fontSize", step: "increase" });
    expect(shortcutFor(key("-", { ctrlKey: true }))).toEqual({ type: "fontSize", step: "decrease" });
    expect(shortcutFor(key("0", { ctrlKey: true }))).toEqual({ type: "fontSize", step: "reset" });
    expect(shortcutFor(key("0", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(key("-", { altKey: true }))).toBeNull();
  });

  it("leaves every other key to the terminal", () => {
    expect(shortcutFor(key("d", { ctrlKey: true }))).toBeNull(); // Ctrl+D is EOF for the shell
    expect(shortcutFor(key("c", { ctrlKey: true }))).toBeNull(); // Ctrl+C interrupts
    expect(shortcutFor(key("v", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("1", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(ctrlShift("X"))).toBeNull();
    expect(shortcutFor(key("ArrowLeft"))).toBeNull();
    expect(shortcutFor(key("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("D", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
});
