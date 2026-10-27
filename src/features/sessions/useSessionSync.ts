import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { serializeLibrary, type SessionLibrary } from "./library";
import { emptySyncState, mergeSync, noteLocal, parseSyncDoc, serializeSyncDoc, type SyncState } from "./sessionSync";
import type { LibraryStatus } from "./useSessionLibrary";

export type SyncStatus =
  | { state: "off" }
  | { state: "syncing" }
  | { state: "synced"; at: number }
  /** `foreign`: the folder holds a file that is not a PlexusTerm sessions file (left untouched). */
  | { state: "error"; message: string; foreign?: boolean };

/** The library is synced this often, besides when the window gets the focus and after each change. */
export const SYNC_EVERY_MS = 60_000;
/** A change is synced once edits have stopped for this long. */
export const SYNC_AFTER_EDIT_MS = 2_000;

interface Sessions {
  library: SessionLibrary;
  status: LibraryStatus;
  replace: (library: SessionLibrary) => void;
}

/** This computer's sync state, or null when it never synced (no or unreadable sessions-sync.json). */
const parseState = (json: string | null): SyncState | null => {
  try {
    const state = json ? (JSON.parse(json) as SyncState) : null;
    return state?.version === 1 && state.sessions && state.folders ? state : null;
  } catch {
    return null;
  }
};

/**
 * Keeps the saved sessions in step with the other computers through `folder` (none when ""):
 * reads the shared file, merges it (sessionSync.ts), shows the result and writes it back.
 */
export function useSessionSync(sessions: Sessions, folder: string, now: () => number = Date.now): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: "off" });
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const stateRef = useRef<SyncState | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const syncNow = useRef(async () => {});
  syncNow.current = async () => {
    const { library, status: libraryStatus } = sessionsRef.current;
    if (!folder || libraryStatus.state !== "ready") return;
    let firstSync = false;
    if (!stateRef.current) {
      const saved = parseState(await invoke<string | null>("sessions_sync_state_load").catch(() => null));
      firstSync = saved === null;
      stateRef.current = saved ?? emptySyncState;
    }
    setStatus((s) => (s.state === "synced" ? s : { state: "syncing" }));
    const at = now();
    // The first time, this computer's sessions count as the oldest: where the shared file has the
    // same session, its (possibly newer) version wins; sessions only here are still added.
    const noted = noteLocal(library, stateRef.current, firstSync ? 0 : at);
    const text = await invoke<string | null>("sessions_sync_read", { folder });
    const remote = text === null ? null : parseSyncDoc(text);
    if (text !== null && remote === null) {
      setStatus({ state: "error", message: folder, foreign: true });
      return;
    }
    const merged = mergeSync(library, noted, remote, at);
    // Edits made while reading are merged at the next sync, never overwritten now.
    if (sessionsRef.current.library !== library) {
      again.current = true;
      return;
    }
    if (serializeLibrary(merged.library) !== serializeLibrary(library)) sessionsRef.current.replace(merged.library);
    stateRef.current = merged.state;
    await invoke("sessions_sync_state_save", { contents: JSON.stringify(merged.state) });
    const out = serializeSyncDoc(merged.state);
    if (out !== text) await invoke("sessions_sync_write", { folder, contents: out });
    setStatus({ state: "synced", at });
  };

  /** One sync at a time; one asked for meanwhile runs right after. */
  const sync = () => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = syncNow
      .current()
      .catch((err) => setStatus({ state: "error", message: String(err) }))
      .finally(() => {
        running.current = null;
        if (again.current) {
          again.current = false;
          sync();
        }
      });
  };

  const ready = sessions.status.state === "ready";
  useEffect(() => {
    if (!folder) {
      setStatus({ state: "off" });
      return;
    }
    if (!ready) return;
    sync();
    const timer = setInterval(sync, SYNC_EVERY_MS);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
    // sync reads everything else through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, ready]);

  // Local edits go out once they stop.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!folder || !ready) return;
    const timer = setTimeout(sync, SYNC_AFTER_EDIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.library]);

  return status;
}
