// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import App from "../../App";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { AttentionNotice } from "../terminal/attention";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import process from "node:process";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
const system = vi.hoisted(() => ({ showSystemNotification: vi.fn(async () => {}) }));
vi.mock("../notifications/systemNotification", () => system);

interface StubProps {
  target: { type: string; cwd?: string };
  onSession?: (id: number | null) => void;
  onCwd?: (path: string) => void;
  onTitle: (title: string) => void;
  onPrompt?: (mark: boolean) => void;
  onCommand?: (command: string, prompt: string) => void;
  onOutputQuiet?: (row: string) => void;
  onActivity?: (busy: boolean) => void;
  onAttention?: (notice: AttentionNotice) => void;
}

/** The props of the (only) terminal, as last rendered. */
const stub = vi.hoisted(() => ({ props: null as unknown as StubProps }));
/** Stands in for xterm: a local shell (pty 5) whose callbacks the tests call. */
vi.mock("../terminal/TerminalView", () => ({
  TerminalView: function StubTerminal(props: StubProps) {
    stub.props = props;
    useEffect(() => {
      props.onSession?.(5);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
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

const folders: Record<string, ReturnType<typeof entry>[]> = {
  "/home/me/repo": [entry("/home/me/repo/.git", "dir"), entry("/home/me/repo/src", "dir")],
  "/home/me/repo/src": [entry("/home/me/repo/src/main.ts")],
  "/home/me": [entry("/home/me/repo", "dir")],
  "/tmp": [entry("/tmp/scratch.txt")],
};

let windowFocused = true;
/** `.plexusterm` colours by project folder. */
const projectColors: Record<string, { tabColor: string | null; toolbarColor: string | null }> = {};
const withBackend = (settings: object = {}) =>
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const path = (args as { path?: string } | undefined)?.path;
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "pty_cwd") return "/home/me/repo/src";
    if (cmd === "local_home") return "/home/me";
    if (cmd === "local_list") return folders[path!] ?? [];
    if (cmd === "git_branch") return "main";
    if (cmd === "git_status") return [];
    if (cmd === "project_colors_get") return projectColors[(args as { folder: string }).folder] ?? { tabColor: null, toolbarColor: null };
    return null;
  });

beforeEach(() => {
  windowFocused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => windowFocused);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
  system.showSystemNotification.mockClear();
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const renderApp = async (settings: object = {}) => {
  withBackend(settings);
  render(<App />);
  await screen.findByTestId("terminal");
  await settle();
};
const devButton = () => screen.getByRole("button", { name: /DEV mode/ });
const devOn = () => devButton().getAttribute("aria-pressed") === "true";
const tabBar = () => document.querySelector<HTMLElement>(".tabbar")!;
const run = async (command: string, prompt = "me@box:~/repo/src$ ") => {
  act(() => stub.props.onCommand?.(command, prompt));
  await settle();
};
const listed = (path: string) =>
  vi.mocked(invoke).mock.calls.some(([cmd, args]) => cmd === "local_list" && (args as { path: string }).path === path);

describe("DEV mode (S10, S13)", () => {
  it("leaves the interface as before while no tab is in DEV mode", async () => {
    await renderApp();
    expect(devOn()).toBe(false);
    // The bar under the terminal is there for the DEV button at its right end, without a branch.
    const footer = devButton().closest(".pane-footer")!;
    expect(footer).not.toBeNull();
    expect(footer.lastElementChild).toBe(devButton());
    expect(devButton().getAttribute("aria-label")).toBe("DEV mode: off");
    expect(devButton().classList.contains("pane-footer__dev--on")).toBe(false);
    expect(screen.queryByTitle("Git branch: main")).toBeNull();
    expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "git_branch")).toBe(false);
    // Tabs on top, no DEV mark, flat file lists.
    expect(tabBar().classList.contains("tabbar--column")).toBe(false);
    expect(document.querySelector(".main--dev")).toBeNull();
    expect(within(tabBar()).queryByLabelText("DEV mode")).toBeNull();
    expect(await screen.findByText("main.ts")).toBeTruthy();
    expect(document.querySelector("[role=tree]")).toBeNull();
  });

  it("shows only the DEV option, without the bar, under a terminal with another one below it", async () => {
    await renderApp();
    const footers = () =>
      [...document.querySelectorAll<HTMLElement>(".tab-panes:not([hidden]) .pane[data-pane-id]")].map((pane) => {
        const footer = pane.querySelector(".pane-footer");
        return footer && { bare: footer.classList.contains("pane-footer--bare"), dev: footer.querySelector(".pane-footer__dev") !== null };
      });
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    await settle();
    expect(footers()).toEqual([
      { bare: false, dev: true },
      { bare: false, dev: true },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Split down" }));
    await settle();
    // The focused (right) pane was split: its top half has a terminal below it.
    expect(footers()).toEqual([
      { bare: false, dev: true },
      { bare: true, dev: true },
      { bare: false, dev: true },
    ]);
    const css = readFileSync(`${process.cwd()}/src/App.css`, "utf8") as string;
    expect(css).toMatch(/\.pane-footer--bare\s*\{[^}]*border-top:\s*none[^}]*background:\s*none/);
  });

  it("turned on in one pane of a split tab, shows only that terminal until it is turned off", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    await settle();
    const panes = () => [...document.querySelectorAll<HTMLElement>(".tab-panes:not([hidden]) .pane[data-pane-id]")];
    const [left, right] = panes();
    const shown = () => panes().filter((p) => !p.hidden);
    fireEvent.mouseDown(right);
    fireEvent.click(within(right).getByRole("button", { name: /DEV mode/ }));
    await settle();
    expect(shown()).toEqual([right]);
    expect(left.isConnected).toBe(true);
    fireEvent.click(within(right).getByRole("button", { name: /DEV mode/ }));
    await settle();
    expect(shown()).toEqual([left, right]);
  });

  it("lists the hidden terminals in the column and shows the one clicked", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    await settle();
    const panes = () => [...document.querySelectorAll<HTMLElement>(".tab-panes:not([hidden]) .pane[data-pane-id]")];
    const [left, right] = panes();
    const shown = () => panes().filter((p) => !p.hidden);
    fireEvent.mouseDown(right);
    fireEvent.click(within(right).getByRole("button", { name: /DEV mode/ }));
    await settle();
    // One row per terminal, no extra row for the tab.
    const rows = () => [...tabBar().querySelectorAll<HTMLElement>(".tab--row")];
    const names = () => rows().map((r) => r.querySelector(".tab__title")?.textContent);
    const marked = () => rows().map((r) => r.classList.contains("tab--active"));
    expect(names()).toEqual(["Terminal 1", "Terminal 2"]);
    expect(marked()).toEqual([false, true]);
    fireEvent.mouseDown(rows()[0], { button: 0 });
    await settle();
    expect(shown()).toEqual([left]);
    expect(marked()).toEqual([true, false]);
    expect(right.isConnected).toBe(true);
  });

  it("keeps the whole bar under the terminal on screen when DEV mode hides the one below it", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Split down" }));
    await settle();
    const [top] = [...document.querySelectorAll<HTMLElement>(".tab-panes:not([hidden]) .pane[data-pane-id]")];
    expect(top.querySelector(".pane-footer")!.classList.contains("pane-footer--bare")).toBe(true);
    fireEvent.mouseDown(top);
    fireEvent.click(within(top).getByRole("button", { name: /DEV mode/ }));
    await settle();
    expect(top.querySelector(".pane-footer")!.classList.contains("pane-footer--bare")).toBe(false);
  });

  it("turns on for each listed CLI and not for other commands", async () => {
    await renderApp();
    for (const command of ["claude-foo", "echo claude", "ls -la"]) {
      await run(command);
      expect(devOn(), command).toBe(false);
    }
    for (const cli of ["claude", "codex", "agy", "opencode", "pi", "gentle-shell"]) {
      await run(cli);
      expect(devOn(), cli).toBe(true);
      act(() => stub.props.onPrompt?.(true));
      await settle();
      expect(devOn(), cli).toBe(false);
    }
  });

  it("follows the commands listed in Settings", async () => {
    await renderApp({ devCommands: ["aider"] });
    await run("claude");
    expect(devOn()).toBe(false);
    await run("aider --model x");
    expect(devOn()).toBe(true);
  });

  it("turns on from a CLI's terminal title when the command was not seen", async () => {
    await renderApp();
    act(() => stub.props.onTitle("✳ Claude Code"));
    await settle();
    expect(devOn()).toBe(true);
  });

  it("turns on by title only when a CLI's title appears, so turning it off by hand sticks", async () => {
    await renderApp();
    act(() => stub.props.onTitle("✳ Claude Code"));
    await settle();
    fireEvent.click(devButton());
    await settle();
    expect(devOn()).toBe(false);
    // Claude Code keeps retitling its terminal while it works.
    act(() => stub.props.onTitle("⠂ Claude Code"));
    act(() => stub.props.onTitle("✳ Claude Code"));
    await settle();
    expect(devOn()).toBe(false);
    // Back at the shell, a later start of the CLI turns it on again.
    act(() => stub.props.onTitle("me@box: ~/repo"));
    act(() => stub.props.onTitle("✳ Claude Code"));
    await settle();
    expect(devOn()).toBe(true);
  });

  it("shows the DEV look while on: tab mark, right column with the CLI's icon, branch and VS Code-style lists", async () => {
    await renderApp();
    await run("claude");
    expect(within(tabBar()).getByRole("img", { name: "DEV mode" }).querySelector("svg")).not.toBeNull();
    expect(tabBar().classList.contains("tabbar--column")).toBe(true);
    expect(document.querySelector(".main--dev")).not.toBeNull();
    const row = within(tabBar()).getByRole("tab");
    expect(row.querySelector(".cli-icon--claude")).not.toBeNull();
    await waitFor(() => expect(row.querySelector(".tab__folder")?.textContent).toBe("src"));
    expect(within(row).getByRole("button", { name: /^Close/ })).toBeTruthy();
    const branch = await screen.findByTitle("Git branch: main");
    expect(branch.closest(".pane-footer")).not.toBeNull();
    await waitFor(() => expect(document.querySelector("[role=tree]")).not.toBeNull());
  });

  it("turns off when the shell's prompt comes back, not on quiet output inside the CLI", async () => {
    await renderApp();
    await run("claude");
    // Quiet output inside the CLI is not the shell's prompt.
    act(() => stub.props.onPrompt?.(false));
    act(() => stub.props.onOutputQuiet?.("│ > "));
    await settle();
    expect(devOn()).toBe(true);
    act(() => stub.props.onOutputQuiet?.("me@box:~/repo/src$ "));
    await settle();
    expect(devOn()).toBe(false);
    expect(stub.props.onOutputQuiet).toBeUndefined();
    expect(tabBar().classList.contains("tabbar--column")).toBe(false);
    expect(screen.queryByTitle("Git branch: main")).toBeNull();
    expect(document.querySelector("[role=tree]")).toBeNull();
  });

  it("is turned on and off with the button, and a hand-made DEV mode survives the prompt", async () => {
    await renderApp();
    fireEvent.click(devButton());
    await settle();
    expect(devOn()).toBe(true);
    expect(devButton().getAttribute("aria-label")).toBe("DEV mode: on");
    expect(devButton().classList.contains("pane-footer__dev--on")).toBe(true);
    // Still the last item of the bar, now after the branch.
    expect(devButton().closest(".pane-footer")!.lastElementChild).toBe(devButton());
    await run("claude");
    act(() => stub.props.onPrompt?.(true));
    await settle();
    expect(devOn()).toBe(true);
    fireEvent.click(devButton());
    await settle();
    expect(devOn()).toBe(false);
  });

  it("opens the column's new terminal in DEV mode, in the default folder; the + on top still opens a plain one", async () => {
    await renderApp({ localCwd: "/srv/default" });
    fireEvent.click(within(tabBar()).getByRole("button", { name: "New local terminal" }));
    await settle();
    expect(within(tabBar()).getAllByRole("tab")).toHaveLength(2);
    expect(stub.props.target.cwd).toBe("/srv/default");
    expect(devOn()).toBe(false);
    expect(tabBar().classList.contains("tabbar--column")).toBe(false);

    fireEvent.click(devButton());
    await settle();
    fireEvent.click(within(tabBar()).getByRole("button", { name: "New local terminal" }));
    await settle();
    const tabs = within(tabBar()).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(devOn()).toBe(true);
    expect(tabBar().classList.contains("tabbar--column")).toBe(true);
    expect(within(tabs[2]).getByLabelText("DEV mode")).toBeTruthy();
    // It starts in the default folder, like any new terminal.
    expect(stub.props.target.cwd).toBe("/srv/default");
  });

  it("marks a tab as working while its CLI prints, and only while a CLI runs there", async () => {
    await renderApp();
    const working = () => within(tabBar()).queryByRole("img", { name: "Working" });
    act(() => stub.props.onActivity?.(true));
    await settle();
    expect(working()).toBeNull();
    act(() => stub.props.onActivity?.(false));
    await run("claude");
    act(() => stub.props.onActivity?.(true));
    await settle();
    expect(working()).not.toBeNull();
    expect(working()!.closest(".tab--row")).not.toBeNull();
    act(() => stub.props.onActivity?.(false));
    await settle();
    expect(working()).toBeNull();
  });

  it("duplicates a DEV tab into a new DEV tab, and a plain tab into a plain one", async () => {
    await renderApp();
    const duplicate = (index: number) => {
      fireEvent.contextMenu(within(tabBar()).getAllByRole("tab")[index], { clientX: 1, clientY: 1 });
      fireEvent.click(screen.getByText("Duplicate tab"));
    };
    duplicate(0);
    await settle();
    expect(within(tabBar()).getAllByRole("tab")).toHaveLength(2);
    expect(devOn()).toBe(false);

    fireEvent.click(devButton());
    await settle();
    duplicate(1);
    await settle();
    const tabs = within(tabBar()).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(devOn()).toBe(true);
    expect(within(tabs[2]).getByLabelText("DEV mode")).toBeTruthy();
  });

  it("keeps the folders added to a DEV tab's workspace with that tab", async () => {
    await renderApp();
    await run("claude");
    vi.mocked(open).mockResolvedValueOnce("/tmp");
    fireEvent.click(await screen.findByRole("button", { name: "Add folder" }));
    const added = await screen.findByRole("group", { name: "tmp" });
    expect(await within(added).findByText("scratch.txt")).toBeTruthy();
    // Another tab has its own (empty) workspace; back on the first one, the folder is still there.
    fireEvent.click(within(tabBar()).getByRole("button", { name: "New local terminal" }));
    await settle();
    expect(screen.queryByRole("group", { name: "tmp" })).toBeNull();
    fireEvent.mouseDown(within(tabBar()).getAllByRole("tab")[0], { button: 0 });
    expect(await screen.findByRole("group", { name: "tmp" })).toBeTruthy();
  });

  it("opens a folder in a new DEV terminal with Open in terminal while in DEV mode", async () => {
    await renderApp();
    fireEvent.click(devButton());
    await settle();
    act(() => stub.props.onCwd?.("/home/me"));
    fireEvent.contextMenu(await screen.findByText("repo"), { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    await settle();
    const tabs = within(tabBar()).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(stub.props.target.cwd).toBe("/home/me/repo");
    expect(devOn()).toBe(true);
  });

  it("opens a workspace file in a new DEV tab: the terminal in its first folder, the others added", async () => {
    await renderApp();
    await run("claude");
    const backend = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) =>
      cmd === "local_read_text"
        ? { path: "/home/me/app.code-workspace", content: '{ "folders": [{ "path": "repo" }, { "path": "/tmp" }] }', truncated: false }
        : backend(cmd, args as Parameters<typeof backend>[1]),
    );
    vi.mocked(open).mockResolvedValueOnce("/home/me/app.code-workspace");
    fireEvent.click(await screen.findByRole("button", { name: "Open workspace" }));
    await settle();
    const tabs = within(tabBar()).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(stub.props.target.cwd).toBe("/home/me/repo");
    expect(devOn()).toBe(true);
    expect(await screen.findByRole("group", { name: "tmp" })).toBeTruthy();
  });

  /** The backend with a workspace file to read, and the one PlexusTerm was launched with. */
  const withWorkspaceFile = (launchedWith: string | null) => {
    const backend = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "launch_workspace_take") return launchedWith;
      if (cmd === "local_read_text" && (args as { path: string }).path === "/home/me/app.code-workspace")
        return { content: '{ "folders": [{ "path": "repo" }, { "path": "/tmp" }] }' };
      return backend(cmd, args as Parameters<typeof backend>[1]);
    });
  };

  it("starts in DEV mode with the workspace file PlexusTerm was opened with, instead of the usual terminal", async () => {
    withBackend();
    withWorkspaceFile("/home/me/app.code-workspace");
    render(<App />);
    await screen.findByTestId("terminal");
    await settle();
    expect(within(tabBar()).getAllByRole("tab")).toHaveLength(1);
    expect(stub.props.target.cwd).toBe("/home/me/repo");
    expect(devOn()).toBe(true);
    expect(await screen.findByRole("group", { name: "tmp" })).toBeTruthy();
  });

  it("starts with the usual terminal when the workspace file it was opened with lists no folders", async () => {
    withBackend();
    withWorkspaceFile("/home/me/empty.code-workspace");
    render(<App />);
    await screen.findByTestId("terminal");
    await settle();
    expect(within(tabBar()).getAllByRole("tab")).toHaveLength(1);
    expect(stub.props.target.cwd).toBeUndefined();
    expect(devOn()).toBe(false);
  });

  it("opens a workspace file given to a second launch as a new DEV tab of the running window", async () => {
    await renderApp();
    withWorkspaceFile(null);
    const handler = vi.mocked(listen).mock.calls.find(([event]) => event === "open-workspace")?.[1];
    expect(handler).toBeTruthy();
    act(() => handler!({ event: "open-workspace", id: 1, payload: "/home/me/app.code-workspace" }));
    await settle();
    const tabs = within(tabBar()).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(stub.props.target.cwd).toBe("/home/me/repo");
    expect(devOn()).toBe(true);
    expect(await screen.findByRole("group", { name: "tmp" })).toBeTruthy();
  });

  it("saves a DEV tab's colour in its project's .plexusterm folder, and outside DEV mode nowhere", async () => {
    await renderApp();
    const pick = (name: string) => {
      fireEvent.contextMenu(within(tabBar()).getAllByRole("tab")[0], { clientX: 1, clientY: 1 });
      fireEvent.click(screen.getByRole("menuitem", { name: "Tab colour…" }));
      fireEvent.click(screen.getByRole("menuitem", { name }));
    };
    const saved = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "project_color_set");
    pick("Red");
    await settle();
    expect(saved()).toEqual([]);
    await run("claude");
    pick("Blue");
    await waitFor(() =>
      expect(saved()).toEqual([["project_color_set", { folder: "/home/me/repo/src", kind: "tab", color: "#2e86de" }]]),
    );
    pick("No colour");
    await waitFor(() =>
      expect(saved()[saved().length - 1]).toEqual(["project_color_set", { folder: "/home/me/repo/src", kind: "tab", color: null }]),
    );
  });

  it("gives a tab and the toolbar the colours its project saved when it goes into DEV mode", async () => {
    projectColors["/home/me/repo/src"] = { tabColor: "#16a085", toolbarColor: "#8e44ad" };
    try {
      await renderApp();
      const tab = () => within(tabBar()).getAllByRole("tab")[0];
      const toolbar = () => document.querySelector<HTMLElement>("header.toolbar")!;
      expect(tab().classList.contains("tab--coloured")).toBe(false);
      await run("claude");
      await waitFor(() => expect(tab().style.getPropertyValue("--tab-color")).toBe("#16a085"));
      expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("#8e44ad");
      // Back at the shell's prompt DEV mode ends: the window's own toolbar colour (none) is back.
      act(() => stub.props.onPrompt?.(true));
      await settle();
      expect(toolbar().style.getPropertyValue("--toolbar-bg")).toBe("");
    } finally {
      delete projectColors["/home/me/repo/src"];
    }
  });

  it("saves the toolbar colour in the active DEV tab's project, in the same file as the tab's", async () => {
    await renderApp();
    await run("claude");
    fireEvent.contextMenu(document.querySelector("header.toolbar")!, { clientX: 40, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Purple" }));
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("project_color_set", { folder: "/home/me/repo/src", kind: "toolbar", color: "#8e44ad" }),
    );
    expect(document.querySelector<HTMLElement>("header.toolbar")!.style.getPropertyValue("--toolbar-bg")).toBe("#8e44ad");
    // Not the window's own colour: outside the project's tabs the toolbar has none.
    expect(sessionStorage.getItem("plexusterm.toolbarColor")).toBeNull();
  });

  it("is toggled by its shortcut once one is set", async () => {
    await renderApp({ shortcuts: { toggleDevMode: "Ctrl+Shift+Y" } });
    expect(devButton().getAttribute("title")).toContain("Ctrl+Shift+Y");
    act(() => void fireEvent.keyDown(window, { key: "Y", ctrlKey: true, shiftKey: true }));
    await settle();
    expect(devOn()).toBe(true);
    act(() => void fireEvent.keyDown(window, { key: "Y", ctrlKey: true, shiftKey: true }));
    await settle();
    expect(devOn()).toBe(false);
  });

  it("opens the Explorer at the folder the tool was opened in and follows the terminal while Follow terminal folder is on", async () => {
    await renderApp();
    await run("claude");
    // Opened in the repository's src folder: the Explorer goes there, not to the repository root.
    await waitFor(() => expect(listed("/home/me/repo/src")).toBe(true));
    expect(await screen.findByText("main.ts")).toBeTruthy();
    expect(listed("/home/me/repo")).toBe(false);
    // The option is there in DEV mode too, on by default: the Explorer goes where the terminal goes.
    const follow = screen.getByRole("checkbox", { name: "Follow terminal folder" }) as HTMLInputElement;
    expect(follow.checked).toBe(true);
    act(() => stub.props.onCwd?.("/tmp"));
    await waitFor(() => expect(listed("/tmp")).toBe(true));
    expect(await screen.findByText("scratch.txt")).toBeTruthy();
    // Off: the Explorer stays where it is.
    fireEvent.click(follow);
    await settle();
    act(() => stub.props.onCwd?.("/opt"));
    await settle();
    expect(listed("/opt")).toBe(false);
  });

  it("keeps the Explorer at the folder the tool was opened in while Follow terminal folder is off", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow terminal folder" }));
    await settle();
    await run("claude");
    await waitFor(() => expect(listed("/home/me/repo/src")).toBe(true));
    act(() => stub.props.onCwd?.("/tmp"));
    await settle();
    expect(listed("/tmp")).toBe(false);
  });

  it("sends desktop notifications for a DEV tab even when they are off in Settings", async () => {
    await renderApp({ attentionNotifications: false });
    windowFocused = false;
    act(() => stub.props.onAttention?.({ title: null, body: "Claude is waiting" }));
    expect(system.showSystemNotification).not.toHaveBeenCalled();
    await run("claude");
    act(() => stub.props.onAttention?.({ title: null, body: "Claude is waiting" }));
    await waitFor(() => expect(system.showSystemNotification).toHaveBeenCalledTimes(1));
  });

  it("styles the DEV button as plain text pushed to the right edge, a pill only when on", () => {
    const css = readFileSync(`${process.cwd()}/src/App.css`, "utf8") as string;
    const rule = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    const off = rule(".pane-footer__dev");
    expect(off).toContain("margin-inline-start: auto");
    expect(off).toContain("border: none");
    expect(off).toContain("background: transparent");
    expect(off).not.toContain("transition: all");
    expect(rule(".pane-footer__dev--on")).toContain("color: var(--accent)");
  });

  it("remembers the width the tab column is dragged to, and starts with it", async () => {
    await renderApp({ tabColumnWidth: 300 });
    await run("claude");
    expect(tabBar().style.width).toBe("300px");
    vi.spyOn(tabBar(), "getBoundingClientRect").mockReturnValue({ left: 700, right: 1000 } as DOMRect);
    const handle = screen.getByRole("separator", { name: "Resize the tab column" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 600 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 600 });
    await settle();
    expect(tabBar().style.width).toBe("400px");
    const saves = vi
      .mocked(invoke)
      .mock.calls.filter(([cmd]) => cmd === "settings_save")
      .map(([, args]) => JSON.parse((args as { contents: string }).contents));
    expect(saves.slice(-1)[0]).toMatchObject({ tabColumnWidth: 400 });
  });
});
