// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
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
const withBackend = (settings: object = {}) =>
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const path = (args as { path?: string } | undefined)?.path;
    if (cmd === "settings_load") return JSON.stringify({ ...DEFAULT_SETTINGS, ...settings });
    if (cmd === "pty_cwd") return "/home/me/repo/src";
    if (cmd === "local_home") return "/home/me";
    if (cmd === "local_list") return folders[path!] ?? [];
    if (cmd === "git_branch") return "main";
    if (cmd === "git_status") return [];
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
    await waitFor(() => expect(row.querySelector(".tab__title")?.textContent).toBe("src"));
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

  it("opens the column's new terminal in DEV mode; the + on top still opens a plain one", async () => {
    await renderApp();
    fireEvent.click(within(tabBar()).getByRole("button", { name: "New local terminal" }));
    await settle();
    expect(within(tabBar()).getAllByRole("tab")).toHaveLength(2);
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

  it("anchors the Explorer at the folder the tool was opened in and lets it follow the terminal again afterwards", async () => {
    await renderApp();
    await run("claude");
    // Opened in the repository's src folder: the Explorer goes there, not to the repository root.
    await waitFor(() => expect(listed("/home/me/repo/src")).toBe(true));
    expect(await screen.findByText("main.ts")).toBeTruthy();
    expect(listed("/home/me/repo")).toBe(false);
    // The terminal changes folder: the Explorer stays at the project.
    act(() => stub.props.onCwd?.("/tmp"));
    await settle();
    expect(listed("/tmp")).toBe(false);
    // DEV mode ends: the Explorer follows the terminal again.
    act(() => stub.props.onPrompt?.(true));
    await waitFor(() => expect(listed("/tmp")).toBe(true));
    expect(await screen.findByText("scratch.txt")).toBeTruthy();
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
