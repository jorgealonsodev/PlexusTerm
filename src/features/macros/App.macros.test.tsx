// @vitest-environment jsdom
import { useEffect, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { serializeMacros, type Macro } from "./macros";
import type { MacroTarget } from "./player";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** What each fake pane's backend received (typed, pasted or played), by pane number. */
const sent: Record<number, string[]> = {};
const notices: string[] = [];
const emitters: Record<number, (text: string) => void> = {};
let nextPane = 1;

interface StubProps {
  onSession?: (id: number | null) => void;
  onInput?: (data: string) => void;
  registerWriter?: (write: (data: string) => void) => () => void;
  registerMacroTarget?: (target: MacroTarget) => () => void;
}

/** Stands in for xterm + backend; its macro target sends through the same path as typing. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({ onSession, onInput, registerWriter, registerMacroTarget }: StubProps) {
    const [id] = useState(() => nextPane++);
    // Like TerminalView, always calls the latest onInput.
    const input = useRef(onInput);
    input.current = onInput;
    useEffect(() => {
      onSession?.(id);
      const listeners = new Set<(text: string) => void>();
      emitters[id] = (text) => listeners.forEach((l) => l(text));
      const typed = (data: string) => {
        (sent[id] ??= []).push(data);
        input.current?.(data);
      };
      const unregisterWriter = registerWriter?.((data) => (sent[id] ??= []).push(data));
      const unregisterMacro = registerMacroTarget?.({
        send: typed,
        subscribe: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        notice: (text) => notices.push(text),
      });
      return () => {
        unregisterWriter?.();
        unregisterMacro?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="terminal">
        <button
          onClick={() => {
            (sent[id] ??= []).push("typed");
            onInput?.("l");
            onInput?.("s");
            onInput?.("\r");
          }}
        >
          type in {id}
        </button>
      </div>
    );
  },
}));

const stored: Macro[] = [
  { id: "m1", name: "Login", hotkey: 2, steps: [{ kind: "send", text: "whoami\\r" }] },
  { id: "m2", name: "Slow", steps: [{ kind: "waitFor", text: "$ ", timeoutSec: 1 }] },
];

beforeEach(() => {
  nextPane = 1;
  notices.length = 0;
  for (const k of Object.keys(sent)) delete sent[Number(k)];
  vi.mocked(invoke).mockImplementation(async (command: string) =>
    command === "macros_load" ? serializeMacros({ version: 1, macros: stored }) : null,
  );
});
afterEach(cleanup);

const key = (k: string, mods: Partial<KeyboardEventInit>) =>
  act(() => {
    fireEvent.keyDown(window, { key: k, ...mods });
  });

async function renderApp() {
  render(<App />);
  // Wait for macros.json to load.
  fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
  await screen.findByText("Login");
}

describe("App macros (S16)", () => {
  it("records typing in the focused pane and saves it under a name (S16.2)", async () => {
    await renderApp();
    key("R", { ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/Everything you type is saved, including passwords/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "type in 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(screen.queryByText(/Everything you type is saved/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "List" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("List")).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("macros_save", expect.anything()));
    const save = vi.mocked(invoke).mock.calls.find(([command]) => command === "macros_save");
    const saved = JSON.parse((save?.[1] as { contents: string }).contents);
    expect(saved.macros[2]).toMatchObject({ name: "List", steps: [{ kind: "send", text: "ls\\r" }] });
  });

  it("plays the hotkey's macro through the input path, multi-execution included (S16.3, S16.4)", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    fireEvent.click(screen.getByRole("button", { name: "Multi-exec" }));
    key("2", { ctrlKey: true, altKey: true });
    await waitFor(() => expect(sent[2]).toEqual(["whoami\r"]));
    // Mirrored to the other pane by multi-execution.
    expect(sent[1]).toEqual(["whoami\r"]);
  });

  it("never plays a macro into an AI chat pane (S9)", async () => {
    await renderApp();
    key(" ", { ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("region", { name: "AI chat" })).toBeTruthy();
    key("2", { ctrlKey: true, altKey: true });
    expect(screen.getByText("No terminal to play the macro in.")).toBeTruthy();
    expect(sent).toEqual({});
  });

  it("shows progress, stops on Escape, and reports a waitFor timeout in the pane (S16.3)", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Play Slow" }));
    expect(screen.getByText(/Running "Slow": step 1 of 1/)).toBeTruthy();
    key("Escape", {});
    await waitFor(() => expect(screen.queryByText(/Running "Slow"/)).toBeNull());
    expect(notices).toEqual([]);

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play Slow" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() =>
      expect(notices).toEqual(['Macro "Slow" stopped at step 1 of 1: "$ " did not appear within 1 s.']),
    );
    expect(screen.queryByText(/Running "Slow"/)).toBeNull();
  });
});
