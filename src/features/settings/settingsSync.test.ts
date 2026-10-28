import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type TerminalSettings } from "./settings";
import {
  emptySettingsSyncState,
  LOCAL_SETTINGS,
  mergeSettingsSync,
  noteLocalSettings,
  parseSettingsSyncDoc,
  serializeSettingsSyncDoc,
  type SettingsSyncState,
} from "./settingsSync";

const withSettings = (patch: Partial<TerminalSettings>): TerminalSettings => ({ ...DEFAULT_SETTINGS, ...patch });
const stateOf = (values: Record<string, unknown>, at: number): SettingsSyncState => ({
  version: 1,
  settings: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { at, value: JSON.stringify(value) }])),
});

describe("settings sync", () => {
  it("stamps only the settings that changed, and never this computer's own ones", () => {
    const first = noteLocalSettings(withSettings({ fontSize: 16 }), emptySettingsSyncState, 100);
    expect(first.settings.fontSize).toEqual({ at: 100, value: "16" });
    for (const key of LOCAL_SETTINGS) expect(first.settings[key]).toBeUndefined();
    const second = noteLocalSettings(withSettings({ fontSize: 16, theme: "catppuccin-macchiato", localShell: "zsh" }), first, 200);
    expect(second.settings.fontSize.at).toBe(100);
    expect(second.settings.theme).toEqual({ at: 200, value: '"catppuccin-macchiato"' });
    expect(second.settings.localShell).toBeUndefined();
  });

  it("keeps, for each setting, the change made last", () => {
    const local = withSettings({ fontSize: 18, theme: "catppuccin-mocha" });
    const state = stateOf({ fontSize: 18, theme: "catppuccin-mocha" }, 100);
    const remote = stateOf({ fontSize: 12 }, 200);
    remote.settings.theme = { at: 50, value: '"catppuccin-macchiato"' };
    const merged = mergeSettingsSync(local, state, remote);
    expect(merged.settings.fontSize).toBe(12);
    expect(merged.settings.theme).toBe("catppuccin-mocha");
    expect(merged.state.settings.fontSize.at).toBe(200);
  });

  it("never takes another computer's own settings, even from a file that has them", () => {
    const local = withSettings({ localShell: "bash", syncFolder: "/sync" });
    const doc = JSON.stringify({
      format: "plexusterm-settings",
      version: 1,
      settings: { localShell: { at: 999, value: "fish" }, syncFolder: { at: 999, value: "/elsewhere" }, fontSize: { at: 999, value: 20 } },
    });
    const remote = parseSettingsSyncDoc(doc)!;
    const merged = mergeSettingsSync(local, noteLocalSettings(local, emptySettingsSyncState, 1), remote);
    expect(merged.settings.localShell).toBe("bash");
    expect(merged.settings.syncFolder).toBe("/sync");
    expect(merged.settings.fontSize).toBe(20);
  });

  it("a value this version cannot use does not count as a local change sent back out", () => {
    const local = withSettings({});
    const remote = stateOf({ theme: "a-theme-from-a-newer-version" }, 500);
    const merged = mergeSettingsSync(local, noteLocalSettings(local, emptySettingsSyncState, 0), remote);
    expect(merged.settings.theme).toBe(DEFAULT_SETTINGS.theme);
    const noted = noteLocalSettings(merged.settings, merged.state, 600);
    expect(noted.settings.theme).toEqual({ at: 500, value: '"a-theme-from-a-newer-version"' });
  });

  it("round-trips the shared file and rejects one that is not a PlexusTerm settings file", () => {
    const state = noteLocalSettings(withSettings({ highlightRules: [] }), emptySettingsSyncState, 7);
    expect(parseSettingsSyncDoc(serializeSettingsSyncDoc(state))).toEqual(state);
    expect(parseSettingsSyncDoc("not json")).toBeNull();
    expect(parseSettingsSyncDoc(JSON.stringify({ format: "plexusterm-sessions", version: 1, settings: {} }))).toBeNull();
    expect(parseSettingsSyncDoc(JSON.stringify({ format: "plexusterm-settings", version: 1, settings: { fontSize: { value: 3 } } }))).toBeNull();
  });
});
