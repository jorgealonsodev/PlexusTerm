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

/** Times the viewed local file was "edited" on disk. */
const edits = { n: 0 };

const library = {
  version: 1,
  folders: [],
  sessions: [
    { kind: "ssh", id: "s1", name: "web", folder: "", host: "web.example.com", port: 22, username: "deploy", auth: { method: "agent" } },
  ],
};

beforeEach(() => {
  terminals.length = 0;
  edits.n = 0;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const path = (args as { path?: string } | undefined)?.path;
    if (cmd === "sessions_load") return JSON.stringify(library);
    if (cmd === "local_home") return "/home/me";
    if (cmd === "local_list") return path === "/home/me" ? [entry("/home/me/my proj", "dir"), entry("/home/me/a.txt")] : [];
    if (cmd === "sftp_home") return "/srv";
    if (cmd === "sftp_list") return path === "/srv" ? [entry("/srv/it's here", "dir"), entry("/srv/b.txt")] : [];
    if (cmd === "local_view_text") return { path, content: `local ${path}${edits.n ? ` v${edits.n}` : ""}`, truncated: false };
    if (cmd === "sftp_view_text") return { path, content: `remote ${path}`, truncated: false };
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

describe("File viewer in a tab", () => {
  const viewerText = () => document.querySelector(".viewer .cm-content")?.textContent;

  it("opens an Explorer file at the left of the terminal, and shows the next file in the same viewer", async () => {
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("a.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    await waitFor(() => expect(viewerText()).toBe("local /home/me/a.txt"));
    // At the left of the terminal, in the same tab.
    const grid = document.querySelector(".tab-panes:not([hidden])")!;
    const viewer = grid.querySelector(".viewer")!;
    const terminal = grid.querySelector("[data-testid=terminal]")!;
    expect(viewer.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("local_view_text", { path: "/home/me/a.txt" });
    // The viewer is not a terminal: no second session was started.
    expect(terminals).toHaveLength(1);
    // The file's row in the Explorer (the viewer's title shows its name too).
    fireEvent.contextMenu(screen.getAllByText("a.txt").find((el) => el.closest("li"))!);
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    expect(document.querySelectorAll(".viewer")).toHaveLength(1);
    // Viewing the same file again reads it again (it may have changed on disk).
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "local_view_text")).toHaveLength(2),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    await waitFor(() => expect(document.querySelector(".viewer")).toBeNull());
    expect(terminals).toHaveLength(1);
  });

  it("reads files of the SFTP browser through the tab's session", async () => {
    render(<App />);
    await screen.findByText("a.txt");
    await act(async () => void fireEvent.click(screen.getByRole("tab", { name: "Sessions" })));
    fireEvent.doubleClick(await screen.findByText("web"));
    await waitFor(() => expect(terminals).toHaveLength(2));
    fireEvent.contextMenu(await screen.findByText("b.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    await waitFor(() => expect(viewerText()).toBe("remote /srv/b.txt"));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("sftp_view_text", { id: 2, path: "/srv/b.txt" });
  });

  it("shows the file's new text when its terminal prints while it is open", async () => {
    render(<App />);
    fireEvent.contextMenu(await screen.findByText("a.txt"));
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    await waitFor(() => expect(viewerText()).toBe("local /home/me/a.txt"));
    edits.n = 1;
    act(() => terminals[0].print("Editing a.txt…"));
    await waitFor(() => expect(viewerText()).toBe("local /home/me/a.txt v1"), { timeout: 3000 });
  });
});
