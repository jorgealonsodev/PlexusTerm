// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { saveSidebarView } from "../sidebar/uiMemory";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const pane = vi.hoisted(() => ({
  lineEmpty: true,
  inserted: [] as string[],
  ran: [] as string[],
  fileLinks: undefined as import("../terminal/fileLinks").FileLinks | undefined,
}));
// A terminal that reports its backend session (pty 5) as soon as it mounts.
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: ({
    onSession,
    registerAssistTarget,
    fileLinks,
  }: {
    fileLinks?: import("../terminal/fileLinks").FileLinks;
    onSession?: (id: number | null) => void;
    registerAssistTarget?: (target: import("../terminal/TerminalView").AssistTarget) => () => void;
  }) => {
    pane.fileLinks = fileLinks;
    useEffect(() => {
      onSession?.(5);
      return registerAssistTarget?.({
        selection: () => "",
        focus: () => {},
        insert: (text) => void pane.inserted.push(text),
        run: (text) => (pane.ran.push(text), true),
        lineEmpty: () => pane.lineEmpty,
      });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="terminal" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
});

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

describe("Explorer tab", () => {
  it("opens a file Ctrl+clicked in the terminal in the editor and shows it in the Explorer", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      const path = (args as { path?: string } | undefined)?.path;
      if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, sidebarWidth: 300 });
      if (cmd === "local_home") return "/home/me";
      if (cmd === "pty_program_cwd") return "/home/me";
      if (cmd === "local_list") return path === "/home/me" ? [entry("/home/me/docs", "dir")] : path === "/home/me/docs" ? [entry("/home/me/docs/PRD.md")] : [];
      if (cmd === "local_stat") return path === "/home/me/docs/PRD.md" ? entry(path) : Promise.reject("not found");
      if (cmd === "local_view_text") return { path, content: "# PRD", truncated: false, encoding: "utf-8" };
      return null;
    });
    render(<App />);
    await screen.findByTestId("terminal");
    await waitFor(() => expect(pane.fileLinks).toBeTruthy());
    expect(await pane.fileLinks!.resolve("docs/missing.md")).toBeNull();
    // Paths are read from the folder of the terminal's program, which arrives on its own.
    await waitFor(async () => expect(await pane.fileLinks!.resolve("docs/PRD.md")).toBe("/home/me/docs/PRD.md"));
    act(() => pane.fileLinks!.open("/home/me/docs/PRD.md"));
    // The Explorer tab is shown, with the file selected in its folder.
    const tab = await screen.findByRole("tab", { name: "Explorer" });
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.querySelector(".sftp-row--selected")?.textContent).toContain("PRD.md"));
    // And it opens in the viewer.
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === "local_view_text" && (args as { path: string }).path === "/home/me/docs/PRD.md")).toBe(true));
  });

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

  it("works as shown when the SFTP tab, left chosen from an SSH tab, gives way to it in a local tab", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "pty_cwd") return "/srv/app";
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [entry(`${(args as { path: string }).path}/readme.md`)];
      return null;
    });
    saveSidebarView("sftp");
    render(<App />);
    await screen.findByTestId("terminal");
    // The Explorer is on screen: it follows the shell's folder and reads its git status.
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("pty_cwd", { id: 5 }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("local_list", { path: "/srv/app" }));
    expect(await screen.findByText("readme.md")).toBeTruthy();
  });

  it("drops a row on the terminal: cd into a folder on an empty line, otherwise types the path", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, sidebarWidth: 300 });
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [entry("/home/me/my src", "dir"), entry("/home/me/a.txt")];
      return null;
    });
    render(<App />);
    const terminal = await screen.findByTestId("terminal");
    const tab = await screen.findByRole("tab", { name: "Explorer" });
    await waitFor(() => expect((tab as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(tab);
    document.elementFromPoint = () => terminal;
    const drag = async (name: string) => {
      const row = await screen.findByText(name);
      fireEvent.pointerDown(row, { clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
      expect(document.querySelector(".path-drag")?.textContent).toBe(name);
      expect(terminal.closest("[data-drop-pane]")?.classList.contains("drop-target--over")).toBe(true);
      fireEvent.pointerUp(window, { clientX: 400, clientY: 300 });
      expect(document.querySelector(".path-drag")).toBeNull();
    };
    pane.lineEmpty = true;
    await drag("my src");
    expect(pane.ran).toEqual(["cd '/home/me/my src'"]);
    await drag("a.txt");
    expect(pane.inserted).toEqual(["/home/me/a.txt "]);
    pane.lineEmpty = false;
    await drag("my src");
    expect(pane.inserted).toEqual(["/home/me/a.txt ", "'/home/me/my src' "]);
    expect(pane.ran).toHaveLength(1);
    // A click without moving is not a drop.
    fireEvent.pointerDown(await screen.findByText("a.txt"), { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 11, clientY: 10 });
    expect(pane.inserted).toHaveLength(2);
  });

  it("runs cd in the terminal for a folder opened in the Explorer, on an empty line only (L16)", async () => {
    const start = async (settings: object) => {
      vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
        if (cmd === "local_home") return "/home/me";
        if (cmd === "local_list") return [entry("/home/me/my src", "dir")];
        return null;
      });
      render(<App />);
      await screen.findByTestId("terminal");
      const tab = await screen.findByRole("tab", { name: "Explorer" });
      await waitFor(() => expect((tab as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(tab);
      return screen.findByText("my src");
    };
    pane.ran = [];
    pane.lineEmpty = true;
    fireEvent.doubleClick(await start({}));
    await waitFor(() => expect(pane.ran).toEqual(["cd '/home/me/my src'"]));
    pane.lineEmpty = false;
    fireEvent.click(screen.getByTitle("Up"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("local_list", { path: "/home/me" }));
    expect(pane.ran).toHaveLength(1);
    cleanup();
    pane.ran = [];
    pane.lineEmpty = true;
    fireEvent.doubleClick(await start({ terminalFollowsBrowser: false }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("local_list", { path: "/home/me/my src" }));
    expect(pane.ran).toEqual([]);
  });

  it("leaves the terminal's folder alone when Follow terminal folder is off", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [entry("/home/me/my src", "dir")];
      return null;
    });
    render(<App />);
    await screen.findByTestId("terminal");
    const tab = await screen.findByRole("tab", { name: "Explorer" });
    await waitFor(() => expect((tab as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(tab);
    pane.ran = [];
    pane.lineEmpty = true;
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow terminal folder" }));
    fireEvent.doubleClick(await screen.findByText("my src"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("local_list", { path: "/home/me/my src" }));
    expect(pane.ran).toEqual([]);
  });

  it("opens on the Explorer for a local terminal, and leaves another chosen tab alone (L18)", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [];
      return null;
    });
    render(<App />);
    await screen.findByTestId("terminal");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Explorer" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
    act(() => void fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true }));
    await waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(2));
    expect(screen.getByRole("tab", { name: "Macros" }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens on the sidebar tab it was left on, even Sessions; later local terminals still bring the Explorer", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "settings_load") return JSON.stringify(DEFAULT_SETTINGS);
      if (cmd === "local_home") return "/home/me";
      if (cmd === "local_list") return [];
      return null;
    });
    const { unmount } = render(<App />);
    await screen.findByTestId("terminal");
    fireEvent.click(await screen.findByRole("tab", { name: "Sessions" }));
    unmount();

    render(<App />);
    await screen.findByTestId("terminal");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole("tab", { name: "Sessions" }).getAttribute("aria-selected")).toBe("true");
    act(() => void fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true }));
    await waitFor(() => expect(screen.getAllByTestId("terminal")).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Explorer" }).getAttribute("aria-selected")).toBe("true"));
  });
});
