import { describe, expect, it } from "vitest";
import { initialTabs, tabsReducer, type TabsState } from "./tabs";

const open = (state: TabsState, title = "Local shell") =>
  tabsReducer(state, { type: "open", title });

describe("tabsReducer", () => {
  it("opens a tab and makes it active", () => {
    const state = open(initialTabs);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].title).toBe("Local shell");
    expect(state.activeKey).toBe(state.tabs[0].key);
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
