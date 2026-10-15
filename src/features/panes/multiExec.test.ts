import { describe, expect, it, vi } from "vitest";
import { broadcastTargets, createWriterRegistry, multiExecGroup, type PaneInfo } from "./multiExec";

const panes: PaneInfo[] = [
  { id: "a", sessionId: 1, excluded: false },
  { id: "b", sessionId: 2, excluded: false },
  { id: "c", sessionId: null, excluded: false }, // still connecting
  { id: "d", sessionId: 4, excluded: true },
  { id: "e", sessionId: 5, excluded: false },
];

describe("multiExecGroup", () => {
  it("contains the connected panes that are not excluded", () => {
    expect(multiExecGroup(panes)).toEqual(["a", "b", "e"]);
  });
});

describe("broadcastTargets", () => {
  it("sends to every other connected, non-excluded pane", () => {
    expect(broadcastTargets(panes, "a")).toEqual(["b", "e"]);
  });

  it("sends nothing from an excluded or unknown pane", () => {
    expect(broadcastTargets(panes, "d")).toEqual([]);
    expect(broadcastTargets(panes, "zz")).toEqual([]);
  });
});

describe("createWriterRegistry", () => {
  it("writes to the registered panes only", () => {
    const registry = createWriterRegistry();
    const a = vi.fn();
    const b = vi.fn();
    registry.register("a", a);
    registry.register("b", b);
    registry.write(["b", "missing"], "ls\r");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith("ls\r");
  });

  it("unregistering an old writer keeps a newer one for the same pane", () => {
    const registry = createWriterRegistry();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registry.register("a", first);
    const unregisterSecond = registry.register("a", second);
    unregisterFirst();
    registry.write(["a"], "x");
    expect(second).toHaveBeenCalledWith("x");
    unregisterSecond();
    registry.write(["a"], "y");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
