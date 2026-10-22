import {
  isLocalSession,
  isMoshSession,
  isSerialSession,
  normalizeFolder,
  parseLibrary,
  serializeLibrary,
  type LibrarySession,
  type SessionLibrary,
} from "./library";
import { IMPORT_ROOT, type ImportPlan } from "./iniImport";

/** The file name the export dialog suggests. */
export const EXPORT_FILE_NAME = "plexusterm-sessions.json";

/**
 * Every saved session and folder, in the format of PlexusTerm's own sessions.json. It holds no
 * secrets: saved passwords stay in the system keyring, keys are referred to by their path.
 */
export const exportLibrary = (library: SessionLibrary): string => serializeLibrary(library);

/** Two sessions that would connect the same way under the same folder and name are the same one. */
function identity(session: LibrarySession, sshIdentity: (id: string) => string | undefined): string {
  const folder = normalizeFolder(session.folder);
  if (isSerialSession(session)) return JSON.stringify(["serial", folder, session.name, session.path]);
  if (isLocalSession(session)) return JSON.stringify(["local", folder, session.name, session.program ?? "", session.cwd ?? ""]);
  if (isMoshSession(session)) return JSON.stringify(["mosh", folder, session.name, sshIdentity(session.sshSessionId) ?? ""]);
  if (session.kind === "telnet") return JSON.stringify(["telnet", folder, session.name, session.host, session.port]);
  return JSON.stringify(["ssh", folder, session.name, session.host, session.port, session.username]);
}

const identities = (sessions: LibrarySession[]) => {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const sshIdentity = (id: string): string | undefined => {
    const ssh = byId.get(id);
    return ssh && !isMoshSession(ssh) ? identity(ssh, () => undefined) : undefined;
  };
  return (session: LibrarySession) => identity(session, sshIdentity);
};

/**
 * What importing an exported file adds: its sessions under the "Imported" folder, keeping their own
 * folders below it, with new ids; jump hosts and Mosh logins point to the new (or already saved)
 * sessions. Sessions already saved there are skipped, so importing the same file twice adds nothing.
 */
export function planLibraryImport(library: SessionLibrary, json: string, newId: () => string): ImportPlan {
  const parsed = parseLibrary(json);
  if (!parsed.ok) throw new Error(parsed.error);
  const placed = parsed.library.sessions.map((s) => ({ ...s, folder: normalizeFolder(`${IMPORT_ROOT}/${s.folder}`) }));

  const savedIdentity = identities(library.sessions);
  const seen = new Map(library.sessions.map((s) => [savedIdentity(s), s.id]));
  const importedIdentity = identities(placed);
  const newIds = new Map<string, string>();
  const toAdd: LibrarySession[] = [];
  let duplicates = 0;
  // SSH sessions first: Mosh sessions name theirs by identity.
  const order = [...placed.filter((s) => !isMoshSession(s)), ...placed.filter(isMoshSession)];
  for (const session of order) {
    const key = importedIdentity(session);
    const existing = seen.get(key);
    if (existing) {
      duplicates++;
      newIds.set(session.id, existing);
      continue;
    }
    const id = newId();
    seen.set(key, id);
    newIds.set(session.id, id);
    toAdd.push({ ...session, id });
  }

  const skipped: Record<string, number> = {};
  const linked = toAdd.flatMap((session): LibrarySession[] => {
    if (isMoshSession(session)) {
      const sshSessionId = newIds.get(session.sshSessionId);
      if (sshSessionId) return [{ ...session, sshSessionId }];
      skipped.invalid = (skipped.invalid ?? 0) + 1;
      return [];
    }
    if ((session.kind === undefined || session.kind === "ssh") && session.jumpIds?.length) {
      const jumpIds = session.jumpIds.map((id) => newIds.get(id));
      const { jumpIds: _, ...rest } = session;
      return [jumpIds.every((id): id is string => id !== undefined) ? { ...rest, jumpIds } : rest];
    }
    return [session];
  });
  return { toAdd: linked, duplicates, skipped };
}
