// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Channel, invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  Channel: class { onmessage = (_message: unknown) => {}; },
}));
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

async function renderApp(
  settings: Partial<TerminalSettings>, check: () => Promise<unknown>,
  install: () => Promise<unknown> = async () => "installed",
) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "update_check") return check();
    if (cmd === "update_install") return install();
    return null;
  });
  render(<App />);
  await settle();
  await settle();
}

const installs = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "update_install");
const progress = (message: unknown) => act(() => {
  const calls = installs();
  const channel = (calls[calls.length - 1][1] as { onProgress: Channel<unknown> }).onProgress;
  channel.onmessage(message);
});

const checks = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "update_check").length;

describe("Update notice at startup", () => {
  it("offers independent installation and exact release-page actions, and dismisses the notice", async () => {
    await renderApp({}, async () => NEWER);
    expect(screen.getByText("PlexusTerm 0.2.0 is available.")).toBeTruthy();
    expect(checks()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    expect(opener.openUrl).toHaveBeenCalledWith(NEWER.latest.url);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settle();
    expect(installs()).toHaveLength(1);
    expect(installs()[0]).toEqual(["update_install", { onProgress: expect.any(Channel) }]);
    expect(screen.getByText("Update installed. Restart PlexusTerm manually when ready.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close the update notice" }));
    expect(screen.queryByText("PlexusTerm 0.2.0 is available.")).toBeNull();
  });

  it("shows what changed in the release, links opening in the browser, and hides it again", async () => {
    const notes = "## What's new\n\n- SSH tabs reconnect by themselves\n- See the [docs](https://example.com/docs)\n\n<script>alert(1)</script>";
    await renderApp({}, async () => ({ ...NEWER, latest: { ...NEWER.latest, notes } }));
    expect(screen.queryByText("SSH tabs reconnect by themselves")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See what's new" }));
    expect(screen.getByRole("heading", { name: "What's new" })).toBeTruthy();
    expect(screen.getByText("SSH tabs reconnect by themselves")).toBeTruthy();
    expect(document.querySelector(".release-notes script")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "docs" }));
    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/docs");
    fireEvent.click(screen.getByRole("button", { name: "Hide changes" }));
    expect(screen.queryByText("SSH tabs reconnect by themselves")).toBeNull();
  });

  it("offers no changes button for a release without notes", async () => {
    await renderApp({}, async () => ({ ...NEWER, latest: { ...NEWER.latest, notes: "  " } }));
    expect(screen.getByText("PlexusTerm 0.2.0 is available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "See what's new" })).toBeNull();
  });

  it("shares progress and single-flight ownership with About, even after notice dismissal and dialog reopening", async () => {
    let finish!: (result: string) => void;
    await renderApp({}, async () => NEWER, () => new Promise((resolve) => { finish = resolve; }));
    const download = screen.getByRole("button", { name: "Download" });
    fireEvent.click(download);
    fireEvent.click(download);
    expect((download as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Checking installation…")).toBeTruthy();
    progress({ phase: "downloading", downloaded: 25, total: 100 });
    expect(screen.getByText("Downloading… 25 / 100 bytes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.getAllByRole("button", { name: "Download" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close the update notice" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    progress({ phase: "verifying" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.getByText("Verifying download…")).toBeTruthy();
    progress({ phase: "installing" });
    expect(screen.getByText("Installing… Follow any system authorization prompt.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    expect(opener.openUrl).toHaveBeenCalledWith(NEWER.latest.url);
    await act(async () => finish("installerOpened"));
    expect(screen.getByText("Installer completed. Restart PlexusTerm manually when ready.")).toBeTruthy();
    expect(installs()).toHaveLength(1);
    expect(checks()).toBe(1);
  });

  it("shows installation failures with retry and keeps the page usable, including visible opener errors", async () => {
    let attempts = 0;
    await renderApp({}, async () => NEWER, async () => {
      if (++attempts === 1) throw "Authorization cancelled";
      return "installed";
    });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toBe("Could not install update: Authorization cancelled");
    opener.openUrl.mockRejectedValueOnce(new Error("Browser unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    await settle();
    expect(screen.getAllByRole("alert").map((el) => el.textContent)).toContain("Could not open download page: Browser unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    await settle();
    expect(screen.queryByText(/Could not open download page/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry download" }));
    await settle();
    expect(installs()).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Update installed. Restart PlexusTerm manually when ready.")).toBeTruthy();
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
