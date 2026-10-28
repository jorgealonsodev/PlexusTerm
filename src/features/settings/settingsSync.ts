/**
 * Sync of the settings between computers through a folder the user already syncs, the same way as
 * the sessions (sessions/sessionSync.ts) and through its own folder setting. Each computer keeps, apart from settings.json, when each setting last
 * changed (its sync state); the shared file holds the same for all of them, and merging keeps, for
 * each setting, the change made last. Settings that belong to one computer (paths, window layout,
 * the GPU) never leave it. Keys and passwords are in the keyring, not in the settings.
 */
import { parseSettings, type TerminalSettings } from "./settings";

/** The file in the synced folder. */
export const SETTINGS_SYNC_FILE = "plexusterm-settings-sync.json";
const FORMAT = "plexusterm-settings";

/** Settings that only make sense on the computer they were set on: never synced. */
export const LOCAL_SETTINGS: ReadonlySet<string> = new Set<keyof TerminalSettings>([
  "syncFolder",
  "settingsSyncFolder",
  "textEditor",
  "localShell",
  "localShellArgs",
  "localCwd",
  "diagnosticLogDir",
  "gpuAcceleration",
  "sidebarCollapsed",
  "sidebarWidth",
  "tabColumnWidth",
  "devColumnCollapsed",
]);

/** When a setting last changed, and its value as JSON. */
export interface SettingStamp {
  at: number;
  value: string;
}

/** A computer's sync state: kept in settings-sync.json beside settings.json. */
export interface SettingsSyncState {
  version: 1;
  settings: Record<string, SettingStamp>;
}

export const emptySettingsSyncState: SettingsSyncState = { version: 1, settings: {} };

/**
 * `settings` with the stamped values in place of its shared ones, through the same checks as
 * settings.json: a value this version cannot use (say, a theme added later) falls back.
 */
function applied(settings: TerminalSettings, stamps: Record<string, SettingStamp>): TerminalSettings {
  const candidate: Record<string, unknown> = { ...settings };
  for (const [key, stamp] of Object.entries(stamps)) {
    if (!LOCAL_SETTINGS.has(key)) candidate[key] = JSON.parse(stamp.value);
  }
  return parseSettings(JSON.stringify(candidate));
}

/**
 * The state after local edits: a shared setting whose value is not what its stamp gives here gets
 * `now`. Comparing with the applied stamp keeps a value this version could not use from being sent
 * back over the newer one.
 */
export function noteLocalSettings(settings: TerminalSettings, state: SettingsSyncState, now: number): SettingsSyncState {
  const stamps = { ...state.settings };
  const known = applied(settings, stamps) as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    if (LOCAL_SETTINGS.has(key)) continue;
    const json = JSON.stringify(value);
    if (!stamps[key] || JSON.stringify(known[key]) !== json) stamps[key] = { at: now, value: json };
  }
  return { version: 1, settings: stamps };
}

const isStamp = (v: unknown): v is { at: number; value: unknown } =>
  typeof v === "object" && v !== null && Number.isFinite((v as { at?: unknown }).at) && "value" in v;

/** The shared file as stamps, or null when it is not a PlexusTerm settings file. */
export function parseSettingsSyncDoc(text: string): SettingsSyncState | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const doc = data as { format?: unknown; version?: unknown; settings?: unknown };
  if (doc?.format !== FORMAT || doc.version !== 1) return null;
  if (typeof doc.settings !== "object" || doc.settings === null || Array.isArray(doc.settings)) return null;
  const settings: Record<string, SettingStamp> = {};
  for (const [key, entry] of Object.entries(doc.settings as Record<string, unknown>)) {
    if (!isStamp(entry)) return null;
    if (!LOCAL_SETTINGS.has(key)) settings[key] = { at: entry.at, value: JSON.stringify(entry.value) };
  }
  return { version: 1, settings };
}

/** The shared file's text for `state`. */
export function serializeSettingsSyncDoc(state: SettingsSyncState): string {
  const settings: Record<string, { at: number; value: unknown }> = {};
  for (const [key, stamp] of Object.entries(state.settings)) settings[key] = { at: stamp.at, value: JSON.parse(stamp.value) };
  return JSON.stringify({ format: FORMAT, version: 1, settings }, null, 2);
}

/**
 * Merges the local settings (whose edits `state` already notes) with the shared file: the settings
 * to use, and the state to keep locally and write to the file. For each setting the newer stamp
 * wins; on a tie, the greater value, so every computer settles on the same one.
 */
export function mergeSettingsSync(
  settings: TerminalSettings,
  state: SettingsSyncState,
  remote: SettingsSyncState | null,
): { settings: TerminalSettings; state: SettingsSyncState } {
  const theirs = remote?.settings ?? {};
  const stamps: Record<string, SettingStamp> = {};
  for (const key of new Set([...Object.keys(state.settings), ...Object.keys(theirs)])) {
    const a = state.settings[key];
    const b = theirs[key];
    stamps[key] = !b ? a : !a ? b : a.at !== b.at ? (a.at > b.at ? a : b) : a.value >= b.value ? a : b;
  }
  return { settings: applied(settings, stamps), state: { version: 1, settings: stamps } };
}
