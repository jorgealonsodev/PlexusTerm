// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import App from "../../App";

const CAST = '{"version":2,"width":80,"height":24,"timestamp":1700000000}\n[1, "o", "hi"]\n';

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "read_recording_file" ? CAST : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    unicode = { activeVersion: "6" };
    loadAddon() {}
    open() {}
    write() {}
    resize() {}
    reset() {}
    dispose() {}
  },
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
  vi.mocked(open).mockReset();
});

const start = async () => {
  render(<App />);
  await act(() => Promise.resolve());
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const playerOpened = async () => {
  await settle();
  await settle();
  expect(vi.mocked(open).mock.calls[0][0]).toMatchObject({ filters: [{ name: "asciicast", extensions: ["cast"] }] });
  expect(invoke).toHaveBeenCalledWith("read_recording_file", { path: "/rec/demo.cast" });
  expect(screen.getByRole("heading", { name: "demo.cast" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  // Next to the terminal, which stays.
  expect(screen.getAllByTestId("terminal")).toHaveLength(1);
};

describe("Play recording… (S6)", () => {
  it("opens a .cast file from the More menu in a player next to the terminal", async () => {
    vi.mocked(open).mockResolvedValueOnce("/rec/demo.cast");
    await start();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play recording…" }));
    await playerOpened();
    fireEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(screen.queryByRole("heading", { name: "demo.cast" })).toBeNull();
  });

  it("opens one from the command palette", async () => {
    vi.mocked(open).mockResolvedValueOnce("/rec/demo.cast");
    await start();
    act(() => void fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "play recording" } });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    await playerOpened();
  });

  it("opens nothing when the file dialog is cancelled", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await start();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Play recording…" }));
    await settle();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("read_recording_file", expect.anything());
  });
});
