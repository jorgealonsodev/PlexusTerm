// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
// A terminal that reports its backend session (pty 5) as soon as it mounts.
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: ({ onSession }: { onSession?: (id: number | null) => void }) => {
    useEffect(() => onSession?.(5), []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

const entry = (path: string) => ({
  name: path.split("/").pop(),
  path,
  kind: "file",
  size: 1,
  modified: null,
  permissions: null,
  uid: null,
  gid: null,
  user: null,
  group: null,
});

describe("Explorer tab", () => {
  it("is enabled for a local terminal and shows the folder its shell is in", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "pty_cwd") return "/srv/app";
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [entry(`${(args as { path: string }).path}/readme.md`)];
      return null;
    });
    render(<App />);
    await screen.findByTestId("terminal");
    const tab = await screen.findByRole("tab", { name: "Explorer" });
    await waitFor(() => expect((tab as HTMLButtonElement).disabled).toBe(false));
    await act(async () => void fireEvent.click(tab));
    expect(await screen.findByText("readme.md")).toBeTruthy();
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_cwd", { id: 5 }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("local_list", { path: "/srv/app" }));
    expect(screen.getByRole("tab", { name: "SFTP" }).hasAttribute("disabled")).toBe(true);
  });
});
