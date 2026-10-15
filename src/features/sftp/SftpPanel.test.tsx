// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpPanel } from "./SftpPanel";
import { sftp, type SftpEntry } from "./sftpClient";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "../terminal/clipboard";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/clipboard", () => ({ writeText: vi.fn(), readText: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("./sftpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sftpClient")>();
  return {
    ...actual,
    sftp: {
      home: vi.fn(),
      list: vi.fn(),
      download: vi.fn(),
      upload: vi.fn(),
      mkdir: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
      chmod: vi.fn(),
      edit: vi.fn(),
      editUpload: vi.fn(),
      compare: vi.fn(),
    },
  };
});

const entry = (name: string, kind: SftpEntry["kind"], dir = "/home/u"): SftpEntry => ({
  name,
  path: `${dir}/${name}`,
  kind,
  size: 10,
  modified: null,
  permissions: null,
  uid: null,
  gid: null,
  user: null,
  group: null,
});

const mocked = vi.mocked(sftp);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listen).mockImplementation(async () => () => {});
  mocked.home.mockResolvedValue("/home/u");
  mocked.list.mockImplementation(async (_id, path) =>
    path === "/home/u"
      ? [entry("src", "dir"), entry("notes.txt", "file"), entry("my file.txt", "file")]
      : [],
  );
});

afterEach(cleanup);

const panel = (props: Partial<Parameters<typeof SftpPanel>[0]> = {}) => (
  <SftpPanel sessionId={1} cwd={null} follow={true} onFollowChange={() => {}} {...props} />
);

describe("SftpPanel", () => {
  it("starts in the home folder and enters a folder on double-click", async () => {
    render(panel());
    fireEvent.doubleClick(await screen.findByText("src"));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith(1, "/home/u/src"));
    expect((screen.getByLabelText("Remote path") as HTMLInputElement).value).toBe("/home/u/src");
  });

  it("follows the terminal folder only while following is on", async () => {
    const { rerender } = render(panel({ cwd: "/home/u" }));
    await screen.findByText("notes.txt");
    expect(mocked.home).not.toHaveBeenCalled();

    rerender(panel({ cwd: "/tmp" }));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith(1, "/tmp"));

    rerender(panel({ cwd: "/var", follow: false }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocked.list).not.toHaveBeenCalledWith(1, "/var");
  });

  it("shows errors inline and keeps the current listing", async () => {
    render(panel());
    await screen.findByText("notes.txt");
    mocked.list.mockRejectedValueOnce({ kind: "sftp", message: "cannot list /nope: No such file" });
    const input = screen.getByLabelText("Remote path");
    fireEvent.change(input, { target: { value: "/nope" } });
    fireEvent.submit(input);
    expect((await screen.findByRole("alert")).textContent).toBe("cannot list /nope: No such file");
    expect(screen.getByText("notes.txt")).toBeTruthy();
  });

  it("deletes the selected folder only after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(panel());
    fireEvent.click(await screen.findByText("src"));
    fireEvent.click(screen.getByText("Delete"));
    expect(mocked.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith(1, "/home/u/src", true));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});

const FILE_ONLY = ["Open with default text editor", "Open with default program", "Open with…", "Compare file with…"];
const COMMON = [
  "Open",
  "Download…",
  "Delete",
  "Rename…",
  "Copy file path",
  "Copy file path to terminal",
  "Properties",
  "Permissions…",
];

const menuItem = (name: string) => screen.getByRole("menuitem", { name }) as HTMLButtonElement;
const menuLabels = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

async function rightClick(name: string) {
  fireEvent.contextMenu(await screen.findByText(name));
  return screen.getByRole("menu");
}

describe("SftpPanel entry menu", () => {
  it("offers the common and file-only items on a file", async () => {
    render(panel({ onPathToTerminal: () => {} }));
    await rightClick("notes.txt");
    expect(menuLabels().sort()).toEqual([...COMMON, ...FILE_ONLY].sort());
    expect(screen.getAllByRole("menuitem").every((item) => !(item as HTMLButtonElement).disabled)).toBe(true);
  });

  it("offers only the common items on a folder, without Download", async () => {
    render(panel({ onPathToTerminal: () => {} }));
    await rightClick("src");
    expect(menuLabels().sort()).toEqual([...COMMON].sort());
    expect(menuItem("Download…").disabled).toBe(true);
  });

  it("Open enters a folder", async () => {
    render(panel());
    await rightClick("src");
    fireEvent.click(menuItem("Open"));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith(1, "/home/u/src"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Open and Download… download a file to the chosen place", async () => {
    vi.mocked(save).mockResolvedValue("/local/notes.txt");
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open"));
    await waitFor(() => expect(mocked.download).toHaveBeenCalledWith(1, "/home/u/notes.txt", "/local/notes.txt"));
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Download…"));
    await waitFor(() => expect(mocked.download).toHaveBeenCalledTimes(2));
  });

  it("Delete asks first and removes the entry", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Delete"));
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith(1, "/home/u/notes.txt", false));
    expect(confirm).toHaveBeenCalledWith('Delete "notes.txt"?');
    confirm.mockRestore();
  });

  it("Rename… renames the clicked entry", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("todo.txt");
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Rename…"));
    await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith(1, "/home/u/notes.txt", "/home/u/todo.txt"));
    prompt.mockRestore();
  });

  it("Copy file path puts the absolute path on the clipboard", async () => {
    render(panel());
    await rightClick("my file.txt");
    fireEvent.click(menuItem("Copy file path"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/home/u/my file.txt"));
  });

  it("Copy file path to terminal sends the quoted path, and middle click does the same", async () => {
    const toTerminal = vi.fn();
    render(panel({ onPathToTerminal: toTerminal }));
    await rightClick("my file.txt");
    fireEvent.click(menuItem("Copy file path to terminal"));
    expect(toTerminal).toHaveBeenLastCalledWith("'/home/u/my file.txt'");

    fireEvent(screen.getByText("notes.txt"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(toTerminal).toHaveBeenLastCalledWith("/home/u/notes.txt");
    fireEvent(screen.getByText("notes.txt"), new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(toTerminal).toHaveBeenCalledTimes(2);
  });

  it("disables Copy file path to terminal without a terminal", async () => {
    render(panel());
    await rightClick("notes.txt");
    expect(menuItem("Copy file path to terminal").disabled).toBe(true);
  });

  it("Properties shows the entry details", async () => {
    mocked.list.mockResolvedValue([
      {
        ...entry("run.sh", "file"),
        size: 2048,
        modified: 1_700_000_000,
        permissions: 0o4755,
        uid: 1000,
        gid: 100,
        user: "jo",
        group: null,
      },
    ]);
    render(panel());
    await rightClick("run.sh");
    fireEvent.click(menuItem("Properties"));
    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    for (const part of ["run.sh", "/home/u/run.sh", "File", "2.0 KB (2048 bytes)", "jo (1000)", "100", "rwsr-xr-x (4755)"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain(new Date(1_700_000_000 * 1000).toLocaleString());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Permissions… keeps checkboxes and octal in sync and applies chmod", async () => {
    mocked.list.mockResolvedValue([{ ...entry("run.sh", "file"), permissions: 0o4644 }]);
    render(panel());
    await rightClick("run.sh");
    fireEvent.click(menuItem("Permissions…"));
    const octal = screen.getByLabelText("Octal") as HTMLInputElement;
    const box = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
    expect(octal.value).toBe("4644");
    expect([box("Owner read").checked, box("Owner write").checked, box("Owner execute").checked]).toEqual([true, true, false]);

    fireEvent.click(box("Owner execute"));
    fireEvent.click(box("Group write"));
    expect(octal.value).toBe("4764");

    fireEvent.change(octal, { target: { value: "750" } });
    expect([box("Group read").checked, box("Group execute").checked, box("Others read").checked]).toEqual([true, true, false]);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocked.chmod).toHaveBeenCalledWith(1, "/home/u/run.sh", 0o750));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Permissions… shows chmod errors and rejects invalid octal values", async () => {
    mocked.chmod.mockRejectedValue({ kind: "sftp", message: "cannot change permissions of /home/u/notes.txt: Permission denied" });
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Permissions…"));
    const octal = screen.getByLabelText("Octal") as HTMLInputElement;
    fireEvent.change(octal, { target: { value: "9" } });
    expect(screen.getByRole("alert").textContent).toBe("Enter one to four octal digits (0-7).");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(octal, { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "cannot change permissions of /home/u/notes.txt: Permission denied",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

describe("SftpPanel open and compare", () => {
  it("opens a file with the default text editor or program", async () => {
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with default text editor"));
    await waitFor(() => expect(mocked.edit).toHaveBeenCalledWith(1, "/home/u/notes.txt", { kind: "textEditor" }));
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with default program"));
    await waitFor(() => expect(mocked.edit).toHaveBeenLastCalledWith(1, "/home/u/notes.txt", { kind: "default" }));
  });

  it("Open with… opens the file with the chosen program", async () => {
    vi.mocked(open).mockResolvedValueOnce("/usr/bin/vim").mockResolvedValueOnce(null);
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with…"));
    await waitFor(() =>
      expect(mocked.edit).toHaveBeenCalledWith(1, "/home/u/notes.txt", { kind: "program", path: "/usr/bin/vim" }),
    );
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with…"));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocked.edit).toHaveBeenCalledTimes(1);
  });

  it("Compare file with… compares with the chosen local file and shows errors", async () => {
    vi.mocked(open).mockResolvedValue("/local/notes.txt");
    mocked.compare.mockRejectedValueOnce({
      kind: "sftp",
      message: "No diff tool found: install Meld, KDiff3, Kompare or Visual Studio Code.",
    });
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Compare file with…"));
    await waitFor(() => expect(mocked.compare).toHaveBeenCalledWith(1, "/home/u/notes.txt", "/local/notes.txt"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "No diff tool found: install Meld, KDiff3, Kompare or Visual Studio Code.",
    );
  });

});
