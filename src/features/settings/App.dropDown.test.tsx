// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

/** What settings.json holds, and what `dropdown_set` answers (a function so a test can make it fail). */
const backend = vi.hoisted(() => ({
  settings: null as string | null,
  dropDown: async (): Promise<unknown> => null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "settings_load") return backend.settings;
    if (cmd === "dropdown_set") return backend.dropDown();
    return null;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  backend.settings = null;
  backend.dropDown = async () => null;
});

const dropDownCalls = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "dropdown_set").map(([, args]) => args);

describe("App drop-down window (S5)", () => {
  it("leaves the window alone while no drop-down shortcut is set", async () => {
    render(<App />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(dropDownCalls()).toEqual([]);
  });

  it("registers the saved shortcut at startup and the new one when Settings change it", async () => {
    backend.settings = JSON.stringify({ dropDownShortcut: "Ctrl+Alt+K", dropDownHeight: 40 });
    render(<App />);
    await waitFor(() => expect(dropDownCalls()).toEqual([{ shortcut: "Ctrl+Alt+K", height: 40 }]));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove the drop-down shortcut" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(dropDownCalls().slice(-1)).toEqual([{ shortcut: "", height: 40 }]));
  });

  it("shows in Settings why the system refused the shortcut", async () => {
    backend.settings = JSON.stringify({ dropDownShortcut: "Ctrl+Alt+K" });
    backend.dropDown = async () => Promise.reject({ kind: "register", detail: "already grabbed" });
    render(<App />);
    await waitFor(() => expect(dropDownCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(await screen.findByText("Could not set the shortcut: already grabbed")).toBeTruthy();
  });
});
