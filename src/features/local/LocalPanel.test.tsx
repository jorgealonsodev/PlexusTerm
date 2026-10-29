// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../dialogs/DialogProvider";
import type { SftpEntry } from "../sftp/sftpClient";
import { writeText } from "../terminal/clipboard";
import { open, save } from "@tauri-apps/plugin-dialog";
import { deliverDrop, setDropHandler } from "../drop/pathDrag";
import { FILE_LIST_REFRESH_MS, LocalPanel } from "./LocalPanel";
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
      move: vi.fn(),
      copy: vi.fn(),
      remove: vi.fn(),
      chmod: vi.fn(),
      open: vi.fn(),
      shellCwd: vi.fn(),
      gitStatus: vi.fn(),
      readText: vi.fn(),
      saveText: vi.fn(),
      viewText: vi.fn(),
      repoInfo: vi.fn(),
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
  mocked.repoInfo.mockResolvedValue(null);
  mocked.gitStatus.mockResolvedValue([]);
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

  it("goes to the terminal folder that arrives while the home folder is still being looked up", async () => {
    let homeFound: (home: string) => void = () => {};
    mocked.home.mockImplementationOnce(() => new Promise((resolve) => (homeFound = resolve)));
    const { rerender } = render(panel({ cwd: null }));
    rerender(panel({ cwd: "/tmp" }));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith("/tmp"));
    await act(async () => homeFound("/home/me"));
    expect(mocked.list).not.toHaveBeenCalledWith("/home/me");
    expect((screen.getByLabelText("Local path") as HTMLInputElement).value).toBe("/tmp");
  });

  it("shows DEV mode's Follow and Pin options as chips in one row, each a checkbox lit while on", async () => {
    const onFollowChange = vi.fn();
    const onPinnedChange = vi.fn();
    render(panel({ devStyle: true, follow: true, onFollowChange, pinned: false, onPinnedChange }));
    await screen.findByText("notes.txt");
    const follow = screen.getByRole("checkbox", { name: "Follow terminal folder" }) as HTMLInputElement;
    const pin = screen.getByRole("checkbox", { name: "Pin Explorer view" }) as HTMLInputElement;
    const chips = [follow.closest(".sftp__chip"), pin.closest(".sftp__chip")];
    expect(chips[0]?.textContent).toBe("Follow terminal");
    expect(chips[1]?.textContent).toBe("Pin view");
    expect(chips[0]?.parentElement).toBe(chips[1]?.parentElement);
    expect(chips[0]?.parentElement?.classList.contains("sftp__chips")).toBe(true);
    expect(follow.checked).toBe(true);
    expect(pin.checked).toBe(false);
    fireEvent.click(pin);
    expect(onPinnedChange).toHaveBeenCalledWith(true);
    fireEvent.click(follow);
    expect(onFollowChange).toHaveBeenCalledWith(false);
  });

  it("keeps the plain Follow terminal folder checkbox, and no Pin option, outside DEV mode", async () => {
    render(panel({ onPinnedChange: () => {} }));
    await screen.findByText("notes.txt");
    const follow = screen.getByRole("checkbox", { name: "Follow terminal folder" });
    expect(follow.closest(".sftp__chip")).toBeNull();
    expect(follow.closest("label")?.textContent).toBe("Follow terminal folder");
    expect(screen.queryByRole("checkbox", { name: "Pin Explorer view" })).toBeNull();
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
    // The file's letter; the root has its own dot.
    await waitFor(() => expect(within(screen.getByText("notes.txt").closest("li")!).getByTitle("Modified").textContent).toBe("M"));
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
    expect((await iconOf("notes.txt")).dataset.icon).toBe("_default");
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

  it("collapses every open folder and lists everything again from the DEV toolbar, as VS Code's Explorer", async () => {
    render(panel({ devStyle: true }));
    fireEvent.click(await screen.findByText("src"));
    fireEvent.click(await screen.findByText("lib"));
    expect(await screen.findByText("x.rs")).toBeTruthy();
    const calls = mocked.list.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh Explorer" }));
    // Listed again, the open folders too, which stay open.
    await waitFor(() => expect(mocked.list.mock.calls.length).toBeGreaterThanOrEqual(calls + 3));
    expect(screen.getByText("x.rs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Folders in Explorer" }));
    expect(screen.queryByText("main.ts")).toBeNull();
    expect(screen.queryByText("x.rs")).toBeNull();
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
  });

  it("has no collapse or refresh icons outside DEV mode", async () => {
    render(panel());
    await screen.findByText("src");
    expect(screen.queryByRole("button", { name: "Collapse Folders in Explorer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh Explorer" })).toBeNull();
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

  describe("DEV mode's menu, as VS Code's Explorer", () => {
    const items = () => screen.getAllByRole("menuitem").map((item) => [item.getAttribute("aria-label") ?? item.textContent, item.getAttribute("aria-keyshortcuts")]);

    it("lists VS Code's actions with their keys, then PlexusTerm's own", async () => {
      render(panel({ devStyle: true, onView: vi.fn(), onOpenInTerminal: vi.fn(), onPathToTerminal: vi.fn() }));
      fireEvent.contextMenu(await screen.findByText("notes.txt"));
      expect(items()).toEqual([
        ["Open to the Side", "Ctrl+Enter"],
        ["Open Containing Folder", "Ctrl+Alt+R"],
        ["Open with…", null],
        ["Open in Integrated Terminal", null],
        ["Cut", "Ctrl+X"],
        ["Copy", "Ctrl+C"],
        ["Paste", "Ctrl+V"],
        ["Copy file path", "Ctrl+Alt+C"],
        ["Copy Relative Path", "Ctrl+Shift+Alt+C"],
        ["Rename…", "F2"],
        ["Delete", "Del"],
        ["Open with default text editor", null],
        ["Copy file path to terminal", null],
        ["Properties", null],
        ["Permissions…", null],
      ]);
      expect(screen.getByRole("menuitem", { name: "Paste" }).hasAttribute("disabled")).toBe(true);
    });

    it("copies or cuts an entry and pastes it into a folder, a cut one only once", async () => {
      mocked.copy.mockResolvedValue("/home/me/src/notes.txt");
      mocked.move.mockResolvedValue("/home/me/src/notes.txt");
      render(panel({ devStyle: true }));
      await menu("notes.txt", "Copy");
      await menu("src", "Paste");
      await waitFor(() => expect(mocked.copy).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/src"));
      // A copy can be pasted again; into its own folder the backend names it "notes copy.txt".
      await menu("notes.txt", "Paste");
      await waitFor(() => expect(mocked.copy).toHaveBeenLastCalledWith("/home/me/notes.txt", "/home/me"));

      await menu("notes.txt", "Cut");
      await menu("src", "Paste");
      await waitFor(() => expect(mocked.move).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/src"));
      fireEvent.contextMenu(await screen.findByText("src"));
      expect(screen.getByRole("menuitem", { name: "Paste" }).hasAttribute("disabled")).toBe(true);
    });

    it("runs the same actions with VS Code's keys on the selected entry", async () => {
      const onView = vi.fn();
      render(panel({ devStyle: true, onView }));
      const row = (await screen.findByText("notes.txt")).closest("li")!;
      fireEvent.keyDown(row, { key: "Enter", ctrlKey: true });
      expect(onView).toHaveBeenCalledWith("/home/me/notes.txt");
      fireEvent.keyDown(row, { key: "C", ctrlKey: true, altKey: true, shiftKey: true });
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("notes.txt"));
      fireEvent.keyDown(row, { key: "c", ctrlKey: true, altKey: true });
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("/home/me/notes.txt"));
      fireEvent.keyDown(row, { key: "r", ctrlKey: true, altKey: true });
      await waitFor(() => expect(mocked.open).toHaveBeenCalledWith("/home/me", { kind: "default" }));
      fireEvent.keyDown(row, { key: "c", ctrlKey: true });
      fireEvent.keyDown((await screen.findByText("src")).closest("li")!, { key: "v", ctrlKey: true });
      await waitFor(() => expect(mocked.copy).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/src"));
      fireEvent.keyDown(row, { key: "Delete" });
      expect(await screen.findByText('Delete "notes.txt"?')).toBeTruthy();
    });
  });

  describe("renaming in place with F2, as VS Code does", () => {
    const field = () => screen.queryByRole("textbox", { name: 'Rename "notes.txt" to' }) as HTMLInputElement | null;
    const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
    it("does not rename on clicks: a click selects, and folders open and close as before", async () => {
      render(panel({ devStyle: true }));
      const name = await screen.findByText("notes.txt");
      fireEvent.click(name);
      fireEvent.click(name);
      const src = await screen.findByText("src");
      fireEvent.click(src);
      fireEvent.click(src);
      expect(src.closest("li")!.getAttribute("aria-expanded")).toBe("false");
      await wait(800);
      expect(document.querySelector(".sftp-row__rename")).toBeNull();
    });

    it("starts with F2; Escape or the same name renames nothing, leaving the field renames", async () => {
      render(panel({ devStyle: true }));
      const row = (await screen.findByText("notes.txt")).closest("li")!;
      fireEvent.keyDown(row, { key: "F2" });
      fireEvent.change(field()!, { target: { value: "other.txt" } });
      fireEvent.keyDown(field()!, { key: "Escape" });
      expect(field()).toBeNull();
      fireEvent.keyDown(row, { key: "F2" });
      fireEvent.keyDown(field()!, { key: "Enter" });
      fireEvent.keyDown(row, { key: "F2" });
      fireEvent.change(field()!, { target: { value: "blurred.txt" } });
      fireEvent.blur(field()!);
      await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/blurred.txt"));
      expect(mocked.rename).toHaveBeenCalledTimes(1);
    });
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
  it("keeps the plain list: its own icons, double-click enters folders, a click does not expand, no git call", async () => {
    mocked.gitStatus.mockResolvedValue([{ path: "notes.txt", status: "modified" }]);
    const { container } = render(panel({ git: { enabled: true, visible: true, prompt: 0 } }));
    const folder = await screen.findByText("src");
    const row = folder.closest("li")!;
    expect(row.querySelector(".sftp-row__icon")!.getAttribute("data-icon")).toBe("folder-src");
    expect(screen.getByText("notes.txt").closest("li")!.querySelector(".sftp-row__icon")!.getAttribute("data-icon")).toBe("document");
    expect(container.querySelector("[role=tree], .tree-chevron, .file-icon, .sftp-row__git")).toBeNull();
    fireEvent.click(folder);
    expect(row.getAttribute("aria-expanded")).toBeNull();
    fireEvent.doubleClick(folder);
    await waitFor(() => expect(mocked.list.mock.lastCall!.slice(-1)[0]).toMatch(/\/src$/));
    await new Promise((r) => setTimeout(r, 10));
    expect(mocked.gitStatus).not.toHaveBeenCalled();
  });
});

describe("workspace folders in DEV mode", () => {
  const listing = () =>
    mocked.list.mockImplementation(async (path) => {
      if (path === "/home/me") return [entry("src", "dir"), entry("notes.txt", "file")];
      if (path === "/work/api") return [entry("server.ts", "file", "/work/api")];
      return [];
    });

  it("adds a folder chosen in the system dialog, only in DEV mode", async () => {
    vi.mocked(open).mockResolvedValue("/work/api");
    const onAdd = vi.fn();
    const { unmount } = render(panel({ workspace: { folders: [], onAdd, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    expect(screen.queryByRole("button", { name: "Add folder" })).toBeNull();
    unmount();
    render(panel({ devStyle: true, workspace: { folders: [], onAdd, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("/work/api"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
  });

  it("collapses the workspace roots too when the workspace has several folders, as VS Code's Explorer", async () => {
    listing();
    render(panel({ devStyle: true, workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} } }));
    const main = await screen.findByRole("group", { name: "me" });
    const root = await screen.findByRole("group", { name: "api" });
    expect(await within(root).findByText("server.ts")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Folders in Explorer" }));
    expect(within(main).getByRole("button", { name: "me" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(root).getByRole("button", { name: "api" }).getAttribute("aria-expanded")).toBe("false");
    expect(within(main).queryByText("notes.txt")).toBeNull();
    expect(within(root).queryByText("server.ts")).toBeNull();
    // A root opened again shows its first level.
    fireEvent.click(within(root).getByRole("button", { name: "api" }));
    expect(await within(root).findByText("server.ts")).toBeTruthy();
  });

  it("opens Add Folder's dialog where the terminal is now, else at the listed folder", async () => {
    const workspace = { folders: [], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} };
    vi.mocked(open).mockResolvedValue(null);
    const { unmount } = render(
      panel({ devStyle: true, workspace: { ...workspace, terminalDir: () => Promise.resolve("/work/api/src") } }),
    );
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/work/api/src" })));
    unmount();
    render(panel({ devStyle: true, workspace: { ...workspace, terminalDir: () => Promise.resolve(null) } }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "/home/me" })));
  });

  it("does not add a folder when the dialog is cancelled or it is already there", async () => {
    const onAdd = vi.fn();
    render(panel({ devStyle: true, workspace: { folders: ["/work/api"], onAdd, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    vi.mocked(open).mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    vi.mocked(open).mockResolvedValueOnce("/work/api");
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows every folder as a VS Code workspace root once one is added: folds, git dot, remove from its menu", async () => {
    listing();
    mocked.gitStatus.mockImplementation(async (root) =>
      root === "/work/api" ? [{ path: "server.ts", status: "modified" }] : [],
    );
    const onRemove = vi.fn();
    render(
      panel({
        devStyle: true,
        git: { enabled: true, visible: true, prompt: 0 },
        workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove, onOpenFolders: () => {} },
      }),
    );
    // The main folder is a root too, first.
    const main = await screen.findByRole("group", { name: "me" });
    expect(await within(main).findByText("notes.txt")).toBeTruthy();
    const root = await screen.findByRole("group", { name: "api" });
    expect(main.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(root).findByText("server.ts")).toBeTruthy();
    await waitFor(() => expect(within(root).getByText("server.ts").className).toContain("git--modified"));
    expect(mocked.gitStatus).toHaveBeenCalledWith("/work/api");
    // Its title: chevron and name, and a dot coloured by what changed inside.
    const title = within(root).getByRole("button", { name: "api" });
    expect(title.getAttribute("aria-expanded")).toBe("true");
    const rootTitle = (group: HTMLElement) => group.querySelector<HTMLElement>(".workspace-root__title")!;
    expect(within(rootTitle(root)).getByTitle("Modified").textContent).toBe("●");
    expect(within(rootTitle(main)).queryByTitle("Modified")).toBeNull();
    fireEvent.click(title);
    expect(within(root).queryByText("server.ts")).toBeNull();
    expect(title.getAttribute("aria-expanded")).toBe("false");
    // Removed from its right-click menu.
    fireEvent.contextMenu(title, { clientX: 1, clientY: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove folder from workspace" }));
    expect(onRemove).toHaveBeenCalledWith("/work/api");
  });

  it("gives each root title the menu and the drag of a folder row", async () => {
    listing();
    const onRemove = vi.fn();
    const onPathToTerminal = vi.fn();
    render(
      panel({
        devStyle: true,
        onPathToTerminal,
        workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove, onOpenFolders: () => {} },
      }),
    );
    const main = await screen.findByRole("group", { name: "me" });
    const root = await screen.findByRole("group", { name: "api" });
    const title = (group: HTMLElement) => group.querySelector<HTMLElement>(".workspace-root__title")!;
    // The folder's own menu, and Remove folder from workspace.
    fireEvent.contextMenu(within(main).getByRole("button", { name: "me" }), { clientX: 1, clientY: 1 });
    expect(await screen.findByRole("menuitem", { name: "Copy file path" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Rename…" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Remove folder from workspace" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(within(root).getByRole("button", { name: "api" }), { clientX: 1, clientY: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy file path to terminal" }));
    expect(onPathToTerminal).toHaveBeenCalledWith("/work/api");
    fireEvent.contextMenu(within(root).getByRole("button", { name: "api" }), { clientX: 1, clientY: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove folder from workspace" }));
    expect(onRemove).toHaveBeenCalledWith("/work/api");
    // Dragged like a folder row: the drop gets the root as a folder.
    const drops: unknown[] = [];
    const stop = setDropHandler((drag) => drops.push(drag));
    document.elementFromPoint = () => null;
    fireEvent.pointerDown(title(root), { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 300 });
    expect(document.querySelector(".path-drag")?.textContent).toBe("api");
    fireEvent.pointerUp(window, { clientX: 400, clientY: 300 });
    stop();
    expect(drops).toEqual([{ origin: { kind: "local" }, paths: [{ path: "/work/api", isDir: true }] }]);
  });

  it("removes the main folder from the workspace: the first added one becomes the main folder", async () => {
    listing();
    const onRemove = vi.fn();
    render(panel({ devStyle: true, workspace: { folders: ["/work/api", "/work/web"], onAdd: () => {}, onRemove, onOpenFolders: () => {} } }));
    const main = await screen.findByRole("group", { name: "me" });
    fireEvent.contextMenu(within(main).getByRole("button", { name: "me" }), { clientX: 1, clientY: 1 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove folder from workspace" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("/work/api"));
    expect(mocked.list).toHaveBeenCalledWith("/work/api");
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: /path|folder/i }).value).toBe("/work/api");
  });

  it("shows the folder as a root even while no folder is added, without Remove folder from workspace", async () => {
    render(panel({ devStyle: true, workspace: { folders: [], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} } }));
    const main = await screen.findByRole("group", { name: "me" });
    expect(await within(main).findByText("notes.txt")).toBeTruthy();
    // It folds like any root.
    fireEvent.click(within(main).getByRole("button", { name: "me" }));
    expect(within(main).queryByText("notes.txt")).toBeNull();
    // Alone, it cannot leave the workspace.
    fireEvent.contextMenu(within(main).getByRole("button", { name: "me" }), { clientX: 1, clientY: 1 });
    await screen.findByRole("menuitem", { name: "Properties" });
    expect(screen.queryByRole("menuitem", { name: "Remove folder from workspace" })).toBeNull();
  });

  it("shows no added folders outside DEV mode", async () => {
    listing();
    render(panel({ workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    expect(screen.queryByRole("group", { name: "api" })).toBeNull();
  });

  it("saves the workspace (its folder first) to a VS Code workspace file", async () => {
    vi.mocked(save).mockResolvedValue("/home/me/me.code-workspace");
    mocked.saveText.mockResolvedValue(undefined);
    // A new file: there is nothing to read yet.
    mocked.readText.mockRejectedValueOnce("cannot read /home/me/me.code-workspace: not found");
    const onFile = vi.fn();
    render(panel({ devStyle: true, workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {}, onFile } }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() => expect(mocked.saveText).toHaveBeenCalled());
    // Saved, it is a recent workspace.
    await waitFor(() => expect(onFile).toHaveBeenCalledWith("/home/me/me.code-workspace"));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "/home/me/me.code-workspace", filters: [expect.objectContaining({ extensions: ["code-workspace"] })] }),
    );
    const [path, contents] = mocked.saveText.mock.calls[0];
    expect(path).toBe("/home/me/me.code-workspace");
    expect(JSON.parse(contents)).toEqual({ folders: [{ path: "." }, { path: "../../work/api" }], settings: {} });
  });

  it("saves over an existing workspace file keeping what it has besides the folders", async () => {
    vi.mocked(save).mockResolvedValue("/home/me/me.code-workspace");
    mocked.saveText.mockResolvedValue(undefined);
    mocked.readText.mockResolvedValueOnce('{\n\t"folders": [{ "path": "." }],\n\t"settings": { "a": 1 } // mine\n}');
    render(panel({ devStyle: true, workspace: { folders: ["/work/api"], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() => expect(mocked.saveText).toHaveBeenCalled());
    expect(mocked.readText).toHaveBeenCalledWith("/home/me/me.code-workspace");
    const contents = mocked.saveText.mock.calls[0][1] as string;
    expect(contents).toContain('"settings": { "a": 1 } // mine');
    expect(contents).toContain('"path": "../../work/api"');
  });

  it("opens the folders of a workspace file, and says so when it lists none", async () => {
    const onOpenFolders = vi.fn();
    render(panel({ devStyle: true, workspace: { folders: [], onAdd: () => {}, onRemove: () => {}, onOpenFolders } }));
    await screen.findByText("notes.txt");
    vi.mocked(open).mockResolvedValueOnce("/home/me/proj/app.code-workspace");
    mocked.readText.mockResolvedValueOnce('{ "folders": [ { "path": "." }, { "path": "../api" }, ] }');
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    await waitFor(() => expect(onOpenFolders).toHaveBeenCalledWith(["/home/me/proj", "/home/me/api"]));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, filters: [expect.objectContaining({ extensions: ["code-workspace"] })] }));

    vi.mocked(open).mockResolvedValueOnce("/home/me/notes.txt");
    mocked.readText.mockResolvedValueOnce("hello");
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    expect((await screen.findByRole("alert")).textContent).toContain("lists no folders");
    expect(onOpenFolders).toHaveBeenCalledTimes(1);
  });
});

describe("LocalPanel reveals a file (Ctrl+click on a path in the terminal)", () => {
  const selectedRow = () => document.querySelector('[aria-selected="true"]')?.textContent ?? null;

  it("opens the tree's folders down to a file under the listed folder and selects it", async () => {
    mocked.list.mockImplementation(async (path) => {
      if (path === "/home/me") return [entry("src", "dir"), entry("notes.txt", "file")];
      if (path === "/home/me/src") return [entry("lib", "dir", "/home/me/src")];
      if (path === "/home/me/src/lib") return [entry("x.ts", "file", "/home/me/src/lib")];
      return [];
    });
    mocked.stat.mockResolvedValue(entry("x.ts", "file", "/home/me/src/lib"));
    const { rerender } = render(panel({ devStyle: true }));
    await screen.findByText("notes.txt");
    rerender(panel({ devStyle: true, reveal: { path: "/home/me/src/lib/x.ts", id: 1 } }));
    expect(await screen.findByText("x.ts")).toBeTruthy();
    await waitFor(() => expect(selectedRow()).toContain("x.ts"));
    // The listed folder stays the same.
    expect(mocked.list).not.toHaveBeenCalledWith("/home/me/src/lib/x.ts");
  });

  it("goes to the folder of a file outside the listed folders and selects it", async () => {
    mocked.list.mockImplementation(async (path) =>
      path === "/home/me" ? [entry("notes.txt", "file")] : path === "/tmp/other" ? [entry("a.md", "file", "/tmp/other")] : [],
    );
    mocked.stat.mockResolvedValue(entry("a.md", "file", "/tmp/other"));
    const { rerender } = render(panel({ devStyle: true }));
    await screen.findByText("notes.txt");
    rerender(panel({ devStyle: true, reveal: { path: "/tmp/other/a.md", id: 1 } }));
    expect(await screen.findByText("a.md")).toBeTruthy();
    await waitFor(() => expect(selectedRow()).toContain("a.md"));
  });
});

describe("LocalPanel lists files created by the terminal", () => {
  it("lists the folder again while the terminal prints and when its prompt comes back, keeping the selection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listeners: ((text: string, echo?: boolean) => void)[] = [];
    const subscribeOutput = (listener: (text: string, echo?: boolean) => void) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    };
    const git = { enabled: false, visible: true, prompt: 0, subscribeOutput };
    const { rerender } = render(panel({ devStyle: true, git }));
    fireEvent.click(await screen.findByText("notes.txt"));
    const calls = () => mocked.list.mock.calls.filter(([path]) => path === "/home/me").length;
    const before = calls();
    // Nothing printed: nothing is read again.
    await act(() => vi.advanceTimersByTimeAsync(FILE_LIST_REFRESH_MS * 3));
    expect(calls()).toBe(before);
    mocked.list.mockImplementation(async (path) =>
      path === "/home/me" ? [entry("src", "dir"), entry("notes.txt", "file"), entry("PRD.md", "file")] : [],
    );
    // The echo of a key is not the terminal at work.
    act(() => listeners.forEach((listener) => listener("a", true)));
    await act(() => vi.advanceTimersByTimeAsync(FILE_LIST_REFRESH_MS));
    expect(calls()).toBe(before);
    act(() => listeners.forEach((listener) => listener("Wrote PRD.md")));
    await act(() => vi.advanceTimersByTimeAsync(FILE_LIST_REFRESH_MS));
    expect(await screen.findByText("PRD.md")).toBeTruthy();
    expect(screen.getByText("notes.txt").closest("[aria-selected]")?.getAttribute("aria-selected")).toBe("true");
    // A burst of output reads the folder once, not once per chunk.
    const once = calls();
    act(() => {
      for (let i = 0; i < 20; i++) listeners.forEach((listener) => listener("…"));
    });
    await act(() => vi.advanceTimersByTimeAsync(FILE_LIST_REFRESH_MS));
    expect(calls()).toBe(once + 1);
    rerender(panel({ devStyle: true, git: { ...git, prompt: 1 } }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls()).toBe(once + 2);
  });
});

describe("LocalPanel toolbar", () => {
  it("shows its actions, and DEV mode's workspace ones, as icons named by their tooltips", async () => {
    render(panel({ devStyle: true, workspace: { folders: [], onAdd: () => {}, onRemove: () => {}, onOpenFolders: () => {} } }));
    await screen.findByText("notes.txt");
    for (const name of ["New folder", "New file", "Rename", "Delete", "Add folder", "Save workspace", "Open workspace"]) {
      const button = screen.getByRole("button", { name });
      expect(button.title).toBe(name);
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("LocalPanel file viewer", () => {
  it("views a file from its menu; folders have no View item", async () => {
    const onView = vi.fn();
    render(panel({ onView }));
    fireEvent.contextMenu(await screen.findByText("notes.txt"), { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "View" }));
    expect(onView).toHaveBeenCalledWith(expect.stringMatching(/\/notes\.txt$/));
    fireEvent.contextMenu(screen.getByText("src"), { clientX: 1, clientY: 1 });
    expect(screen.queryByRole("menuitem", { name: "View" })).toBeNull();
  });

  it("views a double-clicked file in DEV mode, and opens it as before outside it", async () => {
    const onView = vi.fn();
    const { unmount } = render(panel({ onView, devStyle: true }));
    fireEvent.doubleClick(await screen.findByText("notes.txt"));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(mocked.open).not.toHaveBeenCalled();
    unmount();
    render(panel({ onView }));
    fireEvent.doubleClick(await screen.findByText("notes.txt"));
    expect(onView).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocked.open).toHaveBeenCalledWith("/home/me/notes.txt", { kind: "default" }));
  });
});

describe("LocalPanel repository of the selection", () => {
  const footer = () => document.querySelector<HTMLElement>(".explorer-repo");

  it("shows the selected file's project and branch under the list in DEV mode, with * for changes", async () => {
    mocked.repoInfo.mockResolvedValue({ root: "/home/me/PlexusTerm-landing", branch: "main", dirty: true });
    render(panel({ devStyle: true, git: { enabled: true, visible: true, prompt: 0 } }));
    await screen.findByText("notes.txt");
    expect(footer()).toBeNull();
    fireEvent.click(screen.getByText("notes.txt"));
    await waitFor(() => expect(footer()?.textContent).toBe("PlexusTerm-landingmain*"));
    // At the very bottom, in the row of the help icon, like the bar under the terminal.
    expect(footer()!.parentElement!.classList.contains("sidebar__help")).toBe(true);
    expect(mocked.repoInfo).toHaveBeenCalledWith("/home/me/notes.txt");
    expect(within(footer()!).getByTitle("/home/me/PlexusTerm-landing")).toBeTruthy();
    expect(within(footer()!).getByTitle("Branch main, with uncommitted changes")).toBeTruthy();
  });

  it("shows nothing outside a repository, and reads nothing outside DEV mode or with git status off", async () => {
    mocked.repoInfo.mockResolvedValue(null);
    const { unmount } = render(panel({ devStyle: true, git: { enabled: true, visible: true, prompt: 0 } }));
    fireEvent.click(await screen.findByText("notes.txt"));
    await waitFor(() => expect(mocked.repoInfo).toHaveBeenCalled());
    expect(footer()).toBeNull();
    unmount();
    mocked.repoInfo.mockClear();
    const plain = render(panel({ git: { enabled: true, visible: true, prompt: 0 } }));
    fireEvent.click(await screen.findByText("notes.txt"));
    plain.unmount();
    render(panel({ devStyle: true, git: { enabled: false, visible: true, prompt: 0 } }));
    fireEvent.click(await screen.findByText("notes.txt"));
    await new Promise((r) => setTimeout(r, 10));
    expect(mocked.repoInfo).not.toHaveBeenCalled();
  });

  it("keeps showing the repository while it is read again, without flickering", async () => {
    mocked.repoInfo.mockResolvedValue({ root: "/home/me/app", branch: "main", dirty: false });
    const { rerender } = render(panel({ devStyle: true, git: { enabled: true, visible: true, prompt: 0 } }));
    fireEvent.click(await screen.findByText("notes.txt"));
    await waitFor(() => expect(footer()?.textContent).toBe("appmain"));
    let answer: (info: { root: string; branch: string; dirty: boolean }) => void = () => {};
    mocked.repoInfo.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    rerender(panel({ devStyle: true, git: { enabled: true, visible: true, prompt: 1 } }));
    // The prompt came back: read again, the bar stays meanwhile.
    await waitFor(() => expect(mocked.repoInfo).toHaveBeenCalledTimes(2));
    expect(footer()?.textContent).toBe("appmain");
    await act(async () => answer({ root: "/home/me/app", branch: "main", dirty: true }));
    expect(footer()?.textContent).toBe("appmain*");
  });
});

/** As `answer`, waiting longer: these tests run while the whole suite loads the machine. */
async function answerSlow(question: string, button: string) {
  const dialog = await waitFor(
    () => {
      const [found] = [
        ...screen.queryAllByRole("dialog", { name: question }),
        ...screen.queryAllByRole("alertdialog", { name: question }),
      ];
      if (!found) throw new Error(`no dialog "${question}"`);
      return found;
    },
    { timeout: 10000 },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
}

// A loaded Windows runner can take over 3 s to show the dialog and move: wait up to 10 s.
describe("LocalPanel moves entries dropped on a folder (S2, S3)", { timeout: 15000 }, () => {
  beforeEach(() => {
    mocked.list.mockImplementation(async (path) => {
      if (path === "/home/me") return [entry("src", "dir"), entry("notes.txt", "file")];
      if (path === "/home/me/src") return [entry("main.ts", "file", "/home/me/src")];
      return [];
    });
    mocked.move.mockResolvedValue("/home/me/src/notes.txt");
  });
  const row = (name: string) => screen.getByText(name).closest("li")!;
  const local = (path: string, isDir = false) => ({ origin: { kind: "local" as const }, paths: [{ path, isDir }] });

  it("marks folders, files and the list as drop targets in DEV mode only", async () => {
    const { unmount } = render(panel({ devStyle: true }));
    await screen.findByText("src");
    expect(row("src").getAttribute("data-drop-dir")).toBe("/home/me/src");
    // A file stands for its own folder, as in VS Code.
    expect(row("notes.txt").getAttribute("data-drop-dir")).toBe("/home/me");
    expect(screen.getByRole("tree").getAttribute("data-drop-dir")).toBe("/home/me");
    unmount();
    render(panel({ devStyle: false }));
    await screen.findByText("src");
    expect(document.querySelector("[data-drop-dir]")).toBeNull();
  });

  it("asks before moving, then moves the entry and lists the folder again", async () => {
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    mocked.list.mockClear();
    act(() => deliverDrop(local("/home/me/notes.txt"), row("src")));
    await answerSlow('Move "notes.txt" into "src"?', "Move");
    await waitFor(() => expect(mocked.move).toHaveBeenCalledWith("/home/me/notes.txt", "/home/me/src"), { timeout: 10000 });
    await waitFor(() => expect(mocked.list).toHaveBeenCalledWith("/home/me"), { timeout: 10000 });
  });

  it("moves nothing when the question is cancelled", async () => {
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    act(() => deliverDrop(local("/home/me/notes.txt"), row("src")));
    await answerSlow('Move "notes.txt" into "src"?', "Cancel");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull(), { timeout: 10000 });
    expect(mocked.move).not.toHaveBeenCalled();
  });

  it("says why a move failed", async () => {
    mocked.move.mockRejectedValue("cannot move /home/me/notes.txt: /home/me/src/notes.txt already exists");
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    act(() => deliverDrop(local("/home/me/notes.txt"), row("src")));
    await answerSlow('Move "notes.txt" into "src"?', "Move");
    expect((await screen.findByRole("alert", undefined, { timeout: 10000 })).textContent).toBe(
      "cannot move /home/me/notes.txt: /home/me/src/notes.txt already exists",
    );
  });

  it("ignores drops that would move nothing and drops from an SSH session", async () => {
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    act(() => deliverDrop(local("/home/me/src", true), row("src")));
    act(() => deliverDrop(local("/home/me/notes.txt"), row("notes.txt")));
    act(() => deliverDrop({ origin: { kind: "sftp", sessionId: 1 }, paths: [{ path: "/srv/a", isDir: false }] }, row("src")));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocked.move).not.toHaveBeenCalled();
  });
});

describe("recent DEV mode folders", () => {
  it("lists the recent folders from the toolbar, only in DEV mode, and opens the one chosen", async () => {
    const onOpen = vi.fn();
    const recent = { folders: ["/work/app", "/work/api"], onOpen };
    const { unmount } = render(panel({ recent }));
    await screen.findByText("notes.txt");
    expect(screen.queryByRole("button", { name: "Open recent" })).toBeNull();
    unmount();
    render(panel({ devStyle: true, recent }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Open recent" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["/work/app", "/work/api"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "/work/api" }));
    expect(onOpen).toHaveBeenCalledWith("/work/api");
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("lists the recent workspace files first, apart, and opens the one chosen", async () => {
    const onOpenWorkspace = vi.fn();
    render(panel({ devStyle: true, recent: { folders: ["/work/app"], workspaces: ["/work/app.code-workspace"], onOpen: () => {}, onOpenWorkspace } }));
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Open recent" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["/work/app.code-workspace", "/work/app"]);
    expect(screen.getAllByRole("separator").length).toBe(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "/work/app.code-workspace" }));
    expect(onOpenWorkspace).toHaveBeenCalledWith("/work/app.code-workspace");
  });

  it("enables the button with only recent workspace files", async () => {
    render(panel({ devStyle: true, recent: { folders: [], workspaces: ["/work/app.code-workspace"], onOpen: () => {}, onOpenWorkspace: () => {} } }));
    await screen.findByText("notes.txt");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open recent" }).disabled).toBe(false);
  });

  it("disables the button while there are no recent folders", async () => {
    render(panel({ devStyle: true, recent: { folders: [], onOpen: () => {} } }));
    await screen.findByText("notes.txt");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Open recent" }).disabled).toBe(true);
  });
});
