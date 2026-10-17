// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
  opener.openUrl.mockClear();
});

const NEWER = {
  current: "0.1.2",
  latest: { version: "0.2.0", notes: "Fixes.", url: "https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0" },
};

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function renderApp(settings: Partial<TerminalSettings>, check: () => Promise<unknown>) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "update_check") return check();
    return null;
  });
  render(<App />);
  await settle();
  await settle();
}

const checks = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "update_check").length;

describe("Update notice at startup", () => {
  it("tells about a newer release once and opens its page from Download", async () => {
    await renderApp({}, async () => NEWER);
    expect(screen.getByText("PlexusTerm 0.2.0 is available.")).toBeTruthy();
    expect(checks()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(opener.openUrl).toHaveBeenCalledWith(NEWER.latest.url);
    fireEvent.click(screen.getByRole("button", { name: "Close the update notice" }));
    expect(screen.queryByText("PlexusTerm 0.2.0 is available.")).toBeNull();
  });

  it("says nothing when PlexusTerm is up to date or the check fails", async () => {
    await renderApp({}, async () => ({ current: "0.1.2", latest: null }));
    expect(screen.queryByText(/is available/)).toBeNull();
    cleanup();
    await renderApp({}, async () => {
      throw "cannot reach GitHub";
    });
    expect(screen.queryByText(/is available|GitHub/)).toBeNull();
  });

  it("never checks when the startup check is turned off", async () => {
    await renderApp({ checkUpdates: false }, async () => NEWER);
    expect(checks()).toBe(0);
    expect(screen.queryByText(/is available/)).toBeNull();
  });
});
