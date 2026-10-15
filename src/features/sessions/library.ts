import { t } from "../../i18n/i18n";
import type { SerialSettings, SerialTarget, SshTarget, TelnetTarget } from "./types";

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
  /** Saved SSH sessions to go through first, outermost first (S14); absent when none. */
  jumpIds?: string[];
}

/** Most jump hosts a connection may go through. */
export const MAX_JUMPS = 3;

/** A saved serial console; no secrets are involved. */
export interface SavedSerialSession extends SerialSettings {
  kind: "serial";
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
}

/** A saved Telnet connection (S17.1); no secrets are involved. */
export interface SavedTelnetSession {
  kind: "telnet";
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
  host: string;
  port: number;
}

/** A saved Mosh session (S17.2): it logs in with the saved SSH session `sshSessionId`. */
export interface SavedMoshSession {
  kind: "mosh";
  id: string;
  name: string;
  /** Slash-separated folder path; "" is the root. */
  folder: string;
  sshSessionId: string;
  /** Replaces the default `mosh-server` command; absent when not overridden. */
  serverCommand?: string;
}

/** Any entry of the session library. */
export type LibrarySession = SavedSession | SavedSerialSession | SavedTelnetSession | SavedMoshSession;

export const isSerialSession = (s: LibrarySession): s is SavedSerialSession => s.kind === "serial";
export const isTelnetSession = (s: LibrarySession): s is SavedTelnetSession => s.kind === "telnet";
export const isMoshSession = (s: LibrarySession): s is SavedMoshSession => s.kind === "mosh";
/** Sessions without `kind` were written before other kinds existed and are SSH. */
export const isSshSession = (s: LibrarySession): s is SavedSession => s.kind === undefined || s.kind === "ssh";

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
  /** Copies a session next to it, named "<name> (copy)"; saved passwords are not copied. */
  | { type: "duplicateSession"; id: string; newId: string }
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
  if (isTelnetSession(s)) return { kind: "telnet", ...base, host: s.host, port: s.port };
  if (isMoshSession(s)) {
    const serverCommand = s.serverCommand?.trim();
    return { kind: "mosh", ...base, sshSessionId: s.sshSessionId, ...(serverCommand ? { serverCommand } : {}) };
  }
  const ssh: SavedSession = {
    kind: "ssh",
    ...base,
    host: s.host,
    port: s.port,
    username: s.username,
    auth: sanitizeAuth(s.auth),
  };
  return s.jumpIds?.length ? { ...ssh, jumpIds: [...s.jumpIds] } : ssh;
}

/** Drops `ids` from every chain of jump hosts (they are being deleted). */
function withoutJumps(sessions: LibrarySession[], ids: Set<string>): LibrarySession[] {
  return sessions.map((s) =>
    isSshSession(s) && s.jumpIds?.some((id) => ids.has(id))
      ? sanitizeSession({ ...s, jumpIds: s.jumpIds.filter((id) => !ids.has(id)) })
      : s,
  );
}

/** Removes the sessions `remove` matches, and removes them from every chain of jump hosts. */
function removeSessions(sessions: LibrarySession[], remove: (s: LibrarySession) => boolean): LibrarySession[] {
  const ids = new Set(sessions.filter(remove).map((s) => s.id));
  return withoutJumps(
    sessions.filter((s) => !ids.has(s.id)),
    ids,
  );
}

/** Saved SSH sessions, other than those in `ids`, that go through one of `ids` as a jump host. */
export function jumpUsers(library: SessionLibrary, ids: string[]): SavedSession[] {
  const deleted = new Set(ids);
  return library.sessions
    .filter(isSshSession)
    .filter((s) => !deleted.has(s.id) && s.jumpIds?.some((id) => deleted.has(id)));
}

export type ChainResult = { ok: true; jumps: SavedSession[] } | { ok: false; error: string };

/**
 * The saved SSH sessions `session` goes through, outermost first. A jump host's own
 * jump hosts come before it (like OpenSSH's ProxyJump). Missing or non-SSH jump
 * sessions, cycles, repeats and more than {@link MAX_JUMPS} hops are errors.
 */
export function resolveChain(library: Pick<SessionLibrary, "sessions">, session: SavedSession): ChainResult {
  const jumps: SavedSession[] = [];
  const visit = (current: SavedSession, path: string[]): string | null => {
    for (const id of current.jumpIds ?? []) {
      if (id === current.id) return t("sessions.chain.ownJump", { name: current.name });
      if (path.includes(id)) return t("sessions.chain.cycle", { name: session.name });
      const jump = library.sessions.find((s) => s.id === id);
      if (!jump) return t("sessions.chain.missing", { name: current.name });
      if (!isSshSession(jump)) return t("sessions.chain.notSsh", { jump: jump.name, name: current.name });
      const error = visit(jump, [...path, id]);
      if (error) return error;
      if (jumps.some((s) => s.id === id)) {
        return t("sessions.chain.repeated", { jump: jump.name, name: session.name });
      }
      jumps.push(jump);
    }
    return null;
  };
  const error = visit(session, [session.id]);
  if (error) return { ok: false, error };
  if (jumps.length > MAX_JUMPS) return { ok: false, error: t("sessions.chain.tooMany", { name: session.name, max: MAX_JUMPS }) };
  return { ok: true, jumps };
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
    case "duplicateSession": {
      const index = lib.sessions.findIndex((s) => s.id === action.id);
      if (index === -1) return lib;
      const original = lib.sessions[index];
      const copy = { ...original, id: action.newId, name: t("sessions.library.copyName", { name: original.name }) };
      return { ...lib, sessions: [...lib.sessions.slice(0, index + 1), copy, ...lib.sessions.slice(index + 1)] };
    }
    case "saveSessions":
      return action.sessions.reduce(
        (acc, session) => libraryReducer(acc, { type: "saveSession", session }),
        lib,
      );
    case "deleteSession":
      return { ...lib, sessions: removeSessions(lib.sessions, (s) => s.id === action.id) };
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
        sessions: removeSessions(lib.sessions, (s) => isInside(s.folder, path)),
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

const isPort = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 65535;

function isSavedTelnetSession(s: Record<string, unknown>): boolean {
  return isString(s.id) && isString(s.name) && isString(s.folder) && isString(s.host) && isPort(s.port);
}

function isSavedMoshSession(s: Record<string, unknown>): boolean {
  return (
    isString(s.id) &&
    isString(s.name) &&
    isString(s.folder) &&
    isString(s.sshSessionId) &&
    (s.serverCommand === undefined || isString(s.serverCommand))
  );
}

/** Sessions without `kind` come from files written before serial sessions and are SSH. */
function isLibrarySession(v: unknown): v is LibrarySession {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.kind === "serial") return isSavedSerialSession(s);
  if (s.kind === "telnet") return isSavedTelnetSession(s);
  if (s.kind === "mosh") return isSavedMoshSession(s);
  if (s.kind !== undefined && s.kind !== "ssh") return false;
  return (
    isString(s.id) &&
    isString(s.name) &&
    isString(s.folder) &&
    isString(s.host) &&
    isString(s.username) &&
    Number.isInteger(s.port) &&
    isSavedAuth(s.auth) &&
    (s.jumpIds === undefined || (Array.isArray(s.jumpIds) && s.jumpIds.every(isString)))
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
    return { ok: false, error: t("sessions.library.invalidJson", { error: String(err) }) };
  }
  const lib = data as Partial<SessionLibrary>;
  if (lib?.version !== 1) return { ok: false, error: t("sessions.library.unsupportedVersion") };
  if (!Array.isArray(lib.folders) || !lib.folders.every(isString)) {
    return { ok: false, error: t("sessions.library.invalidFolders") };
  }
  if (!Array.isArray(lib.sessions) || !lib.sessions.every(isLibrarySession)) {
    return { ok: false, error: t("sessions.library.invalidSessions") };
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
  const address = (s: LibrarySession) => (isSerialSession(s) ? s.path : isMoshSession(s) ? "" : s.host);
  const matches = (s: LibrarySession) =>
    !needle || s.name.toLowerCase().includes(needle) || address(s).toLowerCase().includes(needle);

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

/** Mosh sessions need their SSH login resolved first, so they have no direct target. */
type DirectSession = SavedSession | SavedSerialSession | SavedTelnetSession;

export function toTarget(saved: SavedSession, password?: string): SshTarget;
export function toTarget(saved: SavedSerialSession): SerialTarget;
export function toTarget(saved: SavedTelnetSession): TelnetTarget;
export function toTarget(saved: DirectSession, password?: string): SshTarget | SerialTarget | TelnetTarget;
export function toTarget(saved: DirectSession, password?: string): SshTarget | SerialTarget | TelnetTarget {
  if (isTelnetSession(saved)) return { type: "telnet", host: saved.host, port: saved.port };
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
