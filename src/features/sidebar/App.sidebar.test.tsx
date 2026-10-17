// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const saved = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "settings_save")
    .map(([, args]) => JSON.parse((args as { contents: string }).contents));

async function renderApp(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "settings_load" ? JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }) : null,
  );
  render(<App />);
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
}

const ctrlShiftB = () => act(() => void fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true }));
const sidebar = () => document.querySelector<HTMLElement>("aside.sidebar");
const sessionsPanelShown = () => screen.queryByText("Saved sessions") !== null;
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("Collapsible sidebar", () => {
  it("Ctrl+Shift+B folds the sidebar to its tab icons and opens it again, remembering it", async () => {
    await renderApp();
    expect(sessionsPanelShown()).toBe(true);
    ctrlShiftB();
    expect(sessionsPanelShown()).toBe(false);
    expect(sidebar()?.classList.contains("sidebar--collapsed")).toBe(true);
    for (const name of ["Sessions", "SFTP", "Tunnels", "Macros"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }
    ctrlShiftB();
    expect(sessionsPanelShown()).toBe(true);
    await flush();
    expect(saved().map((s) => s.sidebarCollapsed)).toEqual([true, false]);
  });

  it("folds from the toolbar, and a tab icon opens the sidebar on that tab", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(sessionsPanelShown()).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
    expect(sidebar()?.classList.contains("sidebar--collapsed")).toBe(false);
    expect(screen.getByRole("tab", { name: "Macros" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
  });

  it("starts folded when it was folded last time", async () => {
    await renderApp({ sidebarCollapsed: true });
    expect(sessionsPanelShown()).toBe(false);
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
  });

  it("hides completely when folded if Settings say so, and comes back with Ctrl+Shift+B", async () => {
    await renderApp({ sidebarHideWhenCollapsed: true });
    ctrlShiftB();
    expect(sidebar()).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Sidebar" })).toBeNull();
    ctrlShiftB();
    expect(sessionsPanelShown()).toBe(true);
  });

  it("saves the 'hide completely' choice from Settings > Appearance", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByLabelText("Hide the sidebar completely when folded"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(saved().slice(-1)[0]).toMatchObject({ sidebarHideWhenCollapsed: true, sidebarCollapsed: false });
  });
});

describe("Resizable sidebar", () => {
  const handle = () => screen.getByRole("separator", { name: "Resize sidebar" });

  it("drags its edge to a new width, within 160..640 px, and remembers it when the drag ends", async () => {
    await renderApp();
    expect(sidebar()?.style.width).toBe("");
    fireEvent.pointerDown(handle(), { pointerId: 1, clientX: 240 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 320 });
    expect(sidebar()?.style.width).toBe("320px");
    await flush();
    expect(saved()).toEqual([]);
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 2000 });
    expect(sidebar()?.style.width).toBe("640px");
    fireEvent.pointerUp(handle(), { pointerId: 1, clientX: 2000 });
    fireEvent.pointerMove(handle(), { pointerId: 1, clientX: 100 });
    expect(sidebar()?.style.width).toBe("640px");
    await flush();
    expect(saved().map((s) => s.sidebarWidth)).toEqual([640]);
  });

  it("starts with the remembered width; a double-click on the edge goes back to the default width", async () => {
    await renderApp({ sidebarWidth: 400 });
    expect(sidebar()?.style.width).toBe("400px");
    fireEvent.doubleClick(handle());
    expect(sidebar()?.style.width).toBe("");
    await flush();
    expect(saved().map((s) => s.sidebarWidth)).toEqual([null]);
  });

  it("keeps following the pointer when it leaves the handle, and blocks text selection while dragging", async () => {
    await renderApp();
    fireEvent.pointerDown(handle(), { pointerId: 1, clientX: 240 });
    expect(document.body.classList.contains("is-resizing")).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 450 });
    expect(sidebar()?.style.width).toBe("450px");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 450 });
    expect(document.body.classList.contains("is-resizing")).toBe(false);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300 });
    expect(sidebar()?.style.width).toBe("450px");
    await flush();
    expect(saved().map((s) => s.sidebarWidth)).toEqual([450]);
  });

  it("has no resize handle while folded", async () => {
    await renderApp({ sidebarCollapsed: true });
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).toBeNull();
  });
});
