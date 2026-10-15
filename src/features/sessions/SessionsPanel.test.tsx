// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { emptyLibrary, libraryReducer, type SavedSession } from "./library";
import { SessionsPanel } from "./SessionsPanel";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

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
      />,
    );
    const iconOf = (name: string) =>
      screen.getByText(name).closest(".tree-row")!.querySelector("svg.tree-row__icon")?.getAttribute("data-kind");
    expect(iconOf("web")).toBe("ssh");
    expect(iconOf("switch")).toBe("serial");
    expect(iconOf("router")).toBe("telnet");
    expect(container.querySelector(".tree-row--folder svg.tree-row__icon")?.getAttribute("data-kind")).toBe("folder");
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

  it("imports new sessions from a MobaXterm.ini file after the preview", async () => {
    const props = renderPanel();
    const ini = "[Bookmarks]\r\nSubRep=Prod\r\nrdp=#1#0%10.0.0.1%3389%\r\nnew=#109#0%10.0.0.2%%root%\r\n";
    vi.mocked(open).mockResolvedValue("/home/u/MobaXterm.ini");
    vi.mocked(invoke).mockResolvedValue(Array.from(new TextEncoder().encode(ini)));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("1 session to import.")).toBeTruthy();
    fireEvent.click(screen.getByText("Import 1 session"));
    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onImport).mock.calls[0][0]).toMatchObject([
      { name: "new", folder: "MobaXterm/Prod", host: "10.0.0.2", port: 22, username: "root", auth: { method: "password" } },
    ]);
    expect(screen.queryByText("Import 1 session")).toBeNull();
  });

  it("reads the file picked in the native dialog through the backend", async () => {
    renderPanel();
    vi.mocked(open).mockResolvedValue("/home/u/MobaXterm.ini");
    vi.mocked(invoke).mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("No sessions to import.")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("import_read_file", { path: "/home/u/MobaXterm.ini" });
  });

  it("does nothing when the dialog is cancelled", async () => {
    renderPanel();
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(invoke).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
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
