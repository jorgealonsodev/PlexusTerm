// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { Adoption, PaneDetach } from "../terminal/TerminalView";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Each pane's detach (what the tab menu calls) and what each pane adopted, by mount order. */
const panes = vi.hoisted(() => ({ undo: vi.fn(), adopted: [] as (Adoption | undefined)[], live: true }));
/** Stands in for xterm: connected at once as session 5 (tap 50), showing "screen of 5". */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({
    onSession,
    adopt,
    registerDetach,
  }: {
    onSession?: (id: number | null) => void;
    adopt?: Adoption;
    registerDetach?: (detach: PaneDetach) => () => void;
  }) {
    useEffect(() => {
      panes.adopted.push(adopt);
      onSession?.(adopt?.sessionId ?? 5);
      return registerDetach?.(async () =>
        panes.live ? { adoption: { sessionId: 5, tap: 50, content: "screen of 5" }, undo: panes.undo } : null,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  cleanup();
  panes.undo.mockReset();
  panes.adopted = [];
  panes.live = true;
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

/** The first tab of the tab bar (the sidebar has tabs too). */
const tabOf = () => document.querySelector<HTMLElement>(".tabbar [role=tab]")!;
const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

function renderApp(commands: Record<string, (args?: unknown) => unknown> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in commands) return commands[cmd](args);
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, restoreTabs: true });
    if (cmd === "sessions_load") return JSON.stringify({ version: 1, folders: [], sessions: [] });
    return cmd.endsWith("_list") ? [] : null;
  });
  render(<App />);
}

const openInNewWindow = async () => {
  fireEvent.contextMenu(tabOf(), { clientX: 5, clientY: 5 });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Open in new window" }));
  await settle();
};
const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

describe("Open in new window", () => {
  it("hands the tab and its running sessions to a new window and takes the tab out of this one", async () => {
    renderApp();
    await screen.findByTestId("terminal");
    await settle();
    await openInNewWindow();
    const [[, args]] = calls("window_open_tab");
    const { handoff, title } = args as { handoff: string; title: string };
    const moved = JSON.parse(handoff);
    expect(moved.doc.tabs).toHaveLength(1);
    expect(moved.doc.tabs[0].layout).toEqual({ kind: "pane", id: "pane-1" });
    expect(moved.panes).toEqual({ "pane-1": { sessionId: 5, tap: 50, content: "screen of 5" } });
    expect(moved.title).toBe(title);
    expect(screen.queryByTestId("terminal")).toBeNull();
    expect(screen.getByText("No open sessions.")).toBeTruthy();
    expect(panes.undo).not.toHaveBeenCalled();
  });

  it("keeps the tab, gives its panes their sessions back and says why when the window cannot open", async () => {
    renderApp({
      window_open_tab: () => {
        throw "no display";
      },
    });
    await screen.findByTestId("terminal");
    await settle();
    await openInNewWindow();
    expect(panes.undo).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("terminal")).toBeTruthy();
    expect(await screen.findByText("Could not open the tab in a new window: no display")).toBeTruthy();
  });

  it("opens the moved tab in the new window with its sessions, never reading or writing tabs.json, and closes with its last tab", async () => {
    const doc = {
      version: 1,
      active: 0,
      tabs: [{ source: { target: { type: "local" } }, layout: { kind: "pane", id: "pane-7" }, focused: "pane-7", panes: { "pane-7": { cwd: "/srv" } } }],
    };
    const adoption = { sessionId: 9, tap: 90, content: "old screen" };
    renderApp({ window_handoff_take: () => JSON.stringify({ doc, panes: { "pane-7": adoption }, title: "build" }) });
    await screen.findByTestId("terminal");
    await settle(800);
    expect(panes.adopted).toEqual([adoption]);
    expect(tabOf().textContent).toContain("build");
    expect(calls("tabs_state_load")).toHaveLength(0);
    expect(calls("tabs_state_save")).toHaveLength(0);
    // The shell is in its folder already: nothing is typed into it.
    expect(calls("pty_write")).toHaveLength(0);
    fireEvent.contextMenu(tabOf(), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Close tab" }));
    await settle();
    expect(calls("window_close_self")).toHaveLength(1);
  });

  it("closes the moved tab's window by closing its tabs first when it is asked to close", async () => {
    let onClose: (() => void) | null = null;
    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockImplementation(async (event: string, handler: unknown) => {
      if (event === "moved-window-close-requested") onClose = handler as () => void;
      return () => {};
    });
    const doc = {
      version: 1,
      active: 0,
      tabs: [{ source: { target: { type: "local" } }, layout: { kind: "pane", id: "pane-7" }, focused: "pane-7", panes: {} }],
    };
    renderApp({ window_handoff_take: () => JSON.stringify({ doc, panes: {}, title: null }) });
    await screen.findByTestId("terminal");
    await settle();
    await act(async () => onClose!());
    await settle();
    expect(screen.queryByTestId("terminal")).toBeNull();
    expect(calls("window_close_self")).toHaveLength(1);
  });

  it("the main window never closes itself when its last tab closes", async () => {
    renderApp();
    await screen.findByTestId("terminal");
    fireEvent.contextMenu(tabOf(), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Close tab" }));
    await settle();
    expect(calls("window_close_self")).toHaveLength(0);
  });
});
