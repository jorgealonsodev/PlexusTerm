import { describe, expect, it } from "vitest";
import { SHORTCUT_ACTIONS, shortcutConflict, shortcutFor, shortcutLabel, type KeyLike } from "./shortcuts";

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

  it("maps Ctrl+Shift+R to recording and Ctrl+Alt+1..9 to macro hotkeys (S16.2, S16.4)", () => {
    expect(shortcutFor(ctrlShift("r"))).toEqual({ type: "recordMacro" });
    expect(shortcutFor(key("1", { ctrlKey: true, altKey: true }))).toEqual({ type: "playMacro", hotkey: 1 });
    expect(shortcutFor(key("9", { ctrlKey: true, altKey: true }))).toEqual({ type: "playMacro", hotkey: 9 });
    // Ctrl+Alt+0 is not a hotkey, and Ctrl+Alt+Shift+1 belongs to the terminal.
    expect(shortcutFor(key("0", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(shortcutFor(key("!", { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull();
    // A character typed with AltGr (reported as Ctrl+Alt on some systems) still reaches the terminal.
    expect(shortcutFor(key("@", { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("leaves every other key to the terminal", () => {
    expect(shortcutFor(key("d", { ctrlKey: true }))).toBeNull(); // Ctrl+D is EOF for the shell
    expect(shortcutFor(key("c", { ctrlKey: true }))).toBeNull(); // Ctrl+C interrupts
    expect(shortcutFor(key("v", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("1", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(ctrlShift("Z"))).toBeNull();
    expect(shortcutFor(key("ArrowLeft"))).toBeNull();
    expect(shortcutFor(key("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("D", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
});

describe("sidebar shortcut", () => {
  it("Ctrl+Shift+B folds or opens the sidebar", () => {
    expect(shortcutFor(key("B", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "toggleSidebar" });
    expect(shortcutFor(key("b", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "toggleSidebar" });
    expect(shortcutFor(key("b", { ctrlKey: true }))).toBeNull();
  });
});

describe("customised shortcuts", () => {
  it("an override replaces every default combination of its action", () => {
    const overrides = { newTerminal: "Ctrl+Alt+N", fontIncrease: "Ctrl+Alt+=" };
    expect(shortcutFor(key("n", { ctrlKey: true, altKey: true }), overrides)).toEqual({ type: "newTerminal" });
    expect(shortcutFor(ctrlShift("T"), overrides)).toBeNull();
    expect(shortcutFor(key("=", { ctrlKey: true, altKey: true }), overrides)).toEqual({ type: "fontSize", step: "increase" });
    expect(shortcutFor(key("=", { ctrlKey: true }), overrides)).toBeNull();
    expect(shortcutFor(key("+", { ctrlKey: true }), overrides)).toBeNull();
    // Other actions keep their defaults.
    expect(shortcutFor(ctrlShift("D"), overrides)).toEqual({ type: "split", direction: "row" });
  });

  it("an empty override leaves the action unbound", () => {
    expect(shortcutFor(ctrlShift("B"), { toggleSidebar: "" })).toBeNull();
    expect(shortcutLabel("toggleSidebar", { toggleSidebar: "" })).toBe("");
  });

  it("actions without a default do nothing until bound", () => {
    expect(SHORTCUT_ACTIONS.nextTab.defaults).toEqual([]);
    expect(shortcutFor(key("PageDown", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("PageDown", { ctrlKey: true }), { nextTab: "Ctrl+PageDown" })).toEqual({ type: "nextTab" });
    expect(shortcutFor(key("1", { ctrlKey: true, metaKey: true }), { openSettings: "Ctrl+Meta+1" })).toEqual({ type: "openSettings" });
  });

  it("keeps Meta combinations, AltGr characters and the macro keys out of the defaults", () => {
    expect(shortcutFor(key("T", { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeNull();
    expect(shortcutFor(key("=", { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(shortcutFor(key("1", { ctrlKey: true, altKey: true, metaKey: true }))).toBeNull();
    expect(shortcutFor(key("@", { ctrlKey: true, altKey: true }), { newTerminal: "Ctrl+Alt+N" })).toBeNull();
    expect(shortcutFor(key("3", { ctrlKey: true, altKey: true }), { newTerminal: "Ctrl+Alt+N" })).toEqual({ type: "playMacro", hotkey: 3 });
  });

  it("shows the first effective combination of an action", () => {
    expect(shortcutLabel("fontIncrease")).toBe("Ctrl+=");
    expect(shortcutLabel("closePane", { closePane: "Alt+W" })).toBe("Alt+W");
    expect(shortcutLabel("keyGen")).toBe("");
  });

  it("names what already uses a combination", () => {
    expect(shortcutConflict("Ctrl+Shift+T", {}, { action: "closeTab" })).toEqual({ kind: "action", action: "newTerminal" });
    expect(shortcutConflict("Ctrl+Shift+T", {}, { action: "newTerminal" })).toBeNull();
    expect(shortcutConflict("Ctrl+Shift+T", { newTerminal: "Alt+N" }, { action: "closeTab" })).toBeNull();
    expect(shortcutConflict("Ctrl++", {}, { action: "closeTab" })).toEqual({ kind: "action", action: "fontIncrease" });
    expect(shortcutConflict("Alt+K", { keyGen: "Alt+K" }, { action: "portScan" })).toEqual({ kind: "action", action: "keyGen" });
    expect(shortcutConflict("Ctrl+Alt+4", {}, { action: "closeTab" })).toEqual({ kind: "reserved", use: "playMacro" });
    expect(shortcutConflict("Ctrl+ArrowRight", {}, { action: "closeTab" })).toEqual({ kind: "reserved", use: "acceptWord" });
    expect(
      shortcutConflict("Ctrl+Shift+Space", {}, { action: "closeTab", assistantShortcut: "Ctrl+Shift+Space" }),
    ).toEqual({ kind: "assistant" });
    // Checking the assistant itself: the actions and fixed keys count.
    expect(shortcutConflict("Ctrl+Shift+W", {})).toEqual({ kind: "action", action: "closePane" });
    expect(shortcutConflict("Ctrl+Shift+W", { closePane: "" })).toBeNull();
  });
});

describe("Toggle DEV mode (S10)", () => {
  it("is an unbound terminal action that answers to the combination it is given", () => {
    expect(SHORTCUT_ACTIONS.toggleDevMode.defaults).toEqual([]);
    expect(SHORTCUT_ACTIONS.toggleDevMode.group).toBe("terminal");
    const key = { key: "y", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false };
    expect(shortcutFor(key)).toBeNull();
    expect(shortcutFor(key, { toggleDevMode: "Ctrl+Shift+Y" })).toEqual({ type: "toggleDevMode" });
  });
});

describe("copy mode and quick select (S7)", () => {
  it("are terminal actions on Ctrl+Shift+X and Ctrl+Shift+Q", () => {
    expect(SHORTCUT_ACTIONS.copyMode).toMatchObject({ group: "terminal", defaults: ["Ctrl+Shift+X"] });
    expect(SHORTCUT_ACTIONS.quickSelect).toMatchObject({ group: "terminal", defaults: ["Ctrl+Shift+Q"] });
    expect(shortcutFor(ctrlShift("X"))).toEqual({ type: "copyMode" });
    expect(shortcutFor(ctrlShift("q"))).toEqual({ type: "quickSelect" });
  });

  it("take combinations no other default, fixed key or the AI assistant uses", () => {
    for (const id of ["copyMode", "quickSelect"] as const) {
      for (const combo of SHORTCUT_ACTIONS[id].defaults) {
        expect(shortcutConflict(combo, {}, { action: id, assistantShortcut: "Ctrl+Shift+Space" })).toBeNull();
      }
    }
  });

  it("can be moved or cleared like any other action", () => {
    expect(shortcutFor(ctrlShift("X"), { copyMode: "" })).toBeNull();
    expect(shortcutFor(key("y", { altKey: true }), { quickSelect: "Alt+Y" })).toEqual({ type: "quickSelect" });
  });
});
