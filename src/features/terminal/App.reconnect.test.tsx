// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** The last terminal's onSession, so a test can report its connection ending and coming back. */
const report: { session?: (id: number | null) => void } = {};
vi.mock("./TerminalView", () => ({
  TerminalView: function StubTerminal({ onSession }: { onSession?: (id: number | null) => void }) {
    useEffect(() => {
      report.session = onSession;
      onSession?.(5);
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

const settle = (ms = 20) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const prod = { id: "s1", name: "Prod", folder: "", host: "prod.example", port: 22, username: "ops", auth: { method: "agent" } };
const tabsFile = JSON.stringify({ version: 1, active: 0, tabs: [{ source: { sessionId: "s1" }, layout: { kind: "pane", id: "pane-1" }, focused: "pane-1", panes: {} }] });
const selected = (name: string) => screen.getByRole("tab", { name }).getAttribute("aria-selected");

describe("A reconnected SSH session", () => {
  it("brings the file browser to the front only the first time it connects", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "sessions_load") return JSON.stringify({ version: 1, folders: [], sessions: [prod] });
      if (cmd === "tabs_state_load") return tabsFile;
      return cmd.endsWith("_list") ? [] : null;
    });
    render(<App />);
    await settle();
    await settle();
    expect(selected("SFTP")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(selected("Sessions")).toBe("true");
    // The connection drops and the terminal reconnects by itself.
    await act(async () => report.session?.(null));
    await act(async () => report.session?.(6));
    await settle();
    expect(selected("Sessions")).toBe("true");
  });
});
