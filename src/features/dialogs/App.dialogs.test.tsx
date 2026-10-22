// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../../App";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

const ssh = (id: string, name: string, folder = "", jumpIds?: string[]) => ({
  kind: "ssh",
  id,
  name,
  folder,
  host: `${id}.example`,
  port: 22,
  username: "u",
  auth: { method: "agent" },
  ...(jumpIds ? { jumpIds } : {}),
});

const FILES: Record<string, unknown> = {
  sessions_load: { version: 1, folders: ["prod"], sessions: [ssh("gw", "gw"), ssh("web", "web", "", ["gw"]), ssh("db", "db", "prod")] },
  tunnels_load: {
    version: 1,
    tunnels: [
      {
        id: "t1",
        name: "t1",
        type: "local",
        sessionId: "gw",
        listenHost: "127.0.0.1",
        listenPort: 8080,
        destHost: "localhost",
        destPort: 80,
      },
    ],
  },
  macros_load: { version: 1, macros: [{ id: "m1", name: "hello", steps: [{ kind: "send", text: "hi" }] }] },
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd in FILES) return JSON.stringify(FILES[cmd]);
    if (cmd === "tunnel_statuses") return [];
    return null;
  });
});
afterEach(cleanup);

const saves = (cmd: string) =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([c]) => c === cmd)
    .map(([, args]) => JSON.parse((args as { contents: string }).contents));

const mount = async () => {
  render(<App />);
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

/** The dialog or alert dialog whose name starts with `start`. */
const dialogNamed = (start: string) =>
  [...screen.queryAllByRole("dialog"), ...screen.queryAllByRole("alertdialog")].find((d) =>
    (d.getAttribute("aria-label") ?? "").startsWith(start),
  );

const press = async (start: string, button: string) => {
  const dialog = dialogNamed(start);
  expect(dialog, start).toBeTruthy();
  await act(async () => void fireEvent.click(within(dialog!).getByRole("button", { name: button })));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

const rowAction = (label: string, action: string) =>
  within(screen.getByText(label).closest(".tree-row") as HTMLElement).getByTitle(action);

describe("App confirmations use the in-app dialogs (S1)", () => {
  it("deletes a session only when accepted, naming the sessions that use it as a jump host", async () => {
    await mount();
    fireEvent.click(rowAction("gw", "Delete"));
    const dialog = screen.getByRole("alertdialog");
    expect([...dialog.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      'Delete session "gw"?',
      'Used as a jump host by "web"; it will be removed from their jump hosts.',
    ]);
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    await press('Delete session "gw"?', "Cancel");
    expect(saves("sessions_save")).toEqual([]);
    expect(screen.getByText("gw")).toBeTruthy();

    fireEvent.click(rowAction("gw", "Delete"));
    await press('Delete session "gw"?', "Delete");
    await waitFor(() => expect(saves("sessions_save")).toHaveLength(1));
    const [library] = saves("sessions_save");
    expect(library.sessions.map((s: { id: string }) => s.id)).toEqual(["web", "db"]);
    expect(library.sessions[0].jumpIds).toBeUndefined();
  });

  it("deletes a folder and its sessions only when accepted", async () => {
    await mount();
    fireEvent.click(rowAction("prod", "Delete folder"));
    await press('Delete folder "prod" and every session inside it?', "Cancel");
    expect(saves("sessions_save")).toEqual([]);
    fireEvent.click(rowAction("prod", "Delete folder"));
    await press('Delete folder "prod" and every session inside it?', "Delete");
    await waitFor(() => expect(saves("sessions_save")).toHaveLength(1));
    expect(saves("sessions_save")[0].folders).toEqual([]);
  });

  it("asks before moving a session into a folder that has one of the same name", async () => {
    const library = { version: 1, folders: ["prod"], sessions: [ssh("db", "db", "prod"), ssh("db2", "DB"), ssh("app", "app")] };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "sessions_load") return JSON.stringify(library);
      if (cmd in FILES) return JSON.stringify(FILES[cmd]);
      return cmd === "tunnel_statuses" ? [] : null;
    });
    await mount();
    const prod = screen.getByText("prod").closest("li")!;
    const dragOnto = async (name: string) => {
      document.elementFromPoint = () => prod;
      const row = screen.getAllByText(name).map((el) => el.closest(".tree-row")!).find((r) => !prod.contains(r))!;
      fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 10, clientY: 40 });
      await act(async () => void fireEvent.pointerUp(window, { clientX: 10, clientY: 40 }));
    };

    await dragOnto("DB");
    await press('Folder "prod" already has a session called "DB". Move it there anyway?', "Cancel");
    expect(saves("sessions_save")).toEqual([]);
    await dragOnto("DB");
    await press('Folder "prod" already has a session called "DB"', "Move anyway");
    await waitFor(() => expect(saves("sessions_save")).toHaveLength(1));
    expect(saves("sessions_save")[0].sessions.find((s: { id: string }) => s.id === "db2").folder).toBe("prod");

    // Without a clash it moves at once.
    await dragOnto("app");
    await waitFor(() => expect(saves("sessions_save")).toHaveLength(2));
    expect(dialogNamed("Folder")).toBeUndefined();
  });

  it("creates a folder with the typed name, and nothing when cancelled", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    await press("New folder", "Cancel");
    expect(saves("sessions_save")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const field = screen.getByRole("textbox", { name: "New folder" });
    fireEvent.change(field, { target: { value: "lab" } });
    await act(async () => void fireEvent.keyDown(field, { key: "Enter" }));
    await waitFor(() => expect(saves("sessions_save")).toHaveLength(1));
    expect(saves("sessions_save")[0].folders).toContain("lab");
  });

  it("deletes a tunnel only when accepted", async () => {
    await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Tunnels" }));
    fireEvent.click(rowAction("t1", "Delete"));
    await press('Delete tunnel "t1"?', "Cancel");
    expect(saves("tunnels_save")).toEqual([]);
    fireEvent.click(rowAction("t1", "Delete"));
    await press('Delete tunnel "t1"?', "Delete");
    await waitFor(() => expect(saves("tunnels_save")).toEqual([{ version: 1, tunnels: [] }]));
  });

  it("deletes a macro only when accepted", async () => {
    await mount();
    fireEvent.click(screen.getByRole("tab", { name: "Macros" }));
    fireEvent.click(rowAction("hello", "Delete"));
    await press('Delete macro "hello"?', "Cancel");
    expect(saves("macros_save")).toEqual([]);
    fireEvent.click(rowAction("hello", "Delete"));
    await press('Delete macro "hello"?', "Delete");
    await waitFor(() => expect(saves("macros_save")).toHaveLength(1));
    expect(saves("macros_save")[0].macros).toEqual([]);
  });
});
