// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { SessionTarget } from "../sessions/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
/** Stands in for xterm: a terminal whose session starts at once. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({ target, onSession }: { target: SessionTarget; onSession?: (id: number | null) => void }) {
    useEffect(() => {
      onSession?.(5);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="terminal" data-target={JSON.stringify(target)} />;
  },
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

const prod = { id: "s1", name: "Prod", folder: "", host: "prod-new.example", port: 22, username: "ops", auth: { method: "agent" } };
const prodTab = { source: { sessionId: "s1" }, layout: { kind: "pane", id: "pane-3" }, focused: "pane-3", panes: {} };
const goneTab = { ...prodTab, source: { sessionId: "deleted" } };
const fishTab = {
  source: { target: { type: "local", program: "/usr/bin/fish" } },
  layout: { kind: "pane", id: "pane-1" },
  focused: "pane-1",
  panes: { "pane-1": { cwd: "/home/me/repo" } },
};
const tabSet = (name: string, tabs: object[]) => ({ name, tabs: { version: 1, active: 0, tabs } });
const tabSetsFile = (...sets: object[]) => JSON.stringify({ version: 1, sets });

function renderApp(tabSets: string | null = null, sessions: object[] = [prod]) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
    if (cmd === "sessions_load") return JSON.stringify({ version: 1, folders: [], sessions });
    if (cmd === "tab_sets_load") return tabSets;
    return cmd.endsWith("_list") ? [] : null;
  });
  render(<App />);
}
const start = async (tabSets: string | null = null, sessions: object[] = [prod]) => {
  renderApp(tabSets, sessions);
  await settle();
  await settle();
};

const targets = () => screen.queryAllByTestId("terminal").map((t) => JSON.parse(t.dataset.target!));
const tabs = () => within(document.querySelector<HTMLElement>(".tabbar")!).getAllByRole("tab");
const savedSets = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "tab_sets_save")
    .map(([, args]) => JSON.parse((args as { contents: string }).contents));
const lastSets = () => savedSets()[savedSets().length - 1].sets;

const openManager = async () => {
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Tab sets…" }));
  return screen.findByRole("dialog", { name: "Tab sets" });
};
const answerPrompt = async (value: string, button: string) => {
  const prompt = await screen.findByRole("dialog", { name: "Tab set name" });
  fireEvent.change(within(prompt).getByRole("textbox"), { target: { value } });
  fireEvent.click(within(prompt).getByRole("button", { name: button }));
  await settle();
};
const openPalette = () => act(() => void fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true }));
const choose = async (query: string) => {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter" });
  await settle();
};

describe("Saving a tab set", () => {
  it("saves the open tabs as tabs.json would, without the password typed for a connection", async () => {
    await start();
    fireEvent.keyDown(window, { key: "S", ctrlKey: true, shiftKey: true });
    fireEvent.change(await screen.findByPlaceholderText("host or user@host:port"), { target: { value: "bob@srv" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2-typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await settle();
    openPalette();
    await choose("save tabs as tab set");
    await answerPrompt("  Producción ", "Save");
    expect(savedSets()).toHaveLength(1);
    expect(JSON.stringify(savedSets())).not.toContain("hunter2-typed");
    const [set] = lastSets();
    expect(set.name).toBe("Producción");
    expect(set.tabs.active).toBe(1);
    expect(set.tabs.tabs.map((t: { source: object }) => t.source)).toEqual([
      { target: { type: "local" } },
      { target: { type: "ssh", host: "srv", port: 22, username: "bob", auth: { method: "password", password: "" } } },
    ]);
  });

  it("asks before replacing a set with the same name", async () => {
    await start(tabSetsFile(tabSet("Prod", [prodTab])));
    const manager = await openManager();
    fireEvent.click(within(manager).getByRole("button", { name: "Save current tabs…" }));
    await answerPrompt("prod", "Save");
    const question = await screen.findByRole("dialog", { name: "Replace the tab set “Prod”?" });
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    await settle();
    expect(savedSets()).toEqual([]);
    fireEvent.click(within(manager).getByRole("button", { name: "Save current tabs…" }));
    await answerPrompt("prod", "Save");
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Replace the tab set “Prod”?" })).getByRole("button", { name: "Replace" }));
    await settle();
    expect(lastSets()).toHaveLength(1);
    expect(lastSets()[0].name).toBe("prod");
    expect(lastSets()[0].tabs.tabs.map((t: { source: object }) => t.source)).toEqual([{ target: { type: "local" } }]);
  });

  it("refuses a name longer than 80 characters", async () => {
    await start();
    openPalette();
    await choose("save tabs as tab set");
    await answerPrompt("n".repeat(81), "Save");
    expect(savedSets()).toEqual([]);
    expect(screen.getByRole("status").textContent).toContain("80");
  });
});

describe("Opening a tab set", () => {
  it("adds its tabs after the open ones and activates the first one added", async () => {
    await start(tabSetsFile(tabSet("Work", [fishTab, prodTab])));
    const manager = await openManager();
    fireEvent.click(within(manager).getByRole("button", { name: "Open the tab set “Work”" }));
    await settle();
    await settle();
    expect(tabs()).toHaveLength(3);
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    // The saved session reconnects with its current version.
    expect(targets()).toEqual([
      { type: "local" },
      { type: "local", program: "/usr/bin/fish", cwd: "/home/me/repo" },
      { type: "ssh", host: "prod-new.example", port: 22, username: "ops", auth: { method: "agent" } },
    ]);
  });

  it("skips a tab whose saved session was deleted", async () => {
    await start(tabSetsFile(tabSet("Work", [goneTab, fishTab])));
    fireEvent.click(within(await openManager()).getByRole("button", { name: "Open the tab set “Work”" }));
    await settle();
    await settle();
    expect(tabs()).toHaveLength(2);
    expect(targets()[1]).toEqual({ type: "local", program: "/usr/bin/fish", cwd: "/home/me/repo" });
  });

  it("says so when every session of the set was deleted", async () => {
    await start(tabSetsFile(tabSet("Gone", [goneTab])));
    fireEvent.click(within(await openManager()).getByRole("button", { name: "Open the tab set “Gone”" }));
    await settle();
    await settle();
    expect(tabs()).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Gone");
  });

  it("brings a DEV tab back in DEV mode", async () => {
    await start(tabSetsFile(tabSet("Dev", [{ ...prodTab, source: { target: { type: "local" } }, dev: { pane: "pane-3" } }])));
    fireEvent.click(within(await openManager()).getByRole("button", { name: "Open the tab set “Dev”" }));
    await settle();
    await settle();
    await settle();
    expect(tabs()).toHaveLength(2);
    expect(screen.getByRole("button", { name: /DEV mode/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("is offered by the command palette, one entry per set", async () => {
    await start(tabSetsFile(tabSet("Work", [fishTab]), tabSet("Prod", [prodTab])));
    openPalette();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "open tab set" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Open tab set: Work"), expect.stringContaining("Open tab set: Prod")]),
    );
    await choose("open tab set: prod");
    await settle();
    expect(tabs()).toHaveLength(2);
    expect(targets()[1]).toEqual({ type: "ssh", host: "prod-new.example", port: 22, username: "ops", auth: { method: "agent" } });
  });
});

describe("Managing tab sets", () => {
  it("renames a set", async () => {
    await start(tabSetsFile(tabSet("Work", [fishTab])));
    const manager = await openManager();
    fireEvent.click(within(manager).getByRole("button", { name: "Rename the tab set “Work”" }));
    const prompt = await screen.findByRole("dialog", { name: "Tab set name" });
    expect(within(prompt).getByRole("textbox")).toHaveProperty("value", "Work");
    await answerPrompt("Project X", "Rename");
    expect(lastSets().map((s: { name: string }) => s.name)).toEqual(["Project X"]);
    expect(lastSets()[0].tabs.tabs).toHaveLength(1);
    expect(within(manager).getByText("Project X")).toBeTruthy();
  });

  it("deletes a set once confirmed", async () => {
    await start(tabSetsFile(tabSet("Work", [fishTab]), tabSet("Prod", [prodTab])));
    const manager = await openManager();
    fireEvent.click(within(manager).getByRole("button", { name: "Delete the tab set “Work”" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await settle();
    expect(savedSets()).toEqual([]);
    fireEvent.click(within(manager).getByRole("button", { name: "Delete the tab set “Work”" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await settle();
    expect(lastSets().map((s: { name: string }) => s.name)).toEqual(["Prod"]);
  });

  it.each([
    ["a bad file", "{not json"],
    ["a foreign file", JSON.stringify({ version: 1, folders: [], sessions: [] })],
  ])("lists no sets with %s", async (_name, file) => {
    await start(file);
    expect(within(await openManager()).getByText("No tab sets yet.")).toBeTruthy();
    expect(tabs()).toHaveLength(1);
  });
});
