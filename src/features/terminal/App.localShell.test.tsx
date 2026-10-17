// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import type { SessionTarget } from "../sessions/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("./TerminalView", () => ({
  TerminalView: ({ target }: { target: SessionTarget }) => <div data-testid="terminal" data-target={JSON.stringify(target)} />,
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function renderApp(settings: Partial<TerminalSettings>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "settings_load" ? JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }) : null,
  );
  render(<App />);
  await settle();
  await settle();
}

const targets = () => screen.queryAllByTestId("terminal").map((t) => JSON.parse(t.dataset.target!));
const newTerminal = () => act(() => void fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true }));

describe("Shell of new local terminals", () => {
  it("opens the first terminal and every new one with the shell from Settings", async () => {
    await renderApp({ localShell: "/usr/bin/fish", localShellArgs: "--login -C 'cd /srv'" });
    const fish = { type: "local", program: "/usr/bin/fish", args: ["--login", "-C", "cd /srv"] };
    expect(targets()).toEqual([fish]);
    newTerminal();
    expect(targets()).toEqual([fish, fish]);
  });

  it("opens plain local terminals with the system default shell", async () => {
    await renderApp({});
    expect(targets()).toEqual([{ type: "local" }]);
    newTerminal();
    expect(targets()).toEqual([{ type: "local" }, { type: "local" }]);
  });
});
