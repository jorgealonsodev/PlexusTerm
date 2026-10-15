// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditSaved } from "./sftpClient";
import { EditUploads } from "./EditUploads";

const { invoke, handlers } = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  handlers: [] as ((event: { payload: EditSaved }) => void)[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: EditSaved }) => void) => {
    handlers.push(handler);
    return () => {};
  }),
}));

beforeEach(() => {
  handlers.length = 0;
  invoke.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const saved = (payload: EditSaved) => act(async () => handlers.forEach((h) => h({ payload })));

describe("EditUploads", () => {
  it("uploads saved copies of every session, whichever panel is shown, asking once per file", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onNotice = vi.fn();
    render(<EditUploads onNotice={onNotice} />);
    await act(() => Promise.resolve());
    await saved({ id: 4, remote: "/home/u/notes.txt", local: "/tmp/x/notes.txt" });
    expect(confirm).toHaveBeenCalledWith("notes.txt was saved. Upload it to /home/u/notes.txt?");
    expect(invoke).toHaveBeenCalledWith("sftp_edit_upload", { id: 4, remote: "/home/u/notes.txt" });
    expect(onNotice).toHaveBeenLastCalledWith("Uploaded notes.txt to /home/u/notes.txt.");
    await saved({ id: 4, remote: "/home/u/notes.txt", local: "/tmp/x/notes.txt" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    // Another session's file asks on its own.
    await saved({ id: 9, remote: "/home/u/notes.txt", local: "/tmp/y/notes.txt" });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the upload is declined, and reports failures", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const onNotice = vi.fn();
    render(<EditUploads onNotice={onNotice} />);
    await act(() => Promise.resolve());
    await saved({ id: 1, remote: "/a.txt", local: "/tmp/a.txt" });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce({ kind: "sftp", message: "permission denied" });
    await saved({ id: 1, remote: "/a.txt", local: "/tmp/a.txt" });
    expect(onNotice).toHaveBeenLastCalledWith(expect.stringContaining("Could not upload a.txt"));
  });
});
