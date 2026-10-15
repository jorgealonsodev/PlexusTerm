// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpPanel } from "./SftpPanel";
import { sftp, type SftpEntry } from "./sftpClient";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
vi.mock("./sftpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sftpClient")>();
  return {
    ...actual,
    sftp: { home: vi.fn(), list: vi.fn(), download: vi.fn(), upload: vi.fn(), mkdir: vi.fn(), remove: vi.fn(), rename: vi.fn() },
  };
});

const entry = (name: string, kind: SftpEntry["kind"], dir = "/home/u"): SftpEntry => ({
  name,
  path: `${dir}/${name}`,
  kind,
  size: 10,
  modified: null,
  permissions: null,
});

const mocked = vi.mocked(sftp);

beforeEach(() => {
  vi.resetAllMocks();
  mocked.home.mockResolvedValue("/home/u");
  mocked.list.mockImplementation(async (_id, path) =>
    path === "/home/u" ? [entry("src", "dir"), entry("notes.txt", "file")] : [],
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
