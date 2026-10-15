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

  it("colours the whole interface with the chosen scheme and swaps the logo for light schemes", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--bg")).toBe("#1e1e2e");
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).not.toContain("light");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "solarized-light" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(root.style.getPropertyValue("--bg")).toBe("#fdf6e3");
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).toContain("light");
  });

  it("shows an icon next to every toolbar action and sidebar tab", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    for (const name of ["Terminal", "SSH", "Serial", "More", "Tools", "Split right", "Split down", "Multi-exec", "Record macro", "Settings"]) {
      expect(screen.getByRole("button", { name }).querySelector("svg"), name).not.toBeNull();
    }
    // Labels can shrink or hide on narrow windows; the tooltip still names the action.
    for (const name of ["Terminal", "SSH", "Serial", "Split right", "Split down", "Multi-exec", "Record macro"]) {
      const button = screen.getByRole("button", { name });
      expect(button.querySelector(".btn__label")?.textContent).toBe(name);
      expect(button.title).toContain(name);
    }
    expect(document.querySelector(".toolbar")?.classList.contains("toolbar--compact")).toBe(false);
    const sidebarTabs = [...document.querySelectorAll(".sidebar__tabs [role=tab]")];
    expect(sidebarTabs.map((t) => t.textContent)).toEqual(["Sessions", "SFTP", "Tunnels", "Macros"]);
    for (const tab of sidebarTabs) expect(tab.querySelector("svg"), tab.textContent!).not.toBeNull();
  });

  it("opens Wake On LAN from the Tools menu", async () => {
    render(<App />);
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Wake On LAN…" }));
    expect(screen.getByRole("dialog", { name: "Wake On LAN" })).toBeTruthy();
  });
});
