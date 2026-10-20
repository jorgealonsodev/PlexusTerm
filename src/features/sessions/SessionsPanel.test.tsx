// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { emptyLibrary, libraryReducer, type SavedSession } from "./library";
import { SessionsPanel } from "./SessionsPanel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const clipboard = vi.hoisted(() => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../terminal/clipboard", () => clipboard);

const web: SavedSession = {
  id: "1",
  name: "web",
  folder: "Prod",
  host: "10.0.0.1",
  port: 22,
  username: "u",
  auth: { method: "agent" },
};
const library = libraryReducer(emptyLibrary, { type: "saveSession", session: web });

function renderPanel(overrides: Partial<Parameters<typeof SessionsPanel>[0]> = {}) {
  const props = {
    library,
    status: { state: "ready" as const },
    saveError: null,
    onOpen: vi.fn(),
    onNewSession: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onNewFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onImport: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  };
  render(<SessionsPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("SessionsPanel", () => {
  it("opens a session on double-click and on Enter", () => {
    const props = renderPanel();
    const row = screen.getByTitle("u@10.0.0.1:22");
    fireEvent.doubleClick(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalledTimes(2);
    expect(props.onOpen).toHaveBeenCalledWith({ ...web, kind: "ssh" });
  });

  it("opens a serial session on double-click; its tooltip shows the device", () => {
    const withSerial = libraryReducer(library, {
      type: "saveSession",
      session: {
        kind: "serial",
        id: "2",
        name: "switch",
        folder: "Prod",
        path: "/dev/ttyUSB0",
        baud: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flow: "none",
      },
    });
    const props = renderPanel({ library: withSerial });
    fireEvent.doubleClick(screen.getByTitle("/dev/ttyUSB0 @ 9600"));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ kind: "serial", id: "2" }));
  });

  it("shows an icon for each session type and for folders", () => {
    const withMore = [
      { kind: "serial" as const, id: "2", name: "switch", folder: "Prod", path: "/dev/ttyUSB0", baud: 9600, dataBits: 8 as const, parity: "none" as const, stopBits: 1 as const, flow: "none" as const },
      { kind: "telnet" as const, id: "3", name: "router", folder: "Prod", host: "10.0.0.9", port: 23 },
      { kind: "local" as const, id: "4", name: "dev shell", folder: "Prod", program: "/usr/bin/fish", cwd: "~/src" },
      { kind: "local" as const, id: "5", name: "plain", folder: "Prod" },
    ].reduce((lib, session) => libraryReducer(lib, { type: "saveSession", session }), library);
    const { container } = render(
      <SessionsPanel
        library={withMore}
        status={{ state: "ready" }}
        saveError={null}
        onOpen={vi.fn()}
        onNewSession={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onNewFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onImport={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );
    const iconOf = (name: string) =>
      screen.getByText(name).closest(".tree-row")!.querySelector("svg.tree-row__icon")?.getAttribute("data-kind");
    expect(iconOf("web")).toBe("ssh");
    expect(iconOf("switch")).toBe("serial");
    expect(iconOf("router")).toBe("telnet");
    expect(iconOf("dev shell")).toBe("local");
    expect(screen.getByTitle("/usr/bin/fish in ~/src")).toBeTruthy();
    expect(screen.getByTitle("System default shell")).toBeTruthy();
    expect(container.querySelector(".tree-row--folder svg.tree-row__icon")?.getAttribute("data-kind")).toBe("folder");
  });

  it("copies an SSH session as the ssh command that connects to it, with its own key", () => {
    renderPanel();
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy SSH command" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("ssh -p 22 u@10.0.0.1");
    cleanup();
    const keyed: SavedSession = { ...web, id: "2", name: "keyed", port: 2222, auth: { method: "key", path: "~/.ssh/id_work" } };
    renderPanel({ library: libraryReducer(emptyLibrary, { type: "saveSession", session: keyed }) });
    fireEvent.contextMenu(screen.getByText("keyed"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy SSH command" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("ssh -p 2222 -i ~/.ssh/id_work u@10.0.0.1");
    cleanup();
    const spaced: SavedSession = { ...keyed, id: "3", name: "spaced", auth: { method: "key", path: "/home/me/my keys/id" } };
    renderPanel({ library: libraryReducer(emptyLibrary, { type: "saveSession", session: spaced }) });
    fireEvent.contextMenu(screen.getByText("spaced"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy SSH command" }));
    expect(clipboard.writeText).toHaveBeenLastCalledWith("ssh -p 2222 -i '/home/me/my keys/id' u@10.0.0.1");
  });

  it("opens a session menu on right click: connect, edit, duplicate, delete", () => {
    const props = renderPanel();
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Connect",
      "Copy SSH command",
      "Edit…",
      "Duplicate",
      "Delete",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(props.onDuplicate).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Connect" }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit…" }));
    expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("opens a folder menu on right click: new session, new folder, connect all, delete", () => {
    const props = renderPanel();
    fireEvent.contextMenu(screen.getByText("Prod"), { clientX: 5, clientY: 5 });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "New session here…",
      "New folder here…",
      "Connect all (1)",
      "Delete folder",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "New session here…" }));
    expect(props.onNewSession).toHaveBeenCalledWith("Prod");
    fireEvent.contextMenu(screen.getByText("Prod"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "New folder here…" }));
    expect(props.onNewFolder).toHaveBeenCalledWith("Prod");
    fireEvent.contextMenu(screen.getByText("Prod"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Connect all (1)" }));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
    fireEvent.contextMenu(screen.getByText("Prod"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    expect(props.onDeleteFolder).toHaveBeenCalledWith("Prod");
  });

  it("offers only Connect and copying in the session menu while the library cannot be edited", () => {
    renderPanel({ status: { state: "error", message: "broken" } });
    fireEvent.contextMenu(screen.getByText("web"), { clientX: 5, clientY: 5 });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Connect", "Copy SSH command"]);
  });

  it("collapses a folder when its row is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Prod"));
    expect(screen.queryByText("web")).toBeNull();
  });

  it("filters sessions by host", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Search sessions"), { target: { value: "nomatch" } });
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("imports new sessions from a sessions .ini file after the preview", async () => {
    const props = renderPanel();
    const ini = "[Bookmarks]\r\nSubRep=Prod\r\nrdp=#1#0%10.0.0.1%3389%\r\nnew=#109#0%10.0.0.2%%root%\r\n";
    vi.mocked(open).mockResolvedValue("/home/u/sessions.ini");
    vi.mocked(invoke).mockResolvedValue(Array.from(new TextEncoder().encode(ini)));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From an .ini file…" }));
    expect(await screen.findByText("1 session to import.")).toBeTruthy();
    fireEvent.click(screen.getByText("Import 1 session"));
    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onImport).mock.calls[0][0]).toMatchObject([
      { name: "new", folder: "Imported/Prod", host: "10.0.0.2", port: 22, username: "root", auth: { method: "password" } },
    ]);
    expect(screen.queryByText("Import 1 session")).toBeNull();
  });

  it("reads the file picked in the native dialog through the backend", async () => {
    renderPanel();
    vi.mocked(open).mockResolvedValue("/home/u/sessions.ini");
    vi.mocked(invoke).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From an .ini file…" }));
    expect(await screen.findByText("No sessions to import.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("import_read_file", { path: "/home/u/sessions.ini" });
  });

  it("imports the hosts of ~/.ssh/config, keeping key auth and jump hosts", async () => {
    const props = renderPanel();
    const config = "Host bastion\n  HostName 1.2.3.4\n  User admin\n  IdentityFile ~/.ssh/id_b\nHost app\n  ProxyJump bastion\n";
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "local_home" ? "/home/u" : Array.from(new TextEncoder().encode(config)),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From ~/.ssh/config" }));
    expect(await screen.findByText("2 sessions to import.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("import_read_file", { path: "/home/u/.ssh/config" });
    fireEvent.click(screen.getByText("Import 2 sessions"));
    const [bastion, app] = vi.mocked(props.onImport).mock.calls[0][0];
    expect(bastion).toMatchObject({
      name: "bastion",
      folder: "Imported/SSH config",
      host: "1.2.3.4",
      username: "admin",
      auth: { method: "key", path: "~/.ssh/id_b" },
    });
    expect(app).toMatchObject({ name: "app", host: "app", auth: { method: "password" }, jumpIds: [bastion.id] });
  });

  it("shows the read error when ~/.ssh/config cannot be read", async () => {
    renderPanel();
    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "local_home") return "/home/u";
      throw "/home/u/.ssh/config: No such file or directory (os error 2)";
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From ~/.ssh/config" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Could not read the file: /home/u/.ssh/config: No such file or directory (os error 2)",
    );
  });

  it("does nothing when the dialog is cancelled", async () => {
    renderPanel();
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(invoke).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "From an .ini file…" }));
    await Promise.resolve();
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables editing and explains why when the file could not be read", () => {
    renderPanel({ status: { state: "error", message: "bad json" } });
    expect(screen.getByText(/Editing is disabled/)).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByText("Import")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });
});
