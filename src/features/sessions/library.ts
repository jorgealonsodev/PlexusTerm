import type { SerialSettings, SerialTarget, SshTarget } from "./types";

/** Saved auth never contains secrets: passwords are asked at connect time. */
export type SavedAuth = { method: "password" } | { method: "key"; path: string } | { method: "agent" };

/**
 * A saved SSH session. `kind` is absent in files written before serial sessions existed;
 * parsing fills it in, so sessions loaded or saved through this module always carry it.
 */
export interface SavedSession {
  kind?: "ssh";
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
  host: string;
  port: number;
  username: string;
  auth: SavedAuth;
}

/** A saved serial console; no secrets are involved. */
export interface SavedSerialSession extends SerialSettings {
  kind: "serial";
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
}

/** Any entry of the session library. */
export type LibrarySession = SavedSession | SavedSerialSession;

export const isSerialSession = (s: LibrarySession): s is SavedSerialSession => s.kind === "serial";
export const isSshSession = (s: LibrarySession): s is SavedSession => s.kind !== "serial";

export interface SessionLibrary {
  version: 1;
  folders: string[];
  sessions: LibrarySession[];
}

export type LibraryAction =
  | { type: "saveSession"; session: LibrarySession }
  /** Saves several sessions with a single write (e.g. an import). */
  | { type: "saveSessions"; sessions: LibrarySession[] }
  | { type: "deleteSession"; id: string }
  | { type: "addFolder"; path: string }
  | { type: "deleteFolder"; path: string };

export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "session"; name: string; session: LibrarySession };

export const emptyLibrary: SessionLibrary = { version: 1, folders: [], sessions: [] };

export function normalizeFolder(path: string): string {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

/** "A/B/C" -> ["A", "A/B", "A/B/C"] */
function withAncestors(path: string): string[] {
  const parts = path ? path.split("/") : [];
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

const isInside = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

function addFolders(folders: string[], path: string): string[] {
  const missing = withAncestors(path).filter((p) => !folders.includes(p));
  return missing.length ? [...folders, ...missing] : folders;
}

/** Drops anything that is not part of the saved shape (e.g. a password). */
function sanitizeAuth(auth: SavedAuth): SavedAuth {
  switch (auth.method) {
    case "key":
      return { method: "key", path: auth.path };
    case "password":
    case "agent":
      return { method: auth.method };
  }
}

/** Keeps only the saved shape of a session (no secrets, no stray fields), with its `kind`. */
function sanitizeSession(s: LibrarySession): LibrarySession {
  const base = { id: s.id, name: s.name, folder: normalizeFolder(s.folder) };
  if (isSerialSession(s)) {
    const { path, baud, dataBits, parity, stopBits, flow } = s;
    return { kind: "serial", ...base, path, baud, dataBits, parity, stopBits, flow };
  }
  return { kind: "ssh", ...base, host: s.host, port: s.port, username: s.username, auth: sanitizeAuth(s.auth) };
}

export function libraryReducer(lib: SessionLibrary, action: LibraryAction): SessionLibrary {
  switch (action.type) {
    case "saveSession": {
      const session = sanitizeSession(action.session);
      const exists = lib.sessions.some((s) => s.id === session.id);
      return {
        ...lib,
        folders: addFolders(lib.folders, session.folder),
        sessions: exists
          ? lib.sessions.map((s) => (s.id === session.id ? session : s))
          : [...lib.sessions, session],
      };
    }
    case "saveSessions":
      return action.sessions.reduce(
        (acc, session) => libraryReducer(acc, { type: "saveSession", session }),
        lib,
      );
    case "deleteSession":
      return { ...lib, sessions: lib.sessions.filter((s) => s.id !== action.id) };
    case "addFolder": {
      const path = normalizeFolder(action.path);
      return path ? { ...lib, folders: addFolders(lib.folders, path) } : lib;
    }
    case "deleteFolder": {
      const path = normalizeFolder(action.path);
      if (!path) return lib;
      return {
        ...lib,
        folders: lib.folders.filter((f) => !isInside(f, path)),
        sessions: lib.sessions.filter((s) => !isInside(s.folder, path)),
      };
    }
  }
}

const isString = (v: unknown): v is string => typeof v === "string";

function isSavedAuth(v: unknown): v is SavedAuth {
  if (typeof v !== "object" || v === null) return false;
  const auth = v as Record<string, unknown>;
  if (auth.method === "key") return isString(auth.path);
  return auth.method === "password" || auth.method === "agent";
}

const oneOf = <T>(values: readonly T[], v: unknown): v is T => values.includes(v as T);

function isSavedSerialSession(s: Record<string, unknown>): boolean {
  return (
    isString(s.id) &&
    isString(s.name) &&
    isString(s.folder) &&
    isString(s.path) &&
    Number.isSafeInteger(s.baud) &&
    (s.baud as number) > 0 &&
    oneOf([5, 6, 7, 8], s.dataBits) &&
    oneOf(["none", "odd", "even"], s.parity) &&
    oneOf([1, 2], s.stopBits) &&
    oneOf(["none", "software", "hardware"], s.flow)
  );
}

/** Sessions without `kind` come from files written before serial sessions and are SSH. */
function isLibrarySession(v: unknown): v is LibrarySession {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind === "serial") return isSavedSerialSession(s);
  if (s.kind !== undefined && s.kind !== "ssh") return false;
  return (
    isString(s.id) &&
    isString(s.name) &&
    isString(s.folder) &&
    isString(s.host) &&
    isString(s.username) &&
    Number.isInteger(s.port) &&
    isSavedAuth(s.auth)
  );
}

export type ParseResult = { ok: true; library: SessionLibrary } | { ok: false; error: string };

/** A missing file is an empty library; anything unreadable is an error, never silently emptied. */
export function parseLibrary(json: string | null): ParseResult {
  if (json === null) return { ok: true, library: emptyLibrary };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `sessions file is not valid JSON: ${String(err)}` };
  }
  const lib = data as Partial<SessionLibrary>;
  if (lib?.version !== 1) return { ok: false, error: "unsupported sessions file version" };
  if (!Array.isArray(lib.folders) || !lib.folders.every(isString)) {
    return { ok: false, error: "sessions file has invalid folders" };
  }
  if (!Array.isArray(lib.sessions) || !lib.sessions.every(isLibrarySession)) {
    return { ok: false, error: "sessions file has invalid sessions" };
  }
  const sessions = lib.sessions.map(sanitizeSession);
  return { ok: true, library: { version: 1, folders: lib.folders, sessions } };
}

export function serializeLibrary(lib: SessionLibrary): string {
  const sessions = lib.sessions.map(sanitizeSession);
  return JSON.stringify({ version: 1, folders: lib.folders, sessions }, null, 2);
}

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Folders first, then sessions, both sorted; a filter keeps matches and the folders leading to them. */
export function buildTree(lib: SessionLibrary, filter: string): TreeNode[] {
  const needle = filter.trim().toLowerCase();
  const matches = (s: LibrarySession) =>
    !needle ||
    s.name.toLowerCase().includes(needle) ||
    (isSerialSession(s) ? s.path : s.host).toLowerCase().includes(needle);

  const build = (parent: string): TreeNode[] => {
    const folders: TreeNode[] = lib.folders
      .filter((f) => f.includes("/") ? f.slice(0, f.lastIndexOf("/")) === parent : parent === "")
      .map((path) => ({
        kind: "folder" as const,
        name: path.slice(path.lastIndexOf("/") + 1),
        path,
        children: build(path),
      }))
      .filter((node) => !needle || node.children.length > 0)
      .sort(byName);
    const sessions: TreeNode[] = lib.sessions
      .filter((s) => s.folder === parent && matches(s))
      .map((session) => ({ kind: "session" as const, name: session.name, session }))
      .sort(byName);
    return [...folders, ...sessions];
  };
  return build("");
}

export function toTarget(saved: SavedSession, password?: string): SshTarget;
export function toTarget(saved: SavedSerialSession): SerialTarget;
export function toTarget(saved: LibrarySession, password?: string): SshTarget | SerialTarget;
export function toTarget(saved: LibrarySession, password?: string): SshTarget | SerialTarget {
  if (isSerialSession(saved)) {
    const { path, baud, dataBits, parity, stopBits, flow } = saved;
    return { type: "serial", path, baud, dataBits, parity, stopBits, flow };
  }
  const auth =
    saved.auth.method === "password"
      ? { method: "password" as const, password: password ?? "" }
      : saved.auth;
  return { type: "ssh", host: saved.host, port: saved.port, username: saved.username, auth };
}
