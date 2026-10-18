// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import type { SessionTarget } from "../sessions/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

/** Every terminal opened: its target, what was run in it, and a way to print into it. */
const terminals = vi.hoisted(() => [] as { target: unknown; ran: string[]; print: (text: string) => void }[]);
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal({
    target,
    onSession,
    registerAssistTarget,
    registerMacroTarget,
  }: {
    target: SessionTarget;
    onSession?: (id: number | null) => void;
    registerAssistTarget?: (t: import("../terminal/TerminalView").AssistTarget) => () => void;
    registerMacroTarget?: (t: import("../macros/player").MacroTarget) => () => void;
  }) {
    useEffect(() => {
      const listeners = new Set<(text: string) => void>();
      const me = { target, ran: [] as string[], print: (text: string) => listeners.forEach((l) => l(text)) };
      terminals.push(me);
      const offMacro = registerMacroTarget?.({
        send: () => {},
        subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
        notice: () => {},
      });
      const offAssist = registerAssistTarget?.({
        selection: () => "",
        focus: () => {},
        insert: () => {},
        run: (text) => (me.ran.push(text), true),
        lineEmpty: () => true,
      });
      onSession?.(terminals.length);
      return () => {
        offMacro?.();
        offAssist?.();
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="terminal" />;
  },
}));

const entry = (path: string, kind = "file") => ({
  name: path.split("/").pop(),
  path,
  kind,
  size: 1,
  modified: null,
  permissions: null,
  uid: null,
  gid: null,
  user: null,
  group: null,
});

const library = {
  version: 1,
  folders: [],
  sessions: [
    { kind: "ssh", id: "s1", name: "web", folder: "", host: "web.example.com", port: 22, username: "deploy", auth: { method: "agent" } },
  ],
};

beforeEach(() => {
  terminals.length = 0;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const path = (args as { path?: string } | undefined)?.path;
    if (cmd === "sessions_load") return JSON.stringify(library);
    if (cmd === "local_home") return "/home/me";
    if (cmd === "local_list") return path === "/home/me" ? [entry("/home/me/my proj", "dir"), entry("/home/me/a.txt")] : [];
    if (cmd === "sftp_home") return "/srv";
    if (cmd === "sftp_list") return path === "/srv" ? [entry("/srv/it's here", "dir"), entry("/srv/b.txt")] : [];
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

describe("Open in terminal", () => {
  it("opens a local terminal tab that starts in the Explorer's folder", async () => {
    render(<App />);
    await act(async () => void fireEvent.click(await screen.findByRole("tab", { name: "Explorer" })));
    fireEvent.contextMenu(await screen.findByText("my proj"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    await waitFor(() => expect(terminals).toHaveLength(2));
    expect(terminals[1].target).toMatchObject({ type: "local", cwd: "/home/me/my proj" });
  });

  it("opens another tab of the same SSH session and changes to the folder once its shell is ready", async () => {
    render(<App />);
    // The local terminal brings the Explorer to the front first.
    await screen.findByText("my proj");
    await act(async () => void fireEvent.click(screen.getByRole("tab", { name: "Sessions" })));
    fireEvent.doubleClick(await screen.findByText("web"));
    await waitFor(() => expect(terminals).toHaveLength(2));
    fireEvent.contextMenu(await screen.findByText("it's here"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    await waitFor(() => expect(terminals).toHaveLength(3));
    expect(terminals[2].target).toEqual(terminals[1].target);
    // Not before the shell has printed its welcome and prompt.
    expect(terminals[2].ran).toEqual([]);
    act(() => terminals[2].print("Welcome\r\n$ "));
    await waitFor(() => expect(terminals[2].ran).toEqual([`cd '/srv/it'\\''s here'`]));
    // Once only, and never in the original tab.
    act(() => terminals[2].print("more\r\n$ "));
    await new Promise((r) => setTimeout(r, 700));
    expect(terminals[2].ran).toHaveLength(1);
    expect(terminals[1].ran).toEqual([]);
  });
});
