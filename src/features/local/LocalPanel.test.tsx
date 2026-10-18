// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../dialogs/DialogProvider";
import type { SftpEntry } from "../sftp/sftpClient";
import { writeText } from "../terminal/clipboard";
import { LocalPanel } from "./LocalPanel";
import { local } from "./localClient";
import { SHELL_CWD_POLL_MS, useShellCwd } from "./useShellCwd";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/clipboard", () => ({ writeText: vi.fn(), readText: vi.fn() }));
vi.mock("./localClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./localClient")>();
  return {
    ...actual,
    local: {
      home: vi.fn(),
      list: vi.fn(),
      stat: vi.fn(),
      mkdir: vi.fn(),
      createFile: vi.fn(),
      rename: vi.fn(),
      remove: vi.fn(),
      chmod: vi.fn(),
      open: vi.fn(),
      shellCwd: vi.fn(),
      gitStatus: vi.fn(),
    },
  };
});

const entry = (name: string, kind: SftpEntry["kind"], dir = "/home/me"): SftpEntry => ({
  name,
  path: `${dir}/${name}`,
  kind,
  size: 10,
  modified: null,
  permissions: 0o644,
  uid: 1000,
  gid: 1000,
  user: null,
  group: null,
});

const mocked = vi.mocked(local);

beforeEach(() => {
  vi.resetAllMocks();
  mocked.home.mockResolvedValue("/home/me");
  mocked.list.mockImplementation(async (path) =>
    path === "/home/me" ? [entry("src", "dir"), entry("notes.txt", "file")] : [],
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const panel = (props: Partial<Parameters<typeof LocalPanel>[0]> = {}) => (
  <DialogProvider>
    <LocalPanel cwd={null} follow={true} onFollowChange={() => {}} {...props} />
  </DialogProvider>
);

async function answer(question: string, button: string) {
  const dialog = await screen.findByRole("alertdialog", { name: question }).catch(() => screen.findByRole("dialog", { name: question }));
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

async function type(question: string, text: string) {
  const field = await screen.findByRole("textbox", { name: question });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
}

const menu = async (name: string, item: string) => {
  fireEvent.contextMenu(await screen.findByText(name));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

describe("LocalPanel", () => {
  it("starts in the home folder, enters folders and goes up", async () => {
    render(panel());
    fireEvent.doubleClick(await screen.findByText("src"));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith("/home/me/src"));
    expect((screen.getByLabelText("Local path") as HTMLInputElement).value).toBe("/home/me/src");
    fireEvent.click(screen.getByTitle("Up"));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith("/home/me"));
  });

  it("shows size and date only when Settings ask for them (L15)", async () => {
    mocked.list.mockResolvedValue([{ ...entry("notes.txt", "file"), size: 2048, modified: 1_700_000_000 }]);
    const { container, rerender } = render(panel());
    await screen.findByText("notes.txt");
    expect(container.querySelector(".sftp-row__size")).toBeNull();
    expect(container.querySelector(".sftp-row__date")).toBeNull();
    rerender(panel({ details: true }));
    expect(container.querySelector(".sftp-row__size")?.textContent).toBe("2.0 KB");
    expect(container.querySelector(".sftp-row__date")?.textContent).not.toBe("");
  });

  it("reports the folders the user opens, never those it follows (L16)", async () => {
    const onUserNavigate = vi.fn();
    const { rerender } = render(panel({ onUserNavigate }));
    fireEvent.doubleClick(await screen.findByText("src"));
    await waitFor(() => expect(onUserNavigate).toHaveBeenLastCalledWith("/home/me/src"));
    fireEvent.click(screen.getByTitle("Up"));
    await waitFor(() => expect(onUserNavigate).toHaveBeenLastCalledWith("/home/me"));
    const field = screen.getByLabelText("Local path");
    fireEvent.change(field, { target: { value: "/tmp" } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() => expect(onUserNavigate).toHaveBeenLastCalledWith("/tmp"));
    const before = onUserNavigate.mock.calls.length;
    rerender(panel({ onUserNavigate, cwd: "/var" }));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith("/var"));
    expect(onUserNavigate).toHaveBeenCalledTimes(before);
  });

  it("opens a file in its default program on double-click", async () => {
    render(panel());
    fireEvent.doubleClick(await screen.findByText("notes.txt"));
    await waitFor(() => expect(mocked.open).toHaveBeenCalledWith("/home/me/notes.txt", { kind: "default" }));
    expect(await screen.findByText("Opened notes.txt.")).toBeTruthy();
  });

  it("follows the terminal folder only while following is on", async () => {
    const { rerender } = render(panel({ cwd: "/home/me" }));
    await screen.findByText("notes.txt");
    expect(mocked.home).not.toHaveBeenCalled();
    rerender(panel({ cwd: "/tmp" }));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith("/tmp"));
    rerender(panel({ cwd: "/var", follow: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocked.list).not.toHaveBeenCalledWith("/var");
  });

  it("creates, renames and deletes entries, then lists the folder again", async () => {
    render(panel());
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    await type("New folder name", "docs");
    await waitFor(() => expect(mocked.mkdir).toHaveBeenCalledWith("/home/me/docs"));

    await menu("notes.txt", "Rename…");
    await type('Rename "notes.txt" to', "todo.txt");
    await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/todo.txt"));

    await menu("src", "Delete");
    await answer('Delete folder "src" and everything in it?', "Delete");
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith("/home/me/src", true));
    expect(mocked.list.mock.calls.filter(([p]) => p === "/home/me").length).toBeGreaterThanOrEqual(4);
  });

  it("refuses names with a separator", async () => {
    render(panel());
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    await type("New file name", "a/b");
    expect((await screen.findByRole("alert")).textContent).toBe('"a/b" is not a valid file name.');
    expect(mocked.createFile).not.toHaveBeenCalled();
  });

  it("shows the command's error", async () => {
    mocked.list.mockRejectedValue("cannot list /home/me: Permission denied");
    render(panel());
    expect((await screen.findByRole("alert")).textContent).toBe("cannot list /home/me: Permission denied");
  });

  it("copies a path and hands the raw path to the terminal", async () => {
    const onPathToTerminal = vi.fn();
    render(panel({ onPathToTerminal }));
    await menu("notes.txt", "Copy file path");
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/home/me/notes.txt"));
    await menu("notes.txt", "Copy file path to terminal");
    expect(onPathToTerminal).toHaveBeenCalledWith("/home/me/notes.txt");
  });

  it("opens a file with the text editor chosen in Settings", async () => {
    render(panel({ textEditor: "code -w" }));
    await menu("notes.txt", "Open with default text editor");
    await waitFor(() =>
      expect(mocked.open).toHaveBeenCalledWith("/home/me/notes.txt", { kind: "textEditor", command: "code -w" }),
    );
  });
});

describe("LocalPanel git status", () => {
  const git = { enabled: true, visible: true, prompt: 0 };

  it("colours entries like VS Code: the letter and tooltip on files, the colour and a dot on folders", async () => {
    mocked.gitStatus.mockResolvedValue([
      { path: "notes.txt", status: "modified" },
      { path: "src/new.ts", status: "untracked" },
    ]);
    render(panel({ devStyle: true, git }));
    const badge = await screen.findByTitle("Modified");
    expect(badge.textContent).toBe("M");
    expect(mocked.gitStatus).toHaveBeenCalledWith("/home/me");
    expect(screen.getByText("notes.txt").className).toContain("git--modified");
    const folder = screen.getByText("src");
    expect(folder.className).toContain("git--untracked");
    expect(screen.getByTitle("Untracked").textContent).toBe("●");
  });

  it("reads and shows nothing when the setting is off", async () => {
    mocked.gitStatus.mockResolvedValue([{ path: "notes.txt", status: "modified" }]);
    render(panel({ devStyle: true, git: { ...git, enabled: false } }));
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    expect(mocked.gitStatus).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Modified")).toBeNull();
    expect(screen.getByText("notes.txt").className).not.toContain("git--");
  });
});

describe("useShellCwd", () => {
  it("prefers OSC 7 and otherwise asks the backend every second while enabled", async () => {
    vi.useFakeTimers();
    mocked.shellCwd.mockResolvedValue("/srv");
    const { result, rerender } = renderHook(({ osc, on }) => useShellCwd(7, osc, on), {
      initialProps: { osc: null as string | null, on: true },
    });
    await act(async () => {});
    expect(result.current).toBe("/srv");
    expect(mocked.shellCwd).toHaveBeenCalledWith(7);
    mocked.shellCwd.mockResolvedValue("/srv/app");
    await act(async () => vi.advanceTimersByTime(SHELL_CWD_POLL_MS));
    expect(result.current).toBe("/srv/app");

    rerender({ osc: "/home/me", on: true });
    expect(result.current).toBe("/home/me");
    const calls = mocked.shellCwd.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(3 * SHELL_CWD_POLL_MS));
    expect(mocked.shellCwd.mock.calls.length).toBe(calls);

    rerender({ osc: null, on: false });
    await act(async () => vi.advanceTimersByTime(3 * SHELL_CWD_POLL_MS));
    expect(mocked.shellCwd.mock.calls.length).toBe(calls);
  });

  it("asks the given reader instead, e.g. the remote shell of an SSH session", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue("/home/remote");
    const calls = mocked.shellCwd.mock.calls.length;
    const { result } = renderHook(() => useShellCwd(3, null, true, read));
    await act(async () => {});
    expect(result.current).toBe("/home/remote");
    expect(read).toHaveBeenCalledWith(3);
    expect(mocked.shellCwd.mock.calls.length).toBe(calls);
  });
});

describe("LocalPanel file-type icons", () => {
  it("shows an icon for each entry's type at its left, keeping the icon's colour when git colours the name", async () => {
    render(panel({ devStyle: true }));
    const iconOf = async (name: string) => (await screen.findByText(name)).closest("li")!.querySelector<HTMLElement>("[data-icon]")!;
    expect((await iconOf("notes.txt")).dataset.icon).toBe("text");
    expect((await iconOf("src")).dataset.icon).toBe("folder");
    expect((await iconOf("src")).querySelector("svg")).toBeTruthy();
    expect((await iconOf("src")).className).not.toContain("git--");
  });
});

describe("LocalPanel tree", () => {
  const nested = (path: string) => path.split("/").slice(0, -1).join("/");
  beforeEach(() => {
    mocked.list.mockImplementation(async (path) => {
      if (path === "/home/me") return [entry("src", "dir"), entry("notes.txt", "file")];
      if (path === "/home/me/src") return [entry("lib", "dir", "/home/me/src"), entry("main.ts", "file", "/home/me/src")];
      if (path === "/home/me/src/lib") return [entry("x.rs", "file", "/home/me/src/lib")];
      return [];
    });
  });
  const row = (name: string) => screen.getByText(name).closest("li")!;

  it("expands and collapses a folder in place with a chevron, indenting its children", async () => {
    render(panel({ devStyle: true }));
    fireEvent.click(await screen.findByText("src"));
    expect(await screen.findByText("main.ts")).toBeTruthy();
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
    expect(row("main.ts").getAttribute("aria-level")).toBe("2");
    expect(row("main.ts").querySelectorAll(".tree-guide")).toHaveLength(1);
    // The root stays where it was.
    expect((screen.getByLabelText("Local path") as HTMLInputElement).value).toBe("/home/me");
    fireEvent.click(screen.getByText("src"));
    expect(screen.queryByText("main.ts")).toBeNull();
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
  });

  it("loads a folder's children once, when it is first expanded, with a loading and an error state", async () => {
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    expect(mocked.list).not.toHaveBeenCalledWith("/home/me/src");
    fireEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    fireEvent.click(screen.getByText("src"));
    fireEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    expect(mocked.list.mock.calls.filter((c) => c.includes("/home/me/src"))).toHaveLength(1);
    let fail: (e: unknown) => void = () => {};
    mocked.list.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    fireEvent.click(screen.getByText("lib"));
    expect(await screen.findByText("Loading…")).toBeTruthy();
    fail("cannot list /home/me/src/lib: denied");
    expect(await screen.findByText(/denied/)).toBeTruthy();
  });

  it("keeps the open folders when the list is refreshed", async () => {
    render(panel({ devStyle: true }));
    fireEvent.click(await screen.findByText("src"));
    await screen.findByText("main.ts");
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(mocked.list.mock.calls.filter((c) => c.includes("/home/me/src"))).toHaveLength(2));
    expect(screen.getByText("main.ts")).toBeTruthy();
    expect(row("src").getAttribute("aria-expanded")).toBe("true");
  });

  it("moves with the keyboard: Right opens and enters, Left leaves and closes, Up and Down move", async () => {
    render(panel({ devStyle: true }));
    const src = row(await screen.findByText("src").then((e) => e.textContent!));
    src.focus();
    fireEvent.keyDown(src, { key: "ArrowRight" });
    await screen.findByText("main.ts");
    fireEvent.keyDown(src, { key: "ArrowRight" });
    expect(document.activeElement).toBe(row("lib"));
    fireEvent.keyDown(row("lib"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("main.ts"));
    fireEvent.keyDown(row("main.ts"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(row("lib"));
    fireEvent.keyDown(row("lib"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(row("src"));
    fireEvent.keyDown(row("src"), { key: "ArrowLeft" });
    expect(screen.queryByText("main.ts")).toBeNull();
    fireEvent.keyDown(row("src"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(row("notes.txt"));
    expect(row("notes.txt").className).toContain("sftp-row--selected");
  });

  it("shows a dot on folders holding changes and the letter on the file", async () => {
    mocked.gitStatus.mockResolvedValue([{ path: "src/lib/x.rs", status: "modified" }]);
    render(panel({ devStyle: true, git: { enabled: true, visible: true, prompt: 0 } }));
    await waitFor(() => expect(row("src").querySelector(".sftp-row__git")?.textContent).toBe("●"));
    expect(mocked.gitStatus).toHaveBeenCalledWith("/home/me");
    fireEvent.click(screen.getByText("src"));
    fireEvent.click(await screen.findByText("lib"));
    await screen.findByText("x.rs");
    expect(row("lib").querySelector(".sftp-row__git")?.textContent).toBe("●");
    expect(row("x.rs").querySelector(".sftp-row__git")?.textContent).toBe("M");
    expect(row("x.rs").querySelector(".sftp-row__name")!.className).toContain("git--modified");
  });

  it("keeps the entry actions on nested entries: renaming stays in the entry's own folder", async () => {
    render(panel({ devStyle: true }));
    fireEvent.click(await screen.findByText("src"));
    fireEvent.contextMenu(await screen.findByText("main.ts"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    const field = await screen.findByRole("textbox", { name: 'Rename "main.ts" to' });
    fireEvent.change(field, { target: { value: "app.ts" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith("/home/me/src/main.ts", "/home/me/src/app.ts"));
    void nested;
  });
});

describe("LocalPanel Open in terminal", () => {
  it("offers Open in terminal right after Open on folders, never on files", async () => {
    const onOpenInTerminal = vi.fn();
    render(panel({ onOpenInTerminal }));
    fireEvent.contextMenu(await screen.findByText("src"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(0, 2)).toEqual(["Open", "Open in terminal"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    expect(onOpenInTerminal).toHaveBeenCalledWith("/home/me/src");
    fireEvent.contextMenu(screen.getByText("notes.txt"));
    expect(screen.queryByRole("menuitem", { name: "Open in terminal" })).toBeNull();
  });
});

describe("LocalPanel outside DEV mode", () => {
  it("keeps the plain list: generic icons, double-click enters folders, a click does not expand, no git call", async () => {
    mocked.gitStatus.mockResolvedValue([{ path: "notes.txt", status: "modified" }]);
    const { container } = render(panel({ git: { enabled: true, visible: true, prompt: 0 } }));
    const folder = await screen.findByText("src");
    const row = folder.closest("li")!;
    expect(row.querySelector(".sftp-row__icon")!.textContent).toBe("📁");
    expect(screen.getByText("notes.txt").closest("li")!.querySelector(".sftp-row__icon")!.textContent).toBe("📄");
    expect(container.querySelector("[role=tree], .tree-chevron, [data-icon], .sftp-row__git")).toBeNull();
    fireEvent.click(folder);
    expect(row.getAttribute("aria-expanded")).toBeNull();
    fireEvent.doubleClick(folder);
    await waitFor(() => expect(mocked.list.mock.lastCall!.slice(-1)[0]).toMatch(/\/src$/));
    await new Promise((r) => setTimeout(r, 10));
    expect(mocked.gitStatus).not.toHaveBeenCalled();
  });
});

