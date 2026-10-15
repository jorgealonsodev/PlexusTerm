import { describe, expect, it } from "vitest";
import type { SessionTarget } from "../sessions/types";
import { paneIds } from "../panes/paneLayout";
import { initialTabs, tabsReducer, type TabsState } from "./tabs";

const open = (state: TabsState, target: SessionTarget = { type: "local" }) =>
  tabsReducer(state, { type: "open", target });

describe("tabsReducer", () => {
  it("opens a tab and makes it active", () => {
    const state = open(initialTabs);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].title).toBe("Local shell");
    expect(state.activeKey).toBe(state.tabs[0].key);
  });

  it("titles SSH tabs user@host, adding the port only when it is not 22", () => {
    const ssh = (port: number): SessionTarget => ({
      type: "ssh",
      host: "srv",
      port,
      username: "bob",
      auth: { method: "agent" },
    });
    const state = open(open(initialTabs, ssh(22)), ssh(2222));
    expect(state.tabs.map((t) => t.title)).toEqual(["bob@srv", "bob@srv:2222"]);
    expect(state.tabs[1].target).toEqual(ssh(2222));
  });

  it("gives every tab a unique key", () => {
    const state = open(open(initialTabs));
    expect(state.tabs[0].key).not.toBe(state.tabs[1].key);
  });

  it("activates a tab by key", () => {
    const two = open(open(initialTabs));
    const state = tabsReducer(two, { type: "activate", key: two.tabs[0].key });
    expect(state.activeKey).toBe(two.tabs[0].key);
  });

  it("closing the active tab activates its right neighbour, else the left one", () => {
    let state = open(open(open(initialTabs)));
    const [a, b, c] = state.tabs;
    state = tabsReducer(state, { type: "activate", key: b.key });
    state = tabsReducer(state, { type: "close", key: b.key });
    expect(state.activeKey).toBe(c.key);
    state = tabsReducer(state, { type: "close", key: c.key });
    expect(state.activeKey).toBe(a.key);
  });

  it("closing an inactive tab keeps the active one", () => {
    const two = open(open(initialTabs));
    const state = tabsReducer(two, { type: "close", key: two.tabs[0].key });
    expect(state.activeKey).toBe(two.tabs[1].key);
  });

  it("closing the last tab leaves no active tab", () => {
    const one = open(initialTabs);
    const state = tabsReducer(one, { type: "close", key: one.tabs[0].key });
    expect(state.tabs).toHaveLength(0);
    expect(state.activeKey).toBeNull();
  });

  it("renames a tab", () => {
    const one = open(initialTabs);
    const state = tabsReducer(one, { type: "rename", key: one.tabs[0].key, title: "vim" });
    expect(state.tabs[0].title).toBe("vim");
  });
});

describe("tabsReducer panes", () => {
  const ids = (state: TabsState, index = 0) => paneIds(state.tabs[index].layout);
  const split = (state: TabsState, direction: "row" | "column" = "row", index = 0) =>
    tabsReducer(state, { type: "split", key: state.tabs[index].key, direction });

  it("opens a tab with one focused pane; pane ids are unique across tabs", () => {
    const state = open(open(initialTabs));
    expect(ids(state, 0)).toHaveLength(1);
    expect(state.tabs[0].focusedPane).toBe(ids(state, 0)[0]);
    expect(ids(state, 0)[0]).not.toBe(ids(state, 1)[0]);
  });

  it("splitting adds a pane after the focused one and focuses it", () => {
    const one = open(initialTabs);
    const [first] = ids(one);
    const state = split(one, "column");
    expect(ids(state)).toHaveLength(2);
    expect(ids(state)[0]).toBe(first);
    expect(state.tabs[0].focusedPane).toBe(ids(state)[1]);
    expect(state.tabs[0].layout).toMatchObject({ kind: "split", direction: "column" });
  });

  it("refuses a fifth pane", () => {
    const four = split(split(split(open(initialTabs))));
    expect(ids(four)).toHaveLength(4);
    expect(split(four)).toBe(four);
  });

  it("closing a pane keeps the tab and focuses a remaining pane", () => {
    const state = split(open(initialTabs));
    const [a, b] = ids(state);
    const closed = tabsReducer(state, { type: "closePane", key: state.tabs[0].key, paneId: b });
    expect(ids(closed)).toEqual([a]);
    expect(closed.tabs[0].focusedPane).toBe(a);
  });

  it("closing an unfocused pane keeps the focus", () => {
    let state = split(split(open(initialTabs)));
    const [a, , c] = ids(state);
    state = tabsReducer(state, { type: "closePane", key: state.tabs[0].key, paneId: a });
    expect(state.tabs[0].focusedPane).toBe(c);
  });

  it("closing the last pane closes the tab", () => {
    const two = open(open(initialTabs));
    const state = tabsReducer(two, { type: "closePane", key: two.tabs[1].key, paneId: ids(two, 1)[0] });
    expect(state.tabs).toHaveLength(1);
    expect(state.activeKey).toBe(two.tabs[0].key);
  });

  it("focuses a pane by id or by direction", () => {
    let state = split(open(initialTabs));
    const key = state.tabs[0].key;
    const [a, b] = ids(state);
    state = tabsReducer(state, { type: "focusPane", key, paneId: a });
    expect(state.tabs[0].focusedPane).toBe(a);
    state = tabsReducer(state, { type: "focusDirection", key, direction: "right" });
    expect(state.tabs[0].focusedPane).toBe(b);
    expect(tabsReducer(state, { type: "focusDirection", key, direction: "right" })).toBe(state);
    expect(tabsReducer(state, { type: "focusPane", key, paneId: "unknown" })).toBe(state);
  });

  it("resizes a split with the ratio clamped", () => {
    const state = split(open(initialTabs));
    const key = state.tabs[0].key;
    const resized = tabsReducer(state, { type: "resizeSplit", key, splitId: state.tabs[0].layout.id, ratio: 0.95 });
    expect(resized.tabs[0].layout).toMatchObject({ kind: "split", ratio: 0.85 });
  });
});
