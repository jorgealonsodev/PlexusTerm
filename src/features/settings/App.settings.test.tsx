// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Stands in for xterm: shows the font size it was given. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: ({ settings }: { settings?: { fontSize: number } }) => (
    <div data-testid="terminal">font {settings?.fontSize}</div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockClear();
});

const saved = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "settings_save")
    .map(([, args]) => JSON.parse((args as { contents: string }).contents));

describe("App settings (S15.2, S15.6)", () => {
  it("changes the font size of every terminal with Ctrl+= / Ctrl+- / Ctrl+0 and saves it", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    expect(screen.getByTestId("terminal").textContent).toBe("font 14");
    const ctrl = (key: string) => act(() => void fireEvent.keyDown(window, { key, ctrlKey: true }));
    ctrl("=");
    ctrl("=");
    expect(screen.getByTestId("terminal").textContent).toBe("font 16");
    ctrl("-");
    expect(screen.getByTestId("terminal").textContent).toBe("font 15");
    ctrl("0");
    expect(screen.getByTestId("terminal").textContent).toBe("font 14");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(saved().map((s) => s.fontSize)).toEqual([15, 16, 15, 14]);
  });

  it("edits the settings from the toolbar gear", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("Right click pastes"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByTestId("terminal").textContent).toBe("font 20");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(saved().slice(-1)[0]).toMatchObject({ fontSize: 20, rightClickPastes: false });
  });
});
