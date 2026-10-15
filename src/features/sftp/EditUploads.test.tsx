// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogProvider } from "../dialogs/DialogProvider";
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

const mount = async (onNotice: (text: string) => void) => {
  render(
    <DialogProvider>
      <EditUploads onNotice={onNotice} />
    </DialogProvider>,
  );
  await act(() => Promise.resolve());
};

const question = (name: string, remote: string) => `${name} was saved. Upload it to ${remote}?`;

/** Answers the upload question shown for `name` with `button`. */
const answer = async (name: string, remote: string, button: "Upload" | "Cancel") => {
  const dialog = screen.getByRole("dialog", { name: question(name, remote) });
  await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: button })));
};

describe("EditUploads", () => {
  it("uploads saved copies of every session, whichever panel is shown, asking once per file", async () => {
    const onNotice = vi.fn();
    await mount(onNotice);
    await saved({ id: 4, remote: "/home/u/notes.txt", local: "/tmp/x/notes.txt" });
    expect(invoke).not.toHaveBeenCalled();
    await answer("notes.txt", "/home/u/notes.txt", "Upload");
    expect(invoke).toHaveBeenCalledWith("sftp_edit_upload", { id: 4, remote: "/home/u/notes.txt" });
    expect(onNotice).toHaveBeenLastCalledWith("Uploaded notes.txt to /home/u/notes.txt.");
    await saved({ id: 4, remote: "/home/u/notes.txt", local: "/tmp/x/notes.txt" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(2);
    // Another session's file asks on its own.
    await saved({ id: 9, remote: "/home/u/notes.txt", local: "/tmp/y/notes.txt" });
    expect(screen.getByRole("dialog", { name: question("notes.txt", "/home/u/notes.txt") })).toBeTruthy();
  });

  it("does nothing when the upload is declined, and reports failures", async () => {
    const onNotice = vi.fn();
    await mount(onNotice);
    await saved({ id: 1, remote: "/a.txt", local: "/tmp/a.txt" });
    await answer("a.txt", "/a.txt", "Cancel");
    expect(invoke).not.toHaveBeenCalled();
    expect(onNotice).not.toHaveBeenCalled();
    invoke.mockRejectedValueOnce({ kind: "sftp", message: "permission denied" });
    await saved({ id: 1, remote: "/a.txt", local: "/tmp/a.txt" });
    await answer("a.txt", "/a.txt", "Upload");
    expect(onNotice).toHaveBeenLastCalledWith(expect.stringContaining("Could not upload a.txt"));
  });

  it("asks about two saved files one after the other", async () => {
    await mount(vi.fn());
    await saved({ id: 1, remote: "/a.txt", local: "/tmp/a.txt" });
    await saved({ id: 1, remote: "/b.txt", local: "/tmp/b.txt" });
    expect(screen.getAllByRole("dialog").map((d) => d.getAttribute("aria-label"))).toEqual([question("a.txt", "/a.txt")]);
    await answer("a.txt", "/a.txt", "Cancel");
    await answer("b.txt", "/b.txt", "Upload");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("sftp_edit_upload", { id: 1, remote: "/b.txt" });
  });
});
