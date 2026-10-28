import { describe, expect, it } from "vitest";
import type { SessionTarget } from "../sessions/types";
import { paneIds } from "../panes/paneLayout";
import { initialTabs, tabsReducer, type Tab, type TabsState } from "./tabs";
import {
  parseTabsDocument,
  planRestore,
  sanitizeTarget,
  serializeTabs,
  snapshotTabs,
  type PersistInput,
} from "./tabsPersist";

const local: SessionTarget = { type: "local", program: "/usr/bin/fish", args: ["--login"], cwd: "~" };
const typedSsh: SessionTarget = {
  type: "ssh",
  host: "srv",
  port: 2222,
  username: "bob",
  auth: { method: "password", password: "hunter2-secret" },
  storage: { action: "remember", sessionId: "s1", label: "bob@srv" },
};

/** Two tabs: a local one split in three with a chat and a coloured SSH one, the SSH one active. */
function twoTabs(): TabsState {
  let state = tabsReducer(initialTabs, { type: "open", target: local });
  const first = state.tabs[0].key;
  state = tabsReducer(state, { type: "split", key: first, direction: "row" });
  state = tabsReducer(state, { type: "split", key: first, direction: "column" });
  state = tabsReducer(state, { type: "openChat", key: first, selection: "" });
  state = tabsReducer(state, { type: "open", target: typedSsh, savedId: "s1" });
  state = tabsReducer(state, { type: "setColor", key: state.tabs[1].key, color: "#ff8800" });
  return state;
}

const inputOf = (state: TabsState, extra: Partial<PersistInput> = {}): PersistInput => ({
  tabs: state.tabs,
  activeKey: state.activeKey,
  cwdOf: (pane) => ({ "pane-1": "/home/me/a", "pane-2": "/home/me/b" })[pane] ?? null,
  devOf: () => undefined,
  workspaceOf: () => undefined,
  ...extra,
});

const terminalLayout = (tab: Tab) => paneIds(tab.layout).filter((id) => !tab.chats[id] && !tab.viewers?.[id]);

describe("tabs.json", () => {
  it("never saves a recording player (S6): its tab comes back with its terminals only", () => {
    let state = tabsReducer(initialTabs, { type: "open", target: local });
    state = tabsReducer(state, { type: "openPlayer", key: state.tabs[0].key, path: "/rec/a.cast" });
    const doc = parseTabsDocument(serializeTabs(snapshotTabs(inputOf(state))))!;
    expect(paneIds(doc.tabs[0].layout)).toEqual(["pane-1"]);
    expect(JSON.stringify(doc)).not.toContain("a.cast");
  });

  it("round-trips the tabs, their order, layouts, colours, the active tab, pane folders and DEV mode", () => {
    const state = twoTabs();
    const first = state.tabs[0];
    const json = serializeTabs(
      snapshotTabs(
        inputOf(state, {
          devOf: (key) => (key === first.key ? { pane: "pane-2", folder: "/home/me/repo" } : undefined),
          workspaceOf: (key) => (key === first.key ? ["/home/me/docs"] : undefined),
        }),
      ),
    );
    const doc = parseTabsDocument(json)!;
    expect(doc).not.toBeNull();
    const targets = doc.tabs.map((saved) => ("target" in saved.source ? saved.source.target : typedSsh));
    const plan = planRestore(doc, targets, { nextSeq: 1, nextPaneSeq: 1 });
    const restored = tabsReducer(initialTabs, { type: "restore", tabs: plan.tabs, activeKey: plan.activeKey });

    expect(restored.tabs).toHaveLength(2);
    const [a, b] = restored.tabs;
    // The chat pane is not restored; the three terminals keep their places and ratios.
    expect(paneIds(a.layout)).toHaveLength(3);
    expect(a.layout).toEqual({
      kind: "split",
      id: expect.any(String),
      direction: "row",
      ratio: 0.5,
      a: { kind: "pane", id: "pane-1" },
      b: {
        kind: "split",
        id: expect.any(String),
        direction: "column",
        ratio: 0.5,
        a: { kind: "pane", id: "pane-2" },
        b: { kind: "pane", id: "pane-3" },
      },
    });
    expect(terminalLayout(first)).toHaveLength(3);
    expect(a.chats).toEqual({});
    // The local shell starts in the first pane's folder; the second pane changes to its own.
    expect(a.target).toEqual({ ...local, cwd: "/home/me/a" });
    expect(plan.cwds).toEqual({ "pane-2": "/home/me/b" });
    expect(plan.dev).toEqual([{ key: a.key, pane: "pane-2", folders: ["/home/me/docs"] }]);
    expect(b.savedId).toBe("s1");
    expect(b.color).toBe("#ff8800");
    expect(restored.activeKey).toBe(b.key);
    // New tabs and panes after the restored ones never reuse their ids.
    const more = tabsReducer(restored, { type: "open", target: local });
    expect(new Set(more.tabs.map((t) => t.key)).size).toBe(3);
    expect(paneIds(more.tabs[2].layout)).toEqual(["pane-5"]);
  });

  it("never writes a typed password, a key passphrase or a saved-password action", () => {
    const keyed: SessionTarget = {
      type: "mosh",
      ssh: {
        type: "ssh",
        host: "h",
        port: 22,
        username: "u",
        auth: { method: "key", path: "~/.ssh/id", passphrase: "pass-phrase-secret" },
        jumps: [
          { name: "j", host: "j", port: 22, username: "u", auth: { method: "password", password: "jump-secret" } },
        ],
      },
    };
    let state = tabsReducer(initialTabs, { type: "open", target: typedSsh });
    state = tabsReducer(state, { type: "open", target: keyed });
    const json = serializeTabs(snapshotTabs(inputOf(state)));
    expect(json).not.toContain("hunter2-secret");
    expect(json).not.toContain("pass-phrase-secret");
    expect(json).not.toContain("jump-secret");
    expect(json).not.toContain("remember");
    expect(json).not.toContain("passphrase");
    // What is needed to reconnect stays.
    expect(parseTabsDocument(json)!.tabs.map((t) => t.source)).toEqual([
      { target: { type: "ssh", host: "srv", port: 2222, username: "bob", auth: { method: "password", password: "" } } },
      {
        target: {
          type: "mosh",
          ssh: {
            type: "ssh",
            host: "h",
            port: 22,
            username: "u",
            auth: { method: "key", path: "~/.ssh/id" },
            jumps: [{ name: "j", host: "j", port: 22, username: "u", auth: { method: "password", password: "" } }],
          },
        },
      },
    ]);
  });

  it("keeps only the saved session's id for a tab opened from a saved session", () => {
    const state = tabsReducer(initialTabs, { type: "open", target: typedSsh, savedId: "s1" });
    const json = serializeTabs(snapshotTabs(inputOf(state)));
    expect(parseTabsDocument(json)!.tabs[0].source).toEqual({ sessionId: "s1" });
    expect(json).not.toContain("srv");
  });

  it("drops a tab whose saved session is gone and keeps the others in order", () => {
    let state = tabsReducer(initialTabs, { type: "open", target: typedSsh, savedId: "gone" });
    state = tabsReducer(state, { type: "open", target: local });
    const doc = parseTabsDocument(serializeTabs(snapshotTabs(inputOf(state))))!;
    const plan = planRestore(doc, [null, local], { nextSeq: 1, nextPaneSeq: 1 });
    expect(plan.tabs.map((t) => t.target.type)).toEqual(["local"]);
    expect(plan.activeKey).toBe(plan.tabs[0].key);
  });

  it("does not save shared tabs (their link holds the share's key)", () => {
    const state = tabsReducer(initialTabs, {
      type: "open",
      target: { type: "shared", url: "https://relay/s#key", relayUrl: "wss://relay", relayHost: "relay" },
    });
    expect(snapshotTabs(inputOf(state)).tabs).toEqual([]);
  });

  it.each([
    ["no file", null],
    ["not JSON", "{oops"],
    ["another document", JSON.stringify({ version: 1, folders: [], sessions: [] })],
    ["a newer version", JSON.stringify({ version: 2, active: 0, tabs: [] })],
    [
      "a broken layout",
      JSON.stringify({
        version: 1,
        active: 0,
        tabs: [{ source: { target: { type: "local" } }, layout: { kind: "split", id: "x" }, focused: "p", panes: {} }],
      }),
    ],
    [
      "an unknown target",
      JSON.stringify({
        version: 1,
        active: 0,
        tabs: [{ source: { target: { type: "rdp", host: "x" } }, layout: { kind: "pane", id: "p" }, focused: "p", panes: {} }],
      }),
    ],
  ])("restores nothing from %s", (_name, json) => {
    expect(() => parseTabsDocument(json)).not.toThrow();
    expect(parseTabsDocument(json)?.tabs ?? []).toEqual([]);
  });

  it("reads only the allowed fields of a target", () => {
    expect(
      sanitizeTarget({ type: "telnet", host: "h", port: 23, password: "x", extra: { y: 1 } }),
    ).toEqual({ type: "telnet", host: "h", port: 23 });
    expect(sanitizeTarget({ type: "ssh", host: "h", port: 22, username: "u", auth: { method: "secret" } })).toBeNull();
  });

  it("keeps agent forwarding and the tmux session of an SSH target, and drops an invalid name", () => {
    const ssh = { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "agent" } };
    expect(sanitizeTarget({ ...ssh, forwardAgent: true, tmuxSession: "work" })).toEqual({
      ...ssh,
      forwardAgent: true,
      tmuxSession: "work",
    });
    expect(sanitizeTarget({ ...ssh, forwardAgent: "yes", tmuxSession: "a b" })).toEqual(ssh);
    const mosh = sanitizeTarget({ type: "mosh", ssh: { ...ssh, forwardAgent: true, tmuxSession: "work" } });
    expect(mosh).toEqual({ type: "mosh", ssh: { ...ssh, forwardAgent: true, tmuxSession: "work" } });
  });

  it("keeps the proxy command of an SSH target and drops an invalid one", () => {
    const ssh = { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "agent" } };
    expect(sanitizeTarget({ ...ssh, proxyCommand: "nc %h %p" })).toEqual({ ...ssh, proxyCommand: "nc %h %p" });
    expect(sanitizeTarget({ ...ssh, proxyCommand: "a\nb" })).toEqual(ssh);
    expect(sanitizeTarget({ ...ssh, proxyCommand: "x".repeat(2001) })).toEqual(ssh);
    expect(sanitizeTarget({ ...ssh, proxyCommand: 3 })).toEqual(ssh);
  });
});
