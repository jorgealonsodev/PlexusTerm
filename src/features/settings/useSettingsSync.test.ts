// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, type TerminalSettings } from "./settings";
import { parseSettingsSyncDoc, serializeSettingsSyncDoc } from "./settingsSync";
import { useSettingsSync } from "./useSettingsSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/** The backend: the shared file and this computer's sync state, in memory. */
let shared: string | null;
let localState: string | null;
beforeEach(() => {
  vi.useFakeTimers();
  shared = null;
  localState = null;
  vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
    const a = args as { contents?: string };
    switch (command) {
      case "settings_sync_state_load":
        return localState;
      case "settings_sync_state_save":
        localState = a.contents!;
        return null;
      case "settings_sync_read":
        return shared;
      case "settings_sync_write":
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
const withSettings = (patch: Partial<TerminalSettings>): TerminalSettings => ({ ...DEFAULT_SETTINGS, ...patch });

describe("useSettingsSync", () => {
  it("does nothing without a folder", async () => {
    const update = vi.fn();
    const { result } = renderHook(() => useSettingsSync({ settings: DEFAULT_SETTINGS, loaded: true, update }, ""));
    await settle();
    expect(result.current).toEqual({ state: "off" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("waits for settings.json before the first sync", async () => {
    const update = vi.fn();
    renderHook(() => useSettingsSync({ settings: DEFAULT_SETTINGS, loaded: false, update }, "/sync"));
    await settle();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("starts the shared file with this computer's settings, leaving out its own ones", async () => {
    const update = vi.fn();
    const settings = withSettings({ fontSize: 17, localShell: "zsh" });
    const { result } = renderHook(() => useSettingsSync({ settings, loaded: true, update }, "/sync", false, () => 1000));
    await settle();
    expect(result.current).toEqual({ state: "synced", at: 1000 });
    const doc = parseSettingsSyncDoc(shared!)!;
    expect(doc.settings.fontSize).toEqual({ at: 1000, value: "17" });
    expect(doc.settings.localShell).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("a computer syncing for the first time takes the shared settings, keeping its own ones", async () => {
    shared = serializeSettingsSyncDoc({ version: 1, settings: { fontSize: { at: 500, value: "20" } } });
    const update = vi.fn();
    const settings = withSettings({ fontSize: 13, localShell: "fish" });
    renderHook(() => useSettingsSync({ settings, loaded: true, update }, "/sync", false, () => 1000));
    await settle();
    expect(update).toHaveBeenCalledTimes(1);
    const patch = update.mock.calls[0][0] as Partial<TerminalSettings>;
    expect(patch.fontSize).toBe(20);
    expect("localShell" in patch).toBe(false);
    expect(parseSettingsSyncDoc(shared!)!.settings.fontSize.value).toBe("20");
  });

  it("waits while paused and syncs once it is not", async () => {
    const update = vi.fn();
    const { rerender } = renderHook(({ paused }) => useSettingsSync({ settings: DEFAULT_SETTINGS, loaded: true, update }, "/sync", paused), {
      initialProps: { paused: true },
    });
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    rerender({ paused: false });
    await settle();
    expect(shared).not.toBeNull();
  });

  it("leaves a file that is not a PlexusTerm settings file untouched, and says so", async () => {
    shared = "{}";
    const update = vi.fn();
    const { result } = renderHook(() => useSettingsSync({ settings: DEFAULT_SETTINGS, loaded: true, update }, "/sync"));
    await settle();
    expect(result.current).toEqual({ state: "error", message: "/sync", foreign: true });
    expect(shared).toBe("{}");
    expect(update).not.toHaveBeenCalled();
  });
});
