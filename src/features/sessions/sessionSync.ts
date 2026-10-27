/**
 * Sync of the saved sessions between computers through a folder the user already syncs (Syncthing,
 * Drive, Dropbox…). Each computer keeps, apart from sessions.json, when each session and folder
 * last changed or was deleted (its sync state); the shared file holds the same for all of them, and
 * merging keeps, for each one, the change made last. A deletion is kept as a tombstone so the other
 * computers delete it too, unless it was edited after. Passwords never leave the computer: every
 * session goes through the same sanitizing as sessions.json.
 */
import {
  emptyLibrary,
  isSshSession,
  normalizeFolder,
  parseLibrary,
  sanitizeSession,
  type LibrarySession,
  type SessionLibrary,
} from "./library";

/** The file in the synced folder. */
export const SYNC_FILE = "plexusterm-sessions-sync.json";
const FORMAT = "plexusterm-sessions";
/** Deletions older than this are forgotten (a computer away longer could bring a session back). */
export const TOMBSTONE_DAYS = 365;
const DAY_MS = 24 * 3600 * 1000;

/** When a session or folder last changed, and its saved form; null once deleted. */
export interface Stamp {
  at: number;
  value: string | null;
}

/** A computer's sync state: kept in sessions-sync.json beside sessions.json. */
export interface SyncState {
  version: 1;
  sessions: Record<string, Stamp>;
  folders: Record<string, Stamp>;
}

export const emptySyncState: SyncState = { version: 1, sessions: {}, folders: {} };

const valueOf = (session: LibrarySession) => JSON.stringify(sanitizeSession(session));

/**
 * The state after local edits: a session or folder whose saved form is new or changed gets `now`,
 * and one that is gone gets a tombstone at `now`.
 */
export function noteLocal(library: SessionLibrary, state: SyncState, now: number): SyncState {
  const sessions = { ...state.sessions };
  const present = new Set<string>();
  for (const session of library.sessions) {
    present.add(session.id);
    const value = valueOf(session);
    if (sessions[session.id]?.value !== value) sessions[session.id] = { at: now, value };
  }
  for (const [id, stamp] of Object.entries(sessions)) {
    if (stamp.value !== null && !present.has(id)) sessions[id] = { at: now, value: null };
  }
  const folders = { ...state.folders };
  const shown = new Set(library.folders);
  for (const folder of library.folders) {
    if (folders[folder]?.value !== "") folders[folder] = { at: now, value: "" };
  }
  for (const [folder, stamp] of Object.entries(folders)) {
    if (stamp.value !== null && !shown.has(folder)) folders[folder] = { at: now, value: null };
  }
  return { version: 1, sessions, folders };
}

const isStamp = (v: unknown): v is { at: number } =>
  typeof v === "object" && v !== null && Number.isFinite((v as { at?: unknown }).at);

/**
 * The shared file as stamps, or null when it is not a PlexusTerm sessions file or any session in
 * it is not one PlexusTerm would save: a bad file never empties or changes the library.
 */
export function parseSyncDoc(text: string): SyncState | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const doc = data as { format?: unknown; version?: unknown; sessions?: unknown; folders?: unknown };
  if (doc?.format !== FORMAT || doc.version !== 1) return null;
  if (typeof doc.sessions !== "object" || doc.sessions === null || typeof doc.folders !== "object" || doc.folders === null) {
    return null;
  }
  const sessions: Record<string, Stamp> = {};
  const live: LibrarySession[] = [];
  for (const [id, entry] of Object.entries(doc.sessions as Record<string, unknown>)) {
    if (!isStamp(entry)) return null;
    const session = (entry as { session?: unknown }).session;
    if (session === undefined || session === null) {
      sessions[id] = { at: entry.at, value: null };
    } else {
      if ((session as { id?: unknown }).id !== id) return null;
      live.push(session as LibrarySession);
    }
  }
  // The same checks and sanitizing as sessions.json.
  const parsed = parseLibrary(JSON.stringify({ version: 1, folders: [], sessions: live }));
  if (!parsed.ok) return null;
  for (const session of parsed.library.sessions) {
    const entry = (doc.sessions as Record<string, { at: number }>)[session.id];
    sessions[session.id] = { at: entry.at, value: valueOf(session) };
  }
  const folders: Record<string, Stamp> = {};
  for (const [path, entry] of Object.entries(doc.folders as Record<string, unknown>)) {
    const folder = normalizeFolder(path);
    if (!folder || !isStamp(entry)) continue;
    folders[folder] = { at: entry.at, value: (entry as { deleted?: unknown }).deleted === true ? null : "" };
  }
  return { version: 1, sessions, folders };
}

/** The shared file's text for `state`. */
export function serializeSyncDoc(state: SyncState): string {
  const sessions: Record<string, { at: number; session?: unknown }> = {};
  for (const [id, stamp] of Object.entries(state.sessions)) {
    sessions[id] = stamp.value === null ? { at: stamp.at } : { at: stamp.at, session: JSON.parse(stamp.value) };
  }
  const folders: Record<string, { at: number; deleted?: true }> = {};
  for (const [path, stamp] of Object.entries(state.folders)) {
    folders[path] = stamp.value === null ? { at: stamp.at, deleted: true } : { at: stamp.at };
  }
  return JSON.stringify({ format: FORMAT, version: 1, sessions, folders }, null, 2);
}

/**
 * For each key, the newer stamp; on a tie, the greater saved form, so every computer settles on the
 * same one. Old tombstones are dropped.
 */
function newer(local: Record<string, Stamp>, remote: Record<string, Stamp>, now: number) {
  const out: Record<string, Stamp> = {};
  const oldest = now - TOMBSTONE_DAYS * DAY_MS;
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[key];
    const b = remote[key];
    const pick = !b ? a : !a ? b : a.at !== b.at ? (a.at > b.at ? a : b) : (a.value ?? "") >= (b.value ?? "") ? a : b;
    if (pick.value === null && pick.at < oldest) continue;
    out[key] = pick;
  }
  return out;
}

const withAncestors = (path: string) => {
  const parts = path ? path.split("/") : [];
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
};

/**
 * Merges the local library (whose edits `state` already notes) with the shared file: the library
 * to show, and the state to keep locally and write to the file. Sessions keep their local order,
 * the ones from other computers follow.
 */
export function mergeSync(
  library: SessionLibrary,
  state: SyncState,
  remote: SyncState | null,
  now: number,
): { library: SessionLibrary; state: SyncState } {
  const sessions = newer(state.sessions, remote?.sessions ?? {}, now);
  const folders = newer(state.folders, remote?.folders ?? {}, now);

  const ids = [...library.sessions.map((s) => s.id), ...Object.keys(sessions)];
  const seen = new Set<string>();
  const merged: LibrarySession[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const value = sessions[id]?.value;
    if (value) merged.push(JSON.parse(value) as LibrarySession);
  }

  const order = [...library.folders, ...Object.keys(folders)];
  const kept: string[] = [];
  for (const folder of order) {
    if (folders[folder]?.value === "" && !kept.includes(folder)) kept.push(folder);
  }
  // A jump host deleted on another computer leaves the sessions that went through it, as a local
  // deletion does (the changed sessions go out with the next sync).
  const live = new Set(merged.map((s) => s.id));
  for (let i = 0; i < merged.length; i++) {
    const session = merged[i];
    if (isSshSession(session) && session.jumpIds?.some((id) => !live.has(id))) {
      merged[i] = sanitizeSession({ ...session, jumpIds: session.jumpIds.filter((id) => live.has(id)) });
    }
  }
  // A session's folder (and the folders above it) shows even if another computer deleted it.
  for (const session of merged) {
    for (const folder of withAncestors(session.folder)) if (!kept.includes(folder)) kept.push(folder);
  }
  return { library: { ...emptyLibrary, folders: kept, sessions: merged }, state: { version: 1, sessions, folders } };
}
