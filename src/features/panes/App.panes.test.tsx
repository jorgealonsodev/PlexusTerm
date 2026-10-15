// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** What each fake session received from multi-execution, by session id. */
const received: Record<number, string[]> = {};
let nextSession = 1;
let mounts = 0;

interface StubProps {
  focused?: boolean;
  onExit: (code: number | null) => void;
  onSession?: (id: number | null) => void;
  onInput?: (data: string) => void;
  registerWriter?: (write: (data: string) => void) => () => void;
}

/** Stands in for xterm + backend: connects at once and records what it is sent. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({ focused, onExit, onSession, onInput, registerWriter }: StubProps) {
    const [id] = useState(() => nextSession++);
    useEffect(() => {
      mounts += 1;
      onSession?.(id);
      const unregister = registerWriter?.((data) => (received[id] ??= []).push(data));
      return () => unregister?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="terminal" data-focused={focused}>
        <button onClick={() => onInput?.(`typed in ${id}`)}>type in {id}</button>
        <button onClick={() => onExit(0)}>exit {id}</button>
      </div>
    );
  },
}));

const terminals = () => screen.queryAllByTestId("terminal");
const press = (key: string) =>
  act(() => {
    fireEvent.keyDown(window, { key, ctrlKey: true, shiftKey: true });
  });

beforeEach(() => {
  nextSession = 1;
  mounts = 0;
  for (const k of Object.keys(received)) delete received[Number(k)];
});
afterEach(cleanup);

describe("App panes", () => {
  it("splits the tab into a second pane without restarting the first one", async () => {
    render(<App />);
    expect(terminals()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    expect(terminals()).toHaveLength(2);
    press("E");
    expect(terminals()).toHaveLength(3);
    expect(mounts).toBe(3);
    expect(terminals().map((t) => t.dataset.focused)).toEqual(["false", "false", "true"]);
  });

  it("closes only the focused pane, and the tab with its last pane", () => {
    render(<App />);
    press("D");
    expect(terminals()).toHaveLength(2);
    press("W");
    expect(terminals()).toHaveLength(1);
    expect(screen.queryByText("No open sessions.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "exit 1" }));
    expect(terminals()).toHaveLength(0);
    expect(screen.getByText("No open sessions.")).toBeTruthy();
  });

  it("multi-execution mirrors the focused pane to the other panes except excluded ones", () => {
    render(<App />);
    press("D");
    press("D");
    // Typing with multi-execution off stays in its own pane.
    fireEvent.click(screen.getByRole("button", { name: "type in 3" }));
    expect(received).toEqual({});
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Multi-exec" }));
    expect(screen.getByRole("status").textContent).toContain("input goes to 3 terminals");
    const toggles = screen.getAllByRole("button", { name: "Exclude from multi-execution" });
    fireEvent.click(toggles[0]); // pane of session 1
    expect(toggles[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("input goes to 2 terminals");

    fireEvent.click(screen.getByRole("button", { name: "type in 3" }));
    expect(received).toEqual({ 2: ["typed in 3"] });
    // Only the focused pane broadcasts.
    fireEvent.click(screen.getByRole("button", { name: "type in 2" }));
    expect(received).toEqual({ 2: ["typed in 3"] });

    press("M");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "Exclude from multi-execution" })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "type in 3" }));
    expect(received).toEqual({ 2: ["typed in 3"] });
  });
});
