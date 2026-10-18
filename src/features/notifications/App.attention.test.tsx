// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const system = vi.hoisted(() => ({ showSystemNotification: vi.fn(async () => {}) }));
vi.mock("./systemNotification", () => system);

interface Notice {
  title: string | null;
  body: string | null;
}

/** Stands in for xterm: a button per pane asks for attention like a bell or an OSC 9 would. */
vi.mock("../terminal/TerminalView", () => {
  let next = 1;
  return {
    TerminalView: function StubTerminal({ onAttention }: { onAttention?: (notice: Notice) => void }) {
      const [id] = useState(() => next++);
      return (
        <div data-testid="terminal">
          <button onClick={() => onAttention?.({ title: null, body: null })}>bell {id}</button>
          <button onClick={() => onAttention?.({ title: null, body: "Claude is waiting for your input" })}>
            osc {id}
          </button>
        </div>
      );
    },
  };
});

let windowFocused = true;
beforeEach(() => {
  windowFocused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => windowFocused);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockImplementation(async () => null);
  system.showSystemNotification.mockClear();
});

const tab = () => document.querySelector<HTMLElement>(".tabbar [role=tab]")!;
/** The title the tab bar shows, which a notification without a title of its own uses. */
const tabName = () => tab().querySelector(".tab__title")!.textContent;
const tabMarked = () => within(tab()).queryByRole("img", { name: "Needs attention" }) !== null;
const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
const paneMarked = (index: number) => panes()[index].querySelector(".pane__attention") !== null;

const renderApp = async () => {
  render(<App />);
  await screen.findAllByTestId("terminal");
};

/** Two panes; the second (right) one has the focus. */
const renderSplit = async () => {
  await renderApp();
  fireEvent.click(screen.getByRole("button", { name: "Split right" }));
  expect(screen.getAllByTestId("terminal")).toHaveLength(2);
};

const ask = (button: HTMLElement) => act(() => void fireEvent.click(button));

describe("attention requests", () => {
  it("marks the tab and the pane that rang while another pane has the focus, until that pane is focused", async () => {
    await renderSplit();
    const [first] = screen.getAllByTestId("terminal");
    ask(within(first).getByRole("button", { name: /^bell/ }));
    expect(tabMarked()).toBe(true);
    expect(paneMarked(0)).toBe(true);
    expect(paneMarked(1)).toBe(false);
    // The window has the focus: no desktop notification.
    expect(system.showSystemNotification).not.toHaveBeenCalled();
    act(() => void fireEvent.mouseDown(panes()[0]));
    expect(tabMarked()).toBe(false);
    expect(paneMarked(0)).toBe(false);
  });

  it("never marks the pane being looked at: a bell while typing there raises nothing", async () => {
    await renderApp();
    ask(screen.getByRole("button", { name: /^bell/ }));
    expect(tabMarked()).toBe(false);
    expect(system.showSystemNotification).not.toHaveBeenCalled();
  });

  it("shows a desktop notification with the message while the window is in the background, and clears on return", async () => {
    await renderApp();
    windowFocused = false;
    act(() => void window.dispatchEvent(new Event("blur")));
    ask(screen.getByRole("button", { name: /^osc/ }));
    expect(tabMarked()).toBe(true);
    // A single pane is not marked on its own: the tab says it.
    expect(document.querySelector(".pane__attention")).toBeNull();
    expect(system.showSystemNotification).toHaveBeenCalledWith(tabName(), "Claude is waiting for your input");
    // A bell has no message: the tab's title says where.
    ask(screen.getByRole("button", { name: /^bell/ }));
    windowFocused = true;
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(tabMarked()).toBe(false);
  });

  it("names the tab when a bell rings in the background, and lets a flood through once", async () => {
    await renderApp();
    windowFocused = false;
    const bell = screen.getByRole("button", { name: /^bell/ });
    for (let i = 0; i < 20; i++) ask(bell);
    expect(system.showSystemNotification).toHaveBeenCalledTimes(1);
    expect(system.showSystemNotification).toHaveBeenCalledWith(tabName(), "Needs your attention");
  });

  it("keeps the tab mark but sends no desktop notification when they are turned off", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) =>
      cmd === "settings_load" ? JSON.stringify({ attentionNotifications: false }) : null,
    );
    await renderApp();
    windowFocused = false;
    ask(screen.getByRole("button", { name: /^osc/ }));
    expect(tabMarked()).toBe(true);
    expect(system.showSystemNotification).not.toHaveBeenCalled();
  });
});
