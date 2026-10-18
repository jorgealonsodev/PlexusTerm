// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Stands in for xterm: a local shell in /home/me/repo that reports its folder (OSC 7). */
vi.mock("./TerminalView", () => ({
  TerminalView: function StubTerminal({
    onSession,
    onCwd,
  }: {
    onSession?: (id: number | null) => void;
    onCwd?: (path: string) => void;
  }) {
    useEffect(() => {
      onSession?.(1);
      onCwd?.("/home/me/repo");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const withBackend = (settings: object) =>
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "settings_load") return JSON.stringify(settings);
    if (cmd === "git_branch") return (args as { path: string }).path === "/home/me/repo" ? "main" : null;
    return null;
  });

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

describe("git branch under the terminal", () => {
  it("shows the branch of the terminal's folder in a bar under it, not in the tab", async () => {
    withBackend({});
    render(<App />);
    await screen.findByTestId("terminal");
    await settle();
    const branch = screen.getByTitle("Git branch: main");
    expect(branch.closest(".pane-footer")).not.toBeNull();
    expect(branch.closest(".tabbar")).toBeNull();
    expect(document.querySelector(".tabbar .tab__branch")).toBeNull();
  });

  it("shows nothing and reads nothing when the setting is off", async () => {
    withBackend({ gitBranch: false });
    render(<App />);
    await screen.findByTestId("terminal");
    await settle();
    expect(screen.queryByTitle("Git branch: main")).toBeNull();
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_branch")).toBe(false);
  });
});
