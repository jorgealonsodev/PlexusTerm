import { describe, expect, it } from "vitest";
import type { SessionTarget } from "../sessions/types";
import { MAX_PANES, paneIds } from "../panes/paneLayout";
import { chatAction, initialTabs, isTerminalPane, tabsReducer, terminalPaneOf, type TabsState } from "./tabs";

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

  it("keeps the same state when a tab is renamed to the title it already has (no re-render)", () => {
    const one = tabsReducer(initialTabs, { type: "open", target: { type: "local" } });
    const renamed = tabsReducer(one, { type: "rename", key: one.tabs[0].key, title: "vim" });
    expect(tabsReducer(renamed, { type: "rename", key: one.tabs[0].key, title: "vim" })).toBe(renamed);
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

  it("closes every tab but one, keeping it active", () => {
    const state = open(open(open(initialTabs)));
    const [a, b, c] = state.tabs.map((t) => t.key);
    const next = tabsReducer(state, { type: "closeOthers", key: b });
    expect(next.tabs.map((t) => t.key)).toEqual([b]);
    expect(next.activeKey).toBe(b);
    expect(tabsReducer(state, { type: "closeOthers", key: "nope" })).toBe(state);
    expect([a, c]).not.toContain(b);
  });

  it("closes the tabs to the right of one, activating it when the active tab closed", () => {
    const state = open(open(open(initialTabs)));
    const [a, b] = state.tabs.map((t) => t.key);
    const next = tabsReducer(state, { type: "closeRight", key: a });
    expect(next.tabs.map((t) => t.key)).toEqual([a]);
    expect(next.activeKey).toBe(a);
    const keepActive = tabsReducer({ ...state, activeKey: a }, { type: "closeRight", key: b });
    expect(keepActive.tabs).toHaveLength(2);
    expect(keepActive.activeKey).toBe(a);
  });

  it("moves a tab to another place, keeping the active one and every tab's panes", () => {
    const state = open(open(open(initialTabs)));
    const [a, b, c] = state.tabs.map((t) => t.key);
    const keys = (next: TabsState) => next.tabs.map((t) => t.key);
    expect(keys(tabsReducer(state, { type: "move", key: a, to: 2 }))).toEqual([b, c, a]);
    expect(keys(tabsReducer(state, { type: "move", key: c, to: 0 }))).toEqual([c, a, b]);
    const moved = tabsReducer(state, { type: "move", key: b, to: 99 });
    expect(keys(moved)).toEqual([a, c, b]);
    expect(moved.activeKey).toBe(state.activeKey);
    expect(moved.tabs.find((t) => t.key === b)).toBe(state.tabs.find((t) => t.key === b));
    // Nothing to move: the same state.
    expect(tabsReducer(state, { type: "move", key: b, to: 1 })).toBe(state);
    expect(tabsReducer(state, { type: "move", key: "nope", to: 0 })).toBe(state);
  });

  it("closes every tab", () => {
    const next = tabsReducer(open(open(initialTabs)), { type: "closeAll" });
    expect(next.tabs).toEqual([]);
    expect(next.activeKey).toBeNull();
  });
});

describe("AI chat panes (S9)", () => {
  const tab = (state: TabsState) => state.tabs[0];
  const openChat = (state: TabsState, selection = "") =>
    tabsReducer(state, { type: "openChat", key: tab(state).key, selection });

  it("splits the focused terminal down with a chat pane linked to it, focused", () => {
    const state = openChat(open(initialTabs), "err");
    const layout = tab(state).layout;
    expect(layout).toMatchObject({ kind: "split", direction: "column", a: { id: "pane-1" }, b: { id: "pane-2" } });
    expect(tab(state).chats).toEqual({ "pane-2": { terminalPaneId: "pane-1", selection: "err" } });
    expect(tab(state).focusedPane).toBe("pane-2");
  });

  it("focuses the existing chat of a terminal instead of opening a second one", () => {
    let state = openChat(open(initialTabs));
    state = tabsReducer(state, { type: "focusPane", key: tab(state).key, paneId: "pane-1" });
    expect(chatAction(tab(state))).toEqual({ kind: "focus", paneId: "pane-2" });
    const again = openChat(state);
    expect(paneIds(tab(again).layout)).toEqual(["pane-1", "pane-2"]);
    expect(tab(again).focusedPane).toBe("pane-2");
  });

  it("from a chat pane, goes back to its terminal", () => {
    const state = openChat(open(initialTabs));
    expect(chatAction(tab(state))).toEqual({ kind: "terminal", paneId: "pane-1" });
    expect(tab(openChat(state)).focusedPane).toBe("pane-1");
  });

  it("does nothing when the tab is full", () => {
    let state = open(initialTabs);
    for (let i = 1; i < MAX_PANES; i++) state = tabsReducer(state, { type: "split", key: tab(state).key, direction: "row" });
    expect(chatAction(tab(state))).toEqual({ kind: "full" });
    expect(openChat(state)).toBe(state);
  });

  it("closing a terminal also closes its chat; closing the chat focuses its terminal", () => {
    let state = tabsReducer(open(initialTabs), { type: "split", key: "tab-1", direction: "row" }); // pane-2
    state = tabsReducer(state, { type: "focusPane", key: "tab-1", paneId: "pane-1" });
    state = openChat(state); // pane-3 under pane-1
    expect(paneIds(tab(state).layout)).toEqual(["pane-1", "pane-3", "pane-2"]);
    const closedChat = tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-3" });
    expect(paneIds(tab(closedChat).layout)).toEqual(["pane-1", "pane-2"]);
    expect(tab(closedChat).chats).toEqual({});
    expect(tab(closedChat).focusedPane).toBe("pane-1");
    const closedTerminal = tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-1" });
    expect(paneIds(tab(closedTerminal).layout)).toEqual(["pane-2"]);
    expect(tab(closedTerminal).chats).toEqual({});
    expect(tab(closedTerminal).focusedPane).toBe("pane-2");
  });

  it("closing the only terminal of a tab with its chat closes the tab", () => {
    const state = openChat(open(initialTabs));
    expect(tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-1" }).tabs).toEqual([]);
  });
});

describe("file viewer panes", () => {
  const tab = (state: TabsState) => state.tabs[0];
  const local = { kind: "local" } as const;
  const view = (state: TabsState, path: string) =>
    tabsReducer(state, { type: "openViewer", key: tab(state).key, path, origin: local });

  it("opens a file at the left of the focused terminal, linked to it and focused", () => {
    const state = view(open(initialTabs), "/p/a.ts");
    expect(tab(state).layout).toMatchObject({ kind: "split", direction: "row", a: { id: "pane-2" }, b: { id: "pane-1" } });
    expect(tab(state).viewers).toEqual({ "pane-2": { terminalPaneId: "pane-1", path: "/p/a.ts", origin: local, opened: 1 } });
    expect(tab(state).focusedPane).toBe("pane-2");
    expect(isTerminalPane(tab(state), "pane-1")).toBe(true);
    expect(isTerminalPane(tab(state), "pane-2")).toBe(false);
    expect(terminalPaneOf(tab(state))).toBe("pane-1");
  });

  it("opens a file at the right of the terminal or below it as asked", () => {
    const at = (position: "right" | "below") =>
      tab(tabsReducer(open(initialTabs), { type: "openViewer", key: "tab-1", path: "/p/a.ts", origin: local, position }));
    expect(at("right").layout).toMatchObject({ kind: "split", direction: "row", a: { id: "pane-1" }, b: { id: "pane-2" } });
    expect(at("below").layout).toMatchObject({ kind: "split", direction: "column", a: { id: "pane-1" }, b: { id: "pane-2" } });
    expect(at("below").focusedPane).toBe("pane-2");
    expect(at("below").viewers!["pane-2"].terminalPaneId).toBe("pane-1");
  });

  it("shows another file of the same terminal in its viewer instead of opening a second one", () => {
    let state = view(open(initialTabs), "/p/a.ts");
    state = view(state, "/p/b.md");
    expect(paneIds(tab(state).layout)).toEqual(["pane-2", "pane-1"]);
    expect(tab(state).viewers!["pane-2"].path).toBe("/p/b.md");
    state = tabsReducer(state, { type: "focusPane", key: "tab-1", paneId: "pane-1" });
    state = view(state, "/p/c.rs");
    expect(paneIds(tab(state).layout)).toEqual(["pane-2", "pane-1"]);
    expect(tab(state).viewers!["pane-2"].path).toBe("/p/c.rs");
    // Every View counts, the same file too: the viewer reads it again.
    expect(tab(view(state, "/p/c.rs")).viewers!["pane-2"].opened).toBe(4);
    expect(tab(state).focusedPane).toBe("pane-2");
  });

  it("does nothing when the tab is full", () => {
    let state = open(initialTabs);
    for (let i = 1; i < MAX_PANES; i++) state = tabsReducer(state, { type: "split", key: tab(state).key, direction: "row" });
    expect(view(state, "/p/a.ts")).toBe(state);
  });

  it("closing a terminal also closes its viewer; closing the viewer focuses its terminal", () => {
    const state = view(tabsReducer(open(initialTabs), { type: "split", key: "tab-1", direction: "row" }), "/p/a.ts");
    // pane-2 (the split) was focused: the viewer (pane-3) opens at its left.
    expect(paneIds(tab(state).layout)).toEqual(["pane-1", "pane-3", "pane-2"]);
    const closedViewer = tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-3" });
    expect(paneIds(tab(closedViewer).layout)).toEqual(["pane-1", "pane-2"]);
    expect(tab(closedViewer).viewers).toEqual({});
    expect(tab(closedViewer).focusedPane).toBe("pane-2");
    const closedTerminal = tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-2" });
    expect(paneIds(tab(closedTerminal).layout)).toEqual(["pane-1"]);
    expect(tab(closedTerminal).viewers).toEqual({});
  });

  it("opens the AI chat of the viewer's terminal from a focused viewer", () => {
    const state = view(open(initialTabs), "/p/a.ts");
    expect(chatAction(tab(state))).toEqual({ kind: "open", terminalPaneId: "pane-1" });
  });
});

describe("recording player (S6)", () => {
  const tab = (state: TabsState) => state.tabs[0];
  const local = { kind: "local" } as const;
  const play = (state: TabsState, path: string) => tabsReducer(state, { type: "openPlayer", key: tab(state).key, path });
  const view = (state: TabsState, path: string) =>
    tabsReducer(state, { type: "openViewer", key: tab(state).key, path, origin: local });

  it("opens a recording at the right of the focused terminal, in a pane linked to it", () => {
    const state = play(open(initialTabs), "/rec/a.cast");
    expect(tab(state).layout).toMatchObject({ kind: "split", direction: "row", a: { id: "pane-1" }, b: { id: "pane-2" } });
    expect(tab(state).viewers).toEqual({
      "pane-2": { terminalPaneId: "pane-1", path: "/rec/a.cast", origin: local, opened: 1, kind: "recording" },
    });
    expect(tab(state).focusedPane).toBe("pane-2");
    expect(isTerminalPane(tab(state), "pane-2")).toBe(false);
    expect(terminalPaneOf(tab(state))).toBe("pane-1");
  });

  it("plays another recording in the same player, and keeps the file viewer apart", () => {
    let state = view(open(initialTabs), "/p/a.ts"); // pane-2, at the left
    state = play(state, "/rec/a.cast"); // pane-3: the viewer is focused, the player goes with its terminal
    expect(tab(state).viewers!["pane-3"]).toMatchObject({ terminalPaneId: "pane-1", kind: "recording" });
    state = play(state, "/rec/b.cast");
    expect(paneIds(tab(state).layout)).toEqual(["pane-2", "pane-1", "pane-3"]);
    expect(tab(state).viewers!["pane-3"]).toMatchObject({ path: "/rec/b.cast", opened: 2 });
    // Viewing a file still uses the file viewer, not the player.
    state = view(state, "/p/b.ts");
    expect(tab(state).viewers!["pane-2"]).toMatchObject({ path: "/p/b.ts" });
    expect(tab(state).viewers!["pane-3"]).toMatchObject({ path: "/rec/b.cast" });
  });

  it("closes with its terminal", () => {
    const state = play(open(initialTabs), "/rec/a.cast");
    const closed = tabsReducer(state, { type: "closePane", key: "tab-1", paneId: "pane-2" });
    expect(tab(closed).focusedPane).toBe("pane-1");
    expect(tab(closed).viewers).toEqual({});
  });
});

describe("tab colours", () => {
  it("colours a tab, clears it, and gives a duplicate the same colour", () => {
    let state = open(initialTabs);
    state = tabsReducer(state, { type: "setColor", key: "tab-1", color: "#c0392b" });
    expect(state.tabs[0].color).toBe("#c0392b");
    state = tabsReducer(state, { type: "duplicate", key: "tab-1" });
    expect(state.tabs[1].color).toBe("#c0392b");
    expect(state.tabs[1].target).toEqual(state.tabs[0].target);
    state = tabsReducer(state, { type: "setColor", key: "tab-1", color: null });
    expect(state.tabs[0].color).toBeUndefined();
    expect(tabsReducer(state, { type: "setColor", key: "nope", color: "#000000" })).toBe(state);
  });
});


describe("restore", () => {
  it("adds restored tabs after the open ones and refuses ids already in use", () => {
    const state = open(initialTabs);
    const restored = { ...state.tabs[0], key: "tab-2", layout: { kind: "pane" as const, id: "pane-2" }, focusedPane: "pane-2" };
    const next = tabsReducer(state, { type: "restore", tabs: [restored], activeKey: "tab-2" });
    expect(next.tabs.map((t) => t.key)).toEqual(["tab-1", "tab-2"]);
    expect(next.activeKey).toBe("tab-2");
    expect(next.nextSeq).toBe(3);
    expect(next.nextPaneSeq).toBe(3);
    expect(tabsReducer(state, { type: "restore", tabs: [state.tabs[0]], activeKey: null })).toBe(state);
  });

  it("keeps the saved session of a duplicated tab", () => {
    const state = tabsReducer(initialTabs, { type: "open", target: { type: "local" }, savedId: "s1" });
    const next = tabsReducer(state, { type: "duplicate", key: state.tabs[0].key });
    expect(next.tabs[1].savedId).toBe("s1");
  });
});
