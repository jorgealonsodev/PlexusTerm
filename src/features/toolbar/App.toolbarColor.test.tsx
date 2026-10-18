// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({ onSession }: { onSession?: (id: number | null) => void }) {
    useEffect(() => onSession?.(1), []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const toolbar = () => document.querySelector<HTMLElement>("header.toolbar")!;
const openMenu = () => fireEvent.contextMenu(toolbar(), { clientX: 40, clientY: 10 });

describe("toolbar colour of this window", () => {
  it("colours the bar from its right-click menu, with readable text, and clears it", async () => {
    render(<App />);
    await screen.findByTestId("terminal");
    expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Red" }));
    expect(toolbar().style.getPropertyValue("--toolbar-bg")).toMatch(/^#[0-9a-f]{6}$/);
    expect(toolbar().style.getPropertyValue("--toolbar-fg")).toMatch(/^#(000000|ffffff)$/);
    expect(toolbar().classList.contains("toolbar--coloured")).toBe(true);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "No colour" }));
    expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("");
    expect(toolbar().classList.contains("toolbar--coloured")).toBe(false);
  });

  it("takes a custom colour, and keeps it in this window only (session storage) across reloads", async () => {
    const { unmount } = render(<App />);
    await screen.findByTestId("terminal");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom colour…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Colour code" }), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("#123456");
    expect(toolbar().style.getPropertyValue("--toolbar-fg")).toBe("#ffffff");
    unmount();
    render(<App />);
    await waitFor(() => expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("#123456"));
    expect(localStorage.length).toBe(0);
  });

  it("does not open the colour menu from the toolbar's buttons", async () => {
    render(<App />);
    await screen.findByTestId("terminal");
    fireEvent.contextMenu(screen.getAllByRole("button")[1], { clientX: 40, clientY: 10 });
    expect(screen.queryByRole("menuitem", { name: "Red" })).toBeNull();
  });
});
