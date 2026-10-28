// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import type { SessionTarget } from "../sessions/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
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

const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
/** Longer than the debounce of tabs.json saves. */
const SAVE_WAIT = 700;

const prod = { id: "s1", name: "Prod", folder: "", host: "prod-new.example", port: 22, username: "ops", auth: { method: "agent" } };

const savedTabs = (tabs: object[], active = 0) => JSON.stringify({ version: 1, active, tabs });
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
const prodTab = { source: { sessionId: "s1" }, layout: { kind: "pane", id: "pane-3" }, focused: "pane-3", panes: {} };

interface Backend {
  settings?: Partial<TerminalSettings>;
  tabs?: string | null;
  sessions?: object[];
  launchFolder?: string | null;
}

function renderApp({ settings = {}, tabs = null, sessions = [prod], launchFolder = null }: Backend) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "sessions_load") return JSON.stringify({ version: 1, folders: [], sessions });
    if (cmd === "tabs_state_load") return tabs;
    if (cmd === "launch_folder_take") return launchFolder;
    // File lists (the SFTP browser of an SSH tab) are empty.
    return cmd.endsWith("_list") ? [] : null;
  });
  render(<App />);
}

const targets = () => screen.queryAllByTestId("terminal").map((t) => JSON.parse(t.dataset.target!));
const tabBar = () => document.querySelector<HTMLElement>(".tabbar")!;
const tabs = () => within(tabBar()).getAllByRole("tab");
const saves = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "tabs_state_save")
    .map(([, args]) => (args as { contents: string }).contents);

describe("Restoring tabs at startup", () => {
  it("reopens the saved tabs in order, with their layout, colour, folders and the active tab", async () => {
    renderApp({ tabs: savedTabs([localTab, prodTab], 1) });
    await settle();
    await settle();
    expect(tabs()).toHaveLength(2);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    // The saved session reconnects with its current version, not the one it was saved with.
    expect(targets()).toEqual([
      { type: "local", program: "/usr/bin/fish", cwd: "/home/me/repo" },
      { type: "local", program: "/usr/bin/fish", cwd: "/home/me/repo" },
      { type: "ssh", host: "prod-new.example", port: 22, username: "ops", auth: { method: "agent" } },
    ]);
  });

  it("skips a tab whose saved session was deleted", async () => {
    renderApp({ tabs: savedTabs([prodTab, localTab], 0), sessions: [] });
    await settle();
    await settle();
    expect(tabs()).toHaveLength(1);
    expect(targets().map((t) => t.type)).toEqual(["local", "local"]);
  });

  it("brings a DEV tab back in DEV mode", async () => {
    renderApp({ tabs: savedTabs([{ ...prodTab, source: { target: { type: "local" } }, dev: { pane: "pane-3" } }]) });
    await settle();
    await settle();
    await settle();
    expect(screen.getByRole("button", { name: /DEV mode/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it.each([
    ["no file", null],
    ["a bad file", "{not json"],
    ["a foreign file", JSON.stringify({ version: 1, folders: [], sessions: [] })],
  ])("opens the usual local terminal with %s", async (_name, tabs) => {
    renderApp({ tabs });
    await settle();
    await settle();
    expect(targets()).toEqual([{ type: "local" }]);
  });

  it("opens the usual local terminal when the setting is off, and saves nothing", async () => {
    renderApp({ settings: { restoreTabs: false }, tabs: savedTabs([localTab, prodTab]) });
    await settle();
    await settle(SAVE_WAIT);
    expect(targets()).toEqual([{ type: "local" }]);
    expect(saves()).toEqual([]);
  });

  it("opens only the folder PlexusTerm was launched with", async () => {
    renderApp({ tabs: savedTabs([localTab, prodTab]), launchFolder: "/srv/project" });
    await settle();
    await settle();
    expect(targets()).toEqual([{ type: "local", cwd: "/srv/project" }]);
    // That window's tabs never replace the saved ones.
    await settle(SAVE_WAIT);
    expect(saves()).toEqual([]);
  });
});

describe("Saving tabs", () => {
  it("never saves before the startup restore, so the file is not replaced by an empty list", async () => {
    let answer!: (json: string) => void;
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "sessions_load") return JSON.stringify({ version: 1, folders: [], sessions: [prod] });
      if (cmd === "tabs_state_load") return new Promise<string>((resolve) => (answer = resolve));
      return cmd.endsWith("_list") ? [] : null;
    });
    render(<App />);
    await settle(SAVE_WAIT);
    expect(saves()).toEqual([]);
    await act(async () => answer(savedTabs([prodTab])));
    await settle(SAVE_WAIT);
    const last = JSON.parse(saves()[saves().length - 1]);
    expect(last.tabs.map((t: { source: object }) => t.source)).toEqual([{ sessionId: "s1" }]);
  });

  it("saves the tabs after a change, without the password typed for a connection", async () => {
    renderApp({});
    await settle();
    await settle();
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    fireEvent.change(await screen.findByPlaceholderText("host or user@host:port"), { target: { value: "bob@srv" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await settle(SAVE_WAIT);
    // The typed password reached the terminal...
    expect(JSON.stringify(targets())).toContain("hunter2-typed");
    // ...but never tabs.json.
    expect(saves().length).toBeGreaterThan(0);
    for (const contents of saves()) expect(contents).not.toContain("hunter2-typed");
    const last = JSON.parse(saves()[saves().length - 1]);
    expect(last.active).toBe(1);
    expect(last.tabs.map((t: { source: object }) => t.source)).toEqual([
      { target: { type: "local" } },
      { target: { type: "ssh", host: "srv", port: 22, username: "bob", auth: { method: "password", password: "" } } },
    ]);
  });
});
