// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { SessionTarget } from "../sessions/types";

const library = {
  version: 1,
  folders: [],
  sessions: [
    {
      kind: "ssh",
      id: "s1",
      name: "web",
      folder: "",
      host: "web.example.com",
      port: 22,
      username: "deploy",
      auth: { method: "agent" },
    },
    { kind: "telnet", id: "t1", name: "old switch", folder: "", host: "switch.lan", port: 2323 },
    { kind: "mosh", id: "m1", name: "web (mosh)", folder: "", sshSessionId: "s1", serverCommand: "mosh-server new" },
    { kind: "mosh", id: "m2", name: "orphan (mosh)", folder: "", sshSessionId: "gone" },
  ],
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => (command === "sessions_load" ? JSON.stringify(library) : null)),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Stands in for xterm + backend: shows the target it was opened with. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: ({ target }: { target: SessionTarget }) => (
    <div data-testid="terminal" data-target={JSON.stringify(target)} />
  ),
}));

const lastTarget = () => JSON.parse(screen.getAllByTestId("terminal").slice(-1)[0].dataset.target!);

const webLogin = { type: "ssh", host: "web.example.com", port: 22, username: "deploy", auth: { method: "agent" } };

afterEach(cleanup);

describe("App Telnet and Mosh (S17.3)", () => {
  it("opens a Telnet tab from the More menu", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "More ▾" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Telnet…" }));
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "switch.lan" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(lastTarget()).toEqual({ type: "telnet", host: "switch.lan", port: 23 });
  });

  it("opens a Mosh tab over a saved SSH session from the More menu", async () => {
    render(<App />);
    await screen.findByText("web");
    fireEvent.click(screen.getByRole("button", { name: "More ▾" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mosh…" }));
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await vi.waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(2));
    expect(lastTarget()).toEqual({ type: "mosh", ssh: webLogin });
  });

  it("opens saved Telnet and Mosh sessions", async () => {
    render(<App />);
    fireEvent.doubleClick(await screen.findByText("old switch"));
    expect(lastTarget()).toEqual({ type: "telnet", host: "switch.lan", port: 2323 });
    fireEvent.doubleClick(screen.getByText("web (mosh)"));
    await vi.waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(3));
    expect(lastTarget()).toEqual({ type: "mosh", ssh: webLogin, serverCommand: "mosh-server new" });
  });

  it("explains when the SSH session of a Mosh session no longer exists", async () => {
    render(<App />);
    fireEvent.doubleClick(await screen.findByText("orphan (mosh)"));
    expect(
      await screen.findByText('The SSH session of "orphan (mosh)" no longer exists; edit it to choose another one.'),
    ).toBeTruthy();
    expect(screen.getAllByTestId("terminal")).toHaveLength(1);
  });
});
