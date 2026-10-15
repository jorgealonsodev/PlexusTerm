import type { SshTarget } from "./types";

/** Saved auth never contains secrets: passwords are asked at connect time. */
export type SavedAuth = { method: "password" } | { method: "key"; path: string } | { method: "agent" };

export interface SavedSession {
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
  host: string;
  port: number;
  username: string;
  auth: SavedAuth;
}

export interface SessionLibrary {
  version: 1;
  folders: string[];
  sessions: SavedSession[];
}

export type LibraryAction =
  | { type: "saveSession"; session: SavedSession }
  /** Saves several sessions with a single write (e.g. an import). */
  | { type: "saveSessions"; sessions: SavedSession[] }
  | { type: "deleteSession"; id: string }
  | { type: "addFolder"; path: string }
  | { type: "deleteFolder"; path: string };

export type TreeNode =
  | { kind: "folder"; name: string; path: string; children: TreeNode[] }
  | { kind: "session"; name: string; session: SavedSession };

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

export function libraryReducer(lib: SessionLibrary, action: LibraryAction): SessionLibrary {
  switch (action.type) {
    case "saveSession": {
      const session = {
        ...action.session,
        folder: normalizeFolder(action.session.folder),
        auth: sanitizeAuth(action.session.auth),
      };
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

function isSavedSession(v: unknown): v is SavedSession {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
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
  if (!Array.isArray(lib.sessions) || !lib.sessions.every(isSavedSession)) {
    return { ok: false, error: "sessions file has invalid sessions" };
  }
  return { ok: true, library: { version: 1, folders: lib.folders, sessions: lib.sessions } };
}

export function serializeLibrary(lib: SessionLibrary): string {
  const sessions = lib.sessions.map((s) => ({ ...s, auth: sanitizeAuth(s.auth) }));
  return JSON.stringify({ version: 1, folders: lib.folders, sessions }, null, 2);
}

const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** Folders first, then sessions, both sorted; a filter keeps matches and the folders leading to them. */
export function buildTree(lib: SessionLibrary, filter: string): TreeNode[] {
  const needle = filter.trim().toLowerCase();
  const matches = (s: SavedSession) =>
    !needle || s.name.toLowerCase().includes(needle) || s.host.toLowerCase().includes(needle);

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

export function toTarget(saved: SavedSession, password?: string): SshTarget {
  const auth =
    saved.auth.method === "password"
      ? { method: "password" as const, password: password ?? "" }
      : saved.auth;
  return { type: "ssh", host: saved.host, port: saved.port, username: saved.username, auth };
}
