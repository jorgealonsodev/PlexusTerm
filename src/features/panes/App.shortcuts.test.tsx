// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";

/** What settings.json holds for the next render. */
const stored = vi.hoisted(() => ({ json: null as string | null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "settings_load" ? stored.json : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

afterEach(() => {
  cleanup();
  stored.json = null;
});

const renderWith = async (shortcuts: Record<string, string>) => {
  stored.json = JSON.stringify({ shortcuts });
  render(<App />);
  await screen.findByTestId("terminal");
};
const terminals = () => screen.queryAllByTestId("terminal").length;
const key = (init: KeyboardEventInit) => act(() => void fireEvent.keyDown(window, init));

describe("customised shortcuts in the app", () => {
  it("opens a terminal on the user's combination, and no longer on the default one", async () => {
    await renderWith({ newTerminal: "Ctrl+Alt+N" });
    expect(terminals()).toBe(1);
    key({ key: "T", ctrlKey: true, shiftKey: true });
    expect(terminals()).toBe(1);
    key({ key: "n", ctrlKey: true, altKey: true });
    expect(terminals()).toBe(2);
    expect(screen.getByRole("button", { name: "Terminal" }).title).toBe("Terminal (Ctrl+Alt+N)");
  });

  it("an action without a default works once bound", async () => {
    await renderWith({ wakeOnLan: "Alt+W" });
    key({ key: "w", altKey: true });
    expect(screen.getByRole("dialog", { name: "Wake On LAN" })).toBeTruthy();
  });

  it("an unbound action does nothing", async () => {
    await renderWith({});
    key({ key: "w", altKey: true });
    expect(screen.queryByRole("dialog", { name: "Wake On LAN" })).toBeNull();
  });

  it("a cleared default stops triggering and leaves the title without a shortcut", async () => {
    await renderWith({ toggleMultiExec: "" });
    key({ key: "M", ctrlKey: true, shiftKey: true });
    const button = screen.getByRole("button", { name: "Multi-exec" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.title).toBe("Multi-exec");
  });

  it("moves between tabs and closes the tab with bound shortcuts", async () => {
    await renderWith({ nextTab: "Ctrl+PageDown", previousTab: "Ctrl+PageUp", closeTab: "Alt+Q" });
    key({ key: "T", ctrlKey: true, shiftKey: true });
    const selected = () => screen.getAllByRole("tab").filter((t) => t.getAttribute("aria-selected") === "true");
    const before = selected();
    key({ key: "PageDown", ctrlKey: true });
    expect(selected()).not.toEqual(before);
    key({ key: "PageUp", ctrlKey: true });
    expect(selected()).toEqual(before);
    key({ key: "q", altKey: true });
    expect(terminals()).toBe(1);
  });

  it("shows the effective shortcut in the pane close button and the toolbar", async () => {
    await renderWith({ closePane: "Alt+X", toggleSidebar: "Alt+B" });
    key({ key: "D", ctrlKey: true, shiftKey: true });
    fireEvent.mouseEnter(document.querySelector(".pane__corner")!);
    expect(screen.getAllByRole("button", { name: "Close pane" })[0].title).toBe("Close pane (Alt+X closes the focused one)");
    expect(screen.getByRole("button", { name: "Hide sidebar" }).title).toBe("Hide sidebar (Alt+B)");
  });
});
