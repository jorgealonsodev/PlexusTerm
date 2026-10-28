import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { SYNC_AFTER_EDIT_MS, SYNC_EVERY_MS, type SyncStatus } from "../sessions/useSessionSync";
import type { TerminalSettings } from "./settings";
import {
  emptySettingsSyncState,
  LOCAL_SETTINGS,
  mergeSettingsSync,
  noteLocalSettings,
  parseSettingsSyncDoc,
  serializeSettingsSyncDoc,
  type SettingsSyncState,
} from "./settingsSync";

interface Settings {
  settings: TerminalSettings;
  loaded: boolean;
  update: (patch: Partial<TerminalSettings>) => void;
}

/** This computer's sync state, or null when it never synced (no or unreadable settings-sync.json). */
const parseState = (json: string | null): SettingsSyncState | null => {
  try {
    const state = json ? (JSON.parse(json) as SettingsSyncState) : null;
    return state?.version === 1 && state.settings ? state : null;
  } catch {
    return null;
  }
};

/**
 * Keeps the shared settings in step with the other computers through `folder` (none when ""), the
 * same way useSessionSync keeps the sessions: reads the shared file, merges it (settingsSync.ts),
 * applies the result and writes it back. While `paused` (the Settings dialog is open, and would put
 * its own copy back) it waits, keeping the last status.
 */
export function useSettingsSync(
  settings: Settings,
  folder: string,
  paused = false,
  now: () => number = Date.now,
): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ state: "off" });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const stateRef = useRef<SettingsSyncState | null>(null);
  /** This computer never finished a sync: its settings count as the oldest until one does. */
  const firstSync = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const syncNow = useRef(async () => {});
  syncNow.current = async () => {
    const { settings: local, loaded } = settingsRef.current;
    if (!folder || !loaded || pausedRef.current) return;
    if (!stateRef.current) {
      const saved = parseState(await invoke<string | null>("settings_sync_state_load").catch(() => null));
      firstSync.current = saved === null;
      stateRef.current = saved ?? emptySettingsSyncState;
    }
    setStatus((s) => (s.state === "synced" ? s : { state: "syncing" }));
    const at = now();
    const text = await invoke<string | null>("settings_sync_read", { folder });
    const remote = text === null ? null : parseSettingsSyncDoc(text);
    if (text !== null && remote === null) {
      setStatus({ state: "error", message: folder, foreign: true });
      return;
    }
    // The first time, the shared file's settings win over this computer's ones; with no file yet,
    // this computer's ones start it.
    const noted = noteLocalSettings(local, stateRef.current, firstSync.current && remote ? 0 : at);
    const merged = mergeSettingsSync(local, noted, remote);
    // Edits made while reading are merged at the next sync, never overwritten now.
    if (settingsRef.current.settings !== local) {
      again.current = true;
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(merged.settings)) {
      const before = (local as unknown as Record<string, unknown>)[key];
      if (!LOCAL_SETTINGS.has(key) && JSON.stringify(value) !== JSON.stringify(before)) patch[key] = value;
    }
    if (Object.keys(patch).length > 0) settingsRef.current.update(patch as Partial<TerminalSettings>);
    stateRef.current = merged.state;
    firstSync.current = false;
    await invoke("settings_sync_state_save", { contents: JSON.stringify(merged.state) });
    const out = serializeSettingsSyncDoc(merged.state);
    if (out !== text) await invoke("settings_sync_write", { folder, contents: out });
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

  const loaded = settings.loaded;
  useEffect(() => {
    if (!folder) {
      setStatus({ state: "off" });
      return;
    }
    if (!loaded || paused) return;
    sync();
    const timer = setInterval(sync, SYNC_EVERY_MS);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
    // sync reads everything else through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, loaded, paused]);

  // Local edits go out once they stop.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!folder || !loaded || paused) return;
    const timer = setTimeout(sync, SYNC_AFTER_EDIT_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.settings]);

  return status;
}
