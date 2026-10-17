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
