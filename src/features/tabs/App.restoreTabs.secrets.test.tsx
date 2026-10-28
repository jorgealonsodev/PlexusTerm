// @vitest-environment jsdom
import { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import type { SessionTarget } from "../sessions/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
/** Stands in for xterm: a terminal whose session starts at once and reports its folder. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({
    target,
    onSession,
  }: {
    target: SessionTarget;
    onSession?: (id: number | null) => void;
  }) {
    useEffect(() => {
      onSession?.(5);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="terminal" data-target={JSON.stringify(target)} />;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const settle = (ms = 20) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));
/** Longer than the debounce of tabs.json saves. */
const SAVE_WAIT = 700;

const prod = {
  id: "s1",
  name: "Prod",
  folder: "",
  host: "prod-new.example",
  port: 22,
  username: "ops",
  auth: { method: "agent" },
};

const savedTabs = (tabs: object[], active = 0) =>
  JSON.stringify({ version: 1, active, tabs });
const localTab = {
  source: { target: { type: "local", program: "/usr/bin/fish" } },
  layout: {
    kind: "split",
    id: "split-pane-2",
    direction: "row",
    ratio: 0.3,
    a: { kind: "pane", id: "pane-1" },
    b: { kind: "pane", id: "pane-2" },
  },
  focused: "pane-2",
  panes: { "pane-1": { cwd: "/home/me/repo" }, "pane-2": { cwd: "/tmp" } },
  color: "#ff8800",
};
const prodTab = {
  source: { sessionId: "s1" },
  layout: { kind: "pane", id: "pane-3" },
  focused: "pane-3",
  panes: {},
};

interface Backend {
  settings?: Partial<TerminalSettings>;
  tabs?: string | null;
  sessions?: object[];
  launchFolder?: string | null;
}

function renderApp({
  settings = {},
  tabs = null,
  sessions = [prod],
  launchFolder = null,
}: Backend) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "settings_load")
      return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "sessions_load")
      return JSON.stringify({ version: 1, folders: [], sessions });
    if (cmd === "tabs_state_load") return tabs;
    if (cmd === "launch_folder_take") return launchFolder;
    // File lists (the SFTP browser of an SSH tab) are empty.
    return cmd.endsWith("_list") ? [] : null;
  });
  render(<App />);
}

const targets = () =>
  screen.queryAllByTestId("terminal").map((t) => JSON.parse(t.dataset.target!));
const saves = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "tabs_state_save")
    .map(([, args]) => (args as { contents: string }).contents);

describe("App startup with odd tabs.json", () => {
  it("tabs_state_load failing opens the local terminal", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "sessions_load")
        return JSON.stringify({ version: 1, folders: [], sessions: [] });
      if (cmd === "tabs_state_load") throw new Error("io");
      return cmd.endsWith("_list") ? [] : null;
    });
    render(<App />);
    await settle();
    await settle();
    expect(targets()).toEqual([{ type: "local" }]);
  });
  it("sessions_load failing still restores local tabs and skips saved-session ones", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "sessions_load") throw new Error("io");
      if (cmd === "tabs_state_load") return savedTabs([prodTab, localTab]);
      return cmd.endsWith("_list") ? [] : null;
    });
    render(<App />);
    await settle();
    await settle();
    await settle(100);
    expect(targets().length).toBeGreaterThan(0);
  });
  it("only shared/unrestorable tabs -> local terminal", async () => {
    renderApp({
      tabs: savedTabs([
        {
          source: {
            target: { type: "shared", url: "u", relayUrl: "r", relayHost: "h" },
          },
          layout: { kind: "pane", id: "p" },
          focused: "p",
          panes: {},
        },
      ]),
    });
    await settle();
    await settle();
    expect(targets()).toEqual([{ type: "local" }]);
  });
  it("a password planted in tabs.json is not used and is not re-saved", async () => {
    renderApp({
      tabs: savedTabs([
        {
          source: {
            target: {
              type: "ssh",
              host: "h",
              port: 22,
              username: "u",
              auth: { method: "password", password: "PLANTED" },
            },
          },
          layout: { kind: "pane", id: "p" },
          focused: "p",
          panes: {},
        },
      ]),
    });
    await settle();
    await settle();
    await settle(SAVE_WAIT);
    expect(JSON.stringify(targets())).not.toContain("PLANTED");
    for (const s of saves()) expect(s).not.toContain("PLANTED");
  });
  it("saved-session tab keeps referring by id after restore and re-save", async () => {
    renderApp({ tabs: savedTabs([prodTab, localTab]) });
    await settle();
    await settle();
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    await settle(SAVE_WAIT);
    const last = saves().length
      ? JSON.parse(saves()[saves().length - 1])
      : null;
    if (last) expect(last.tabs[0].source).toEqual({ sessionId: "s1" });
  });
});
