// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import type { Shortcut } from "../panes/shortcuts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** What each terminal's own actions received from the palette. */
const paneRuns = vi.hoisted(() => [] as Shortcut[]);
vi.mock("../terminal/TerminalView", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalView: ({ registerPaneShortcuts }: { registerPaneShortcuts?: (run: (s: Shortcut) => void) => () => void }) => {
      useEffect(() => registerPaneShortcuts?.((shortcut) => paneRuns.push(shortcut)), []);
      return <div data-testid="terminal" />;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  paneRuns.length = 0;
});

const start = async () => {
  render(<App />);
  await act(() => Promise.resolve());
};
const openPalette = () => act(() => void fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true }));
const palette = () => screen.queryByRole("dialog", { name: "Command palette" });
const input = () => screen.getByRole("combobox");
/** Types `query` and picks the first item with Enter; the item runs once the palette is gone. */
const choose = async (query: string) => {
  fireEvent.change(input(), { target: { value: query } });
  fireEvent.keyDown(input(), { key: "Enter" });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

describe("command palette", () => {
  it("opens with Ctrl+Shift+P, lists actions with their shortcuts, and closes with Escape", async () => {
    await start();
    expect(palette()).toBeNull();
    openPalette();
    expect(palette()).toBeTruthy();
    expect(document.activeElement).toBe(input());
    expect(palette()?.textContent).toContain("↑↓ choose · Enter run · Esc close");
    fireEvent.change(input(), { target: { value: "split right" } });
    const option = screen.getByRole("option", { name: /Split right/ });
    expect(option.textContent).toContain("Ctrl+Shift+D");
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(palette()).toBeNull();
  });

  it("runs the chosen action as its keys would: a new terminal tab", async () => {
    await start();
    expect(screen.getAllByTestId("terminal")).toHaveLength(1);
    openPalette();
    await choose("new terminal");
    expect(palette()).toBeNull();
    expect(screen.getAllByTestId("terminal")).toHaveLength(2);
  });

  it("opens Settings at the chosen section", async () => {
    await start();
    openPalette();
    await choose("appearance");
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
  });

  it("hands a terminal's own action to the focused terminal", async () => {
    await start();
    openPalette();
    await choose("find");
    expect(paneRuns).toEqual([{ type: "find" }]);
  });

  it("moves through the list with the arrows and says when nothing matches", async () => {
    await start();
    openPalette();
    fireEvent.change(input(), { target: { value: "tab" } });
    const options = () => screen.getAllByRole("option");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(options()[options().length - 1].getAttribute("aria-selected")).toBe("true");
    fireEvent.change(input(), { target: { value: "zzzz nothing" } });
    expect(screen.getByText("Nothing matches.")).toBeTruthy();
  });
});
