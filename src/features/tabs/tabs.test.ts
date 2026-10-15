import { describe, expect, it } from "vitest";
import type { SessionTarget } from "../sessions/types";
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
