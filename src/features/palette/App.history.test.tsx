// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { AssistTarget } from "../terminal/TerminalView";

/** The history file: two commands run in local terminals, the newer last. */
const HISTORY = JSON.stringify({
  version: 1,
  hosts: {
    local: [
      { command: "ls -la", count: 1, last: 1 },
      { command: "git status", count: 2, last: 2 },
    ],
  },
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => (command === "history_load" ? HISTORY : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** What was typed into the terminal, and whether it got the focus. */
const typed = vi.hoisted(() => ({ text: [] as string[], focused: 0 }));
vi.mock("../terminal/TerminalView", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalView: ({ registerAssistTarget }: { registerAssistTarget?: (target: AssistTarget) => () => void }) => {
      useEffect(
        () =>
          registerAssistTarget?.({
            selection: () => "",
            focus: () => void typed.focused++,
            insert: (text: string) => void typed.text.push(text),
            run: () => true,
          } as AssistTarget),
        [],
      );
      return <div data-testid="terminal" />;
    },
  };
});

afterEach(() => cleanup());

describe("command history search", () => {
  it("opens with Ctrl+Shift+H, lists the terminal's commands newest first, and types the chosen one without running it", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    await act(async () => {
      fireEvent.keyDown(window, { key: "H", ctrlKey: true, shiftKey: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const dialog = screen.getByRole("dialog", { name: "Command history" });
    expect(dialog).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.querySelector(".palette__label")?.textContent)).toEqual(["git status", "ls -la"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ls" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByRole("dialog", { name: "Command history" })).toBeNull();
    expect(typed.text).toEqual(["ls -la"]);
    expect(typed.focused).toBeGreaterThan(0);
  });
});
