// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { FindTarget } from "./findAll";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** The buffer each new terminal shows, in the order they open, and what was revealed in each. */
const buffers = vi.hoisted(() => [
  ["make build", "error: missing header"],
  ["all good", "  ERROR again"],
]);
const reveals = vi.hoisted(() => [] as { terminal: number; row: number; column: number; length: number }[]);
const opened = vi.hoisted(() => ({ count: 0 }));
vi.mock("../terminal/TerminalView", async () => {
  const { useEffect, useState } = await import("react");
  return {
    TerminalView: ({ active, registerFindTarget }: { active: boolean; registerFindTarget?: (target: FindTarget) => () => void }) => {
      const [terminal] = useState(() => opened.count++);
      useEffect(
        () =>
          registerFindTarget?.({
            rows: () => (buffers[terminal] ?? []).map((text) => ({ text, wrapped: false })),
            reveal: (row, column, length) => void reveals.push({ terminal, row, column, length }),
          }),
        [],
      );
      return <div data-testid="terminal" data-active={String(active)} />;
    },
  };
});

afterEach(() => {
  cleanup();
  reveals.length = 0;
  opened.count = 0;
});

const start = async () => {
  render(<App />);
  await act(() => Promise.resolve());
};
const keys = (key: string) => act(() => void fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true }));
const dialog = () => screen.queryByRole("dialog", { name: "Find in all tabs" });
const input = () => screen.getByRole("combobox");
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const type = async (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  await wait(200);
};

describe("Find in all tabs (S3)", () => {
  it("opens with Ctrl+Shift+G and lists the matches of every tab's terminal", async () => {
    await start();
    keys("T");
    expect(screen.getAllByTestId("terminal")).toHaveLength(2);
    keys("G");
    expect(dialog()).toBeTruthy();
    await type("error");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["error: missing header", "  ERROR again"]);
    expect(screen.getAllByRole("group")).toHaveLength(2);
  });

  it("jumps to the chosen match: its tab comes to the front and the match is selected", async () => {
    await start();
    keys("T");
    const terminals = () => screen.getAllByTestId("terminal").map((el) => el.dataset.active);
    // The tab opened last is the active one.
    expect(terminals()).toEqual(["false", "true"]);
    keys("G");
    await type("error");
    fireEvent.keyDown(input(), { key: "Enter" });
    await wait(10);
    expect(dialog()).toBeNull();
    expect(terminals()).toEqual(["true", "false"]);
    expect(reveals).toEqual([{ terminal: 0, row: 1, column: 0, length: 5 }]);
  });

  it("is in the command palette", async () => {
    await start();
    keys("P");
    fireEvent.change(input(), { target: { value: "find in all" } });
    const option = screen.getByRole("option", { name: /Find in all tabs/ });
    expect(option.textContent).toContain("Ctrl+Shift+G");
    fireEvent.keyDown(input(), { key: "Enter" });
    await wait(10);
    expect(dialog()).toBeTruthy();
  });

  it("leaves the find bar of the focused terminal on Ctrl+Shift+F", async () => {
    await start();
    keys("F");
    expect(dialog()).toBeNull();
  });
});
