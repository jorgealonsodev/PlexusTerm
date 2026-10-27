// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { emptyLibrary, libraryReducer, type LibrarySession, type SessionLibrary } from "./library";
import { serializeSyncDoc, parseSyncDoc } from "./sessionSync";
import { SYNC_AFTER_EDIT_MS, useSessionSync } from "./useSessionSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ssh = (id: string, name: string): LibrarySession => ({
  kind: "ssh",
  id,
  name,
  folder: "",
  host: `${id}.example`,
  port: 22,
  username: "me",
  auth: { method: "agent" },
});
const libOf = (...sessions: LibrarySession[]): SessionLibrary =>
  sessions.reduce((acc, session) => libraryReducer(acc, { type: "saveSession", session }), emptyLibrary);

/** The backend: the shared file and this computer's sync state, in memory. */
let shared: string | null;
let localState: string | null;
beforeEach(() => {
  vi.useFakeTimers();
  shared = null;
  localState = null;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const a = args as { contents?: string; folder?: string };
    switch (command) {
      case "sessions_sync_state_load":
        return localState;
      case "sessions_sync_state_save":
        localState = a.contents!;
        return null;
      case "sessions_sync_read":
        return shared;
      case "sessions_sync_write":
        shared = a.contents!;
        return null;
    }
    return null;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(invoke).mockReset();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(10)));

describe("useSessionSync", () => {
  it("does nothing without a folder", async () => {
    const replace = vi.fn();
    const { result } = renderHook(() => useSessionSync({ library: libOf(ssh("1", "web")), status: { state: "ready" }, replace }, ""));
    await settle();
    expect(result.current).toEqual({ state: "off" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("writes this computer's sessions to the folder and takes the other computers' ones", async () => {
    // Another computer already wrote "db".
    shared = serializeSyncDoc({ version: 1, sessions: { "2": { at: 500, value: JSON.stringify(ssh("2", "db")) } }, folders: {} });
    const replace = vi.fn();
    const { result } = renderHook(() =>
      useSessionSync({ library: libOf(ssh("1", "web")), status: { state: "ready" }, replace }, "/sync", () => 1000),
    );
    await settle();
    expect(result.current).toEqual({ state: "synced", at: 1000 });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0].sessions.map((s: LibrarySession) => s.name)).toEqual(["web", "db"]);
    const doc = parseSyncDoc(shared!)!;
    expect(Object.keys(doc.sessions).sort()).toEqual(["1", "2"]);
    expect(localState).not.toBeNull();
  });

  it("leaves a file that is not a PlexusTerm sessions file untouched, and says so", async () => {
    shared = '{"something":"else"}';
    const replace = vi.fn();
    const { result } = renderHook(() => useSessionSync({ library: libOf(ssh("1", "web")), status: { state: "ready" }, replace }, "/sync"));
    await settle();
    expect(result.current).toMatchObject({ state: "error", foreign: true });
    expect(shared).toBe('{"something":"else"}');
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends a local edit once edits stop, and waits while the sessions cannot be read", async () => {
    let library = libOf(ssh("1", "web"));
    const replace = vi.fn();
    const { rerender } = renderHook(({ lib, ready }) => useSessionSync({ library: lib, status: ready ? { state: "ready" } : { state: "loading" }, replace }, "/sync"), {
      initialProps: { lib: library, ready: false },
    });
    await settle();
    expect(shared).toBeNull();
    rerender({ lib: library, ready: true });
    await settle();
    library = libraryReducer(library, { type: "saveSession", session: ssh("1", "web renamed") });
    rerender({ lib: library, ready: true });
    await act(async () => void (await vi.advanceTimersByTimeAsync(SYNC_AFTER_EDIT_MS + 10)));
    const doc = parseSyncDoc(shared!)!;
    expect(JSON.parse(doc.sessions["1"].value!).name).toBe("web renamed");
  });
});
