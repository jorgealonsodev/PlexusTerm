import { t } from "../../i18n/i18n";
import {
  isSshSession,
  isTelnetSession,
  normalizeFolder,
  type LibrarySession,
  type SavedAuth,
  type SavedSession,
  type SavedTelnetSession,
  type SessionLibrary,
} from "./library";

/** An SSH or Telnet session read from an import file (sessions .ini or ssh config); secrets are never read. */
export type ImportedSession =
  | {
      kind: "ssh";
      name: string;
      /** Already placed under the top-level "Imported" folder. */
      folder: string;
      host: string;
      port: number;
      username: string;
      /** Password auth (asked at connect time) when absent. */
      auth?: SavedAuth;
      /** Names of the imported sessions to go through first, outermost first. */
      jumps?: string[];
      /** Local command that carries the connection (ssh config `ProxyCommand`); never with `jumps`. */
      proxyCommand?: string;
    }
  | { kind: "telnet"; name: string; folder: string; host: string; port: number };

export interface ParsedImport {
  sessions: ImportedSession[];
  /** Skipped lines per session type ("Telnet", "type 7") or reason ("invalid", "unrecognized"). */
  skipped: Record<string, number>;
}

export interface ImportPlan {
  toAdd: LibrarySession[];
  duplicates: number;
  skipped: Record<string, number>;
}

export const IMPORT_ROOT = "Imported";

const SSH_TYPE = 109;
const TELNET_TYPE = 98;

const TYPE_LABELS: Record<number, string> = {
  1: "RDP",
  2: "VNC",
  131: "Serial",
  105: "WSL",
  4: "FTP",
};

const SESSION_VALUE = /^#(\d+)#\d*%(.*)$/;
const BOOKMARKS_SECTION = /^\[Bookmarks(_\d+)?\]$/i;

/** These files are often in the Windows ANSI code page; newer ones may be UTF-8 (with or without a BOM). */
export function decodeIni(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.startsWith("﻿") ? text.slice(1) : text;
}

function parsePort(value: string | undefined, fallback: number): number {
  const trimmed = (value ?? "").trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : fallback;
}

interface Section {
  subRep: string;
  entries: { name: string; value: string }[];
}

/** Reads only the [Bookmarks] / [Bookmarks_N] sections; every other section (e.g. [Passwords]) is ignored. */
export function parseSessionsIni(text: string): ParsedImport {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    if (line.startsWith("[")) {
      current = BOOKMARKS_SECTION.test(line) ? { subRep: "", entries: [] } : null;
      if (current) sections.push(current);
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key === "SubRep") current.subRep = value;
    else if (key !== "ImgNum") current.entries.push({ name: key, value });
  }

  const sessions: ImportedSession[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const section of sections) {
    const folder = normalizeFolder(`${IMPORT_ROOT}/${section.subRep.replace(/\\/g, "/")}`);
    for (const { name, value } of section.entries) {
      const match = SESSION_VALUE.exec(value.trim());
      if (!match) {
        skip("unrecognized");
        continue;
      }
      const type = Number(match[1]);
      if (type !== SSH_TYPE && type !== TELNET_TYPE) {
        skip(TYPE_LABELS[type] ?? `type ${type}`);
        continue;
      }
      // Telnet lines start like SSH ones: host, then port.
      const fields = match[2].split("%");
      const host = (fields[0] ?? "").trim();
      if (!host) {
        skip("invalid");
        continue;
      }
      if (type === TELNET_TYPE) {
        sessions.push({ kind: "telnet", name, folder, host, port: parsePort(fields[1], 23) });
      } else {
        const username = (fields[2] ?? "").trim();
        sessions.push({ kind: "ssh", name, folder, host, port: parsePort(fields[1], 22), username });
      }
    }
  }
  return { sessions, skipped };
}

const identity = (s: SavedSession | SavedTelnetSession | ImportedSession) =>
  JSON.stringify([
    s.kind ?? "ssh",
    normalizeFolder(s.folder),
    s.name,
    s.host,
    s.port,
    s.kind === "telnet" ? "" : s.username,
  ]);

const nameKey = (folder: string, name: string) => JSON.stringify([normalizeFolder(folder), name]);

/**
 * New SSH sessions keep the imported auth, or use password auth (asked at connect time); exact
 * duplicates are skipped. Jump names become the ids of the sessions saved in the same folder.
 */
export function planImport(library: SessionLibrary, parsed: ParsedImport, newId: () => string): ImportPlan {
  const comparable = library.sessions.filter(
    (s): s is SavedSession | SavedTelnetSession => isSshSession(s) || isTelnetSession(s),
  );
  const seen = new Map(comparable.map((s) => [identity(s), s.id]));
  const idByName = new Map<string, string>();
  const toAdd: (SavedSession | SavedTelnetSession)[] = [];
  const jumpsOf = new Map<SavedSession, string[]>();
  let duplicates = 0;
  for (const session of parsed.sessions) {
    const key = identity(session);
    const existing = seen.get(key);
    if (existing) {
      duplicates++;
      idByName.set(nameKey(session.folder, session.name), existing);
      continue;
    }
    const id = newId();
    seen.set(key, id);
    idByName.set(nameKey(session.folder, session.name), id);
    if (session.kind === "telnet") {
      toAdd.push({ ...session, id });
      continue;
    }
    const { jumps, auth, ...rest } = session;
    const saved: SavedSession = { ...rest, id, auth: auth ?? { method: "password" } };
    if (jumps?.length) jumpsOf.set(saved, jumps.map((name) => nameKey(session.folder, name)));
    toAdd.push(saved);
  }
  for (const [saved, names] of jumpsOf) {
    const jumpIds = names.map((name) => idByName.get(name));
    if (jumpIds.every((id): id is string => id !== undefined)) saved.jumpIds = jumpIds;
  }
  return { toAdd, duplicates, skipped: parsed.skipped };
}

/** Readable label for a key of `skipped`. */
export function skippedLabel(key: string): string {
  if (key === "invalid") return t("sessions.import.skippedInvalid");
  if (key === "unrecognized") return t("sessions.import.skippedUnrecognized");
  if (key === "Serial") return t("sessions.import.skippedSerial");
  if (key === "include") return t("sessions.import.skippedInclude");
  if (key === "match") return t("sessions.import.skippedMatch");
  if (key === "proxyCommand") return t("sessions.import.skippedProxyCommand");
  if (key === "jump") return t("sessions.import.skippedJump");
  const unknown = /^type (\d+)$/.exec(key);
  if (unknown) return t("sessions.import.skippedUnknownType", { type: unknown[1] });
  return t("sessions.import.skippedType", { type: key });
}
