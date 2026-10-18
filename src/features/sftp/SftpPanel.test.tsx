// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../dialogs/DialogProvider";
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
      createFile: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
      chmod: vi.fn(),
      edit: vi.fn(),
      editUpload: vi.fn(),
      compare: vi.fn(),
      gitStatus: vi.fn(),
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
  <DialogProvider>
    <SftpPanel sessionId={1} cwd={null} follow={true} onFollowChange={() => {}} {...props} />
  </DialogProvider>
);

/** Answers the in-app dialog asking `question` by pressing `button`. */
async function answer(question: string, button: string) {
  const find = () => [
    ...screen.queryAllByRole("dialog", { name: question }),
    ...screen.queryAllByRole("alertdialog", { name: question }),
  ];
  const dialog = await waitFor(() => {
    const [found] = find();
    if (!found) throw new Error(`no dialog "${question}"`);
    return found;
  });
  fireEvent.click(within(dialog).getByRole("button", { name: button }));
  await waitFor(() => expect(find()).toEqual([]));
}

/** Types `text` into the in-app prompt labelled `question` and submits it. */
async function type(question: string, text: string) {
  const field = await screen.findByRole("textbox", { name: question });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Enter" });
}

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
    render(panel());
    fireEvent.click(await screen.findByText("src"));
    const question = 'Delete folder "src"? Only empty folders can be deleted.';
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: question });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await answer(question, "Cancel");
    expect(mocked.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await answer(question, "Delete");
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith(1, "/home/u/src", true));
  });

  it("creates a folder with the typed name, and nothing when cancelled", async () => {
    render(panel());
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    await answer("New folder name", "Cancel");
    expect(mocked.mkdir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    await type("New folder name", " docs ");
    await waitFor(() => expect(mocked.mkdir).toHaveBeenCalledWith(1, "/home/u/docs"));
  });

  it("creates an empty file with the typed name, and nothing when cancelled", async () => {
    render(panel());
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    await answer("New file name", "Cancel");
    expect(mocked.createFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New file" }));
    await type("New file name", " todo.md ");
    await waitFor(() => expect(mocked.createFile).toHaveBeenCalledWith(1, "/home/u/todo.md"));
  });

  it("asks before replacing files on upload and uploads only when accepted", async () => {
    vi.mocked(open).mockResolvedValue(["/local/notes.txt"]);
    render(panel());
    await screen.findByText("notes.txt");
    const question = "Replace notes.txt in /home/u?";
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await answer(question, "Cancel");
    expect(mocked.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await answer(question, "Replace");
    await waitFor(() => expect(mocked.upload).toHaveBeenCalledWith(1, "/local/notes.txt", "/home/u"));
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

  it("offers only the common items on a folder, plus Open in terminal, without Download", async () => {
    render(panel({ onPathToTerminal: () => {} }));
    await rightClick("src");
    expect(menuLabels().sort()).toEqual([...COMMON, "Open in terminal"].sort());
    expect(menuItem("Download…").disabled).toBe(true);
  });

  it("Open enters a folder", async () => {
    render(panel());
    await rightClick("src");
    fireEvent.click(menuItem("Open"));
    await waitFor(() => expect(mocked.list).toHaveBeenLastCalledWith(1, "/home/u/src"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Open opens a file with the default program; Download… downloads it", async () => {
    vi.mocked(save).mockResolvedValue("/local/notes.txt");
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open"));
    await waitFor(() => expect(mocked.edit).toHaveBeenCalledWith(1, "/home/u/notes.txt", { kind: "default" }));
    expect(save).not.toHaveBeenCalled();
    expect(mocked.download).not.toHaveBeenCalled();
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Download…"));
    await waitFor(() => expect(mocked.download).toHaveBeenCalledWith(1, "/home/u/notes.txt", "/local/notes.txt"));
  });

  it("Delete asks first and removes the entry", async () => {
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Delete"));
    await answer('Delete "notes.txt"?', "Delete");
    await waitFor(() => expect(mocked.remove).toHaveBeenCalledWith(1, "/home/u/notes.txt", false));
  });

  it("Rename… renames the clicked entry, starting from its name, and nothing when cancelled", async () => {
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Rename…"));
    expect(((await screen.findByRole("textbox", { name: 'Rename "notes.txt" to' })) as HTMLInputElement).value).toBe(
      "notes.txt",
    );
    await answer('Rename "notes.txt" to', "Cancel");
    expect(mocked.rename).not.toHaveBeenCalled();
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Rename…"));
    await type('Rename "notes.txt" to', "todo.txt");
    await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith(1, "/home/u/notes.txt", "/home/u/todo.txt"));
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

  it("opens a file with the text editor chosen in Settings", async () => {
    render(panel({ textEditor: "code --wait" }));
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with default text editor"));
    await waitFor(() =>
      expect(mocked.edit).toHaveBeenCalledWith(1, "/home/u/notes.txt", { kind: "textEditor", command: "code --wait" }),
    );
  });

  it("Open with… opens the file with the chosen program", async () => {
    vi.mocked(open).mockResolvedValueOnce("/usr/bin/vim").mockResolvedValueOnce(null);
    render(panel());
    await rightClick("notes.txt");
    fireEvent.click(menuItem("Open with…"));
    await waitFor(() =>
      expect(mocked.edit).toHaveBeenCalledWith(1, "/home/u/notes.txt", { kind: "program", path: "/usr/bin/vim" }),
    );
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/usr/bin" }));
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

describe("SftpPanel git status", () => {
  const git = { enabled: true, visible: true, prompt: 0 };

  it("reads the status over the SSH session and colours files and folders", async () => {
    mocked.gitStatus.mockResolvedValue([
      { path: "notes.txt", status: "indexAdded" },
      { path: "src/deep/x.c", status: "bothModified" },
      { path: "my file.txt", status: "ignored" },
    ]);
    render(panel({ devStyle: true, git }));
    expect((await screen.findByTitle("Added")).textContent).toBe("A");
    expect(mocked.gitStatus).toHaveBeenCalledWith(1, "/home/u");
    expect(screen.getByText("src").className).toContain("git--conflicting");
    expect(screen.getByTitle("Conflict").textContent).toBe("●");
    expect(screen.getByText("my file.txt").closest("li")!.className).toContain("sftp-row--faded");
  });

  it("reads and shows nothing when the setting is off", async () => {
    mocked.gitStatus.mockResolvedValue([{ path: "notes.txt", status: "modified" }]);
    render(panel({ devStyle: true, git: { ...git, enabled: false } }));
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    expect(mocked.gitStatus).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Modified")).toBeNull();
  });
});

describe("SftpPanel file-type icons", () => {
  it("shows an icon for each entry's type at its left, keeping the icon's colour when git colours the name", async () => {
    render(panel({ devStyle: true }));
    const iconOf = async (name: string) => (await screen.findByText(name)).closest("li")!.querySelector<HTMLElement>("[data-icon]")!;
    expect((await iconOf("notes.txt")).dataset.icon).toBe("_default");
    expect((await iconOf("src")).dataset.icon).toBe("folder");
    expect((await iconOf("src")).querySelector("svg")).toBeTruthy();
    expect((await iconOf("src")).className).not.toContain("git--");
  });
});

describe("SftpPanel tree", () => {
  const nested = (path: string) => path.split("/").slice(0, -1).join("/");
  beforeEach(() => {
    mocked.list.mockImplementation(async (_id, path) => {
      if (path === "/home/u") return [entry("src", "dir"), entry("notes.txt", "file")];
      if (path === "/home/u/src") return [entry("lib", "dir", "/home/u/src"), entry("main.ts", "file", "/home/u/src")];
      if (path === "/home/u/src/lib") return [entry("x.rs", "file", "/home/u/src/lib")];
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
    expect((screen.getByLabelText("Remote path") as HTMLInputElement).value).toBe("/home/u");
    fireEvent.click(screen.getByText("src"));
    expect(screen.queryByText("main.ts")).toBeNull();
    expect(row("src").getAttribute("aria-expanded")).toBe("false");
  });

  it("loads a folder's children once, when it is first expanded, with a loading and an error state", async () => {
    render(panel({ devStyle: true }));
    await screen.findByText("src");
    expect(mocked.list).not.toHaveBeenCalledWith(1, "/home/u/src");
    fireEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    fireEvent.click(screen.getByText("src"));
    fireEvent.click(screen.getByText("src"));
    await screen.findByText("main.ts");
    expect(mocked.list.mock.calls.filter((c) => c.includes("/home/u/src"))).toHaveLength(1);
    let fail: (e: unknown) => void = () => {};
    mocked.list.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
    fireEvent.click(screen.getByText("lib"));
    expect(await screen.findByText("Loading…")).toBeTruthy();
    fail("cannot list /home/u/src/lib: denied");
    expect(await screen.findByText(/denied/)).toBeTruthy();
  });

  it("keeps the open folders when the list is refreshed", async () => {
    render(panel({ devStyle: true }));
    fireEvent.click(await screen.findByText("src"));
    await screen.findByText("main.ts");
    fireEvent.click(screen.getByTitle("Refresh"));
    await waitFor(() => expect(mocked.list.mock.calls.filter((c) => c.includes("/home/u/src"))).toHaveLength(2));
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
    expect(mocked.gitStatus).toHaveBeenCalledWith(1, "/home/u");
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
    await waitFor(() => expect(mocked.rename).toHaveBeenCalledWith(1, "/home/u/src/main.ts", "/home/u/src/app.ts"));
    void nested;
  });
});

describe("SftpPanel Open in terminal", () => {
  it("offers Open in terminal right after Open on folders, never on files", async () => {
    const onOpenInTerminal = vi.fn();
    render(panel({ onOpenInTerminal }));
    fireEvent.contextMenu(await screen.findByText("src"));
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(0, 2)).toEqual(["Open", "Open in terminal"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in terminal" }));
    expect(onOpenInTerminal).toHaveBeenCalledWith("/home/u/src");
    fireEvent.contextMenu(screen.getByText("notes.txt"));
    expect(screen.queryByRole("menuitem", { name: "Open in terminal" })).toBeNull();
  });
});

describe("SftpPanel outside DEV mode", () => {
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

describe("SftpPanel toolbar", () => {
  it("shows its actions as icons named by their tooltips", async () => {
    render(panel());
    for (const name of ["Upload", "New folder", "New file", "Rename", "Delete", "Download"]) {
      const button = screen.getByRole("button", { name });
      expect(button.title).toBe(name);
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("SftpPanel file viewer", () => {
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
    expect(mocked.download).not.toHaveBeenCalled();
    unmount();
    render(panel({ onView }));
    fireEvent.doubleClick(await screen.findByText("notes.txt"));
    expect(onView).toHaveBeenCalledTimes(1);
    // Outside DEV mode a double-clicked file is downloaded, as before.
    await waitFor(() => expect(save).toHaveBeenCalled());
  });
});

