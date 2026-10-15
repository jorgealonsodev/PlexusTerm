import { describe, expect, it } from "vitest";
import { appShortcutConflict, isValidShortcut, shortcutFromEvent } from "./shortcutCapture";

const key = (k: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("shortcutFromEvent", () => {
  it("names a key combination", () => {
    expect(shortcutFromEvent(key(" ", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Space");
    expect(shortcutFromEvent(key("k", { altKey: true }))).toBe("Alt+K");
    expect(shortcutFromEvent(key("F2", { ctrlKey: true, metaKey: true }))).toBe("Ctrl+Meta+F2");
  });

  it("waits while only modifiers are held", () => {
    expect(shortcutFromEvent(key("Control", { ctrlKey: true }))).toBeNull();
    expect(shortcutFromEvent(key("Shift", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("isValidShortcut", () => {
  it("needs Ctrl, Alt or Meta and one key", () => {
    expect(isValidShortcut("Ctrl+Shift+Space")).toBe(true);
    expect(isValidShortcut("Shift+A")).toBe(false);
    expect(isValidShortcut("A")).toBe(false);
    expect(isValidShortcut("Ctrl+")).toBe(false);
    expect(isValidShortcut("Ctrl+Ctrl+A")).toBe(false);
  });
});

describe("appShortcutConflict", () => {
  it("refuses combinations PlexusTerm already uses", () => {
    expect(appShortcutConflict("Ctrl+Shift+T")).toBe(true);
    expect(appShortcutConflict("Ctrl+=")).toBe(true);
    expect(appShortcutConflict("Ctrl+Alt+3")).toBe(true);
    expect(appShortcutConflict("Alt+ArrowLeft")).toBe(true);
    expect(appShortcutConflict("Ctrl+ArrowRight")).toBe(true);
    expect(appShortcutConflict("Ctrl+Shift+Space")).toBe(false);
    expect(appShortcutConflict("Alt+K")).toBe(false);
  });
});
