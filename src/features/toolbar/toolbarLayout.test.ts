import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOLBAR_LAYOUT,
  TOOLBAR_ACTIONS,
  addGroup,
  cleanToolbarLayout,
  moveAction,
  moveGroup,
  removeGroup,
  renameGroup,
  whereIs,
  type ToolbarLayout,
} from "./toolbarLayout";

const ids = (layout: ToolbarLayout) =>
  layout.bar.map((entry) => (entry.kind === "action" ? entry.id : `${entry.id}[${entry.items.join(",")}]`));

describe("toolbar layout", () => {
  it("places every action once by default, with More and Tools as groups", () => {
    expect(ids(DEFAULT_TOOLBAR_LAYOUT)).toEqual([
      "sidebar",
      "terminal",
      "ssh",
      "serial",
      "more[telnet,mosh,openShared,playRecording]",
      "tools[keyGen,portScan,networkScan,wakeOnLan,remoteMonitor]",
      "splitRight",
      "splitDown",
      "multiExec",
      "recordMacro",
      "devColumn",
    ]);
    expect(DEFAULT_TOOLBAR_LAYOUT.hidden).toEqual([]);
    const placed = DEFAULT_TOOLBAR_LAYOUT.bar.flatMap((e) => (e.kind === "action" ? [e.id] : e.items));
    expect([...placed].sort()).toEqual([...TOOLBAR_ACTIONS].sort());
  });

  it("keeps no saved layout as the default one", () => {
    expect(cleanToolbarLayout(null)).toBeNull();
    expect(cleanToolbarLayout("bar")).toBeNull();
    expect(cleanToolbarLayout({ bar: "x" })).toBeNull();
  });

  it("drops unknown and repeated actions and bad groups, and appends missing actions to the bar", () => {
    const layout = cleanToolbarLayout({
      bar: [
        { kind: "action", id: "ssh" },
        { kind: "action", id: "rocket" },
        { kind: "group", id: "mine", name: "  Network  ", items: ["portScan", "ssh", "nope", "wakeOnLan"] },
        { kind: "group", id: "mine", name: "Twice", items: ["telnet"] },
        { kind: "group", id: "bad id!", name: "x", items: [] },
        { kind: "group", id: "long", name: "n".repeat(100), items: "telnet" },
      ],
      hidden: ["recordMacro", "recordMacro", "ssh"],
    })!;
    expect(layout.bar.slice(0, 3)).toEqual([
      { kind: "action", id: "ssh" },
      { kind: "group", id: "mine", name: "Network", items: ["portScan", "wakeOnLan"] },
      { kind: "group", id: "long", name: "n".repeat(40), items: [] },
    ]);
    expect(layout.hidden).toEqual(["recordMacro"]);
    const rest = layout.bar.slice(3).map((e) => (e.kind === "action" ? e.id : e.id));
    const expected = TOOLBAR_ACTIONS.filter((a) => !["ssh", "portScan", "wakeOnLan", "recordMacro"].includes(a));
    expect(rest).toEqual(expected);
    expect(cleanToolbarLayout(layout)).toEqual(layout);
  });

  it("moves an action within the bar, into a group, out of it and to hidden", () => {
    let layout = moveAction(DEFAULT_TOOLBAR_LAYOUT, "recordMacro", { zone: "bar", index: 0 });
    expect(ids(layout)[0]).toBe("recordMacro");
    layout = moveAction(layout, "ssh", { zone: "more", index: 0 });
    expect(whereIs(layout, "ssh")).toEqual({ zone: "more", index: 0 });
    expect(ids(layout)).toContain("more[ssh,telnet,mosh,openShared,playRecording]");
    layout = moveAction(layout, "portScan", { zone: "bar", index: 1 });
    expect(ids(layout).slice(0, 2)).toEqual(["recordMacro", "portScan"]);
    layout = moveAction(layout, "telnet", { zone: "hidden", index: 0 });
    expect(layout.hidden).toEqual(["telnet"]);
    layout = moveAction(layout, "telnet", { zone: "bar", index: 99 });
    expect(layout.hidden).toEqual([]);
    expect(ids(layout).slice(-1)[0]).toBe("telnet");
    // Moving to its own place changes nothing.
    expect(moveAction(layout, "telnet", whereIs(layout, "telnet")!)).toEqual(layout);
  });

  it("reorders groups on the bar only", () => {
    const layout = moveGroup(DEFAULT_TOOLBAR_LAYOUT, "tools", 0);
    expect(ids(layout)[0]).toMatch(/^tools\[/);
    expect(moveGroup(layout, "nope", 3)).toBe(layout);
  });

  it("adds, renames and removes groups; a removed group's actions go back where it was", () => {
    let layout = addGroup(DEFAULT_TOOLBAR_LAYOUT, "g1", "Mine");
    expect(layout.bar.slice(-1)[0]).toEqual({ kind: "group", id: "g1", name: "Mine", items: [] });
    layout = renameGroup(layout, "g1", "My remote ");
    expect(layout.bar.slice(-1)[0]).toMatchObject({ name: "My remote " });
    layout = removeGroup(layout, "more");
    expect(ids(layout).slice(3, 8)).toEqual(["serial", "telnet", "mosh", "openShared", "playRecording"]);
    expect(whereIs(layout, "more" as never)).toBeNull();
  });
});
