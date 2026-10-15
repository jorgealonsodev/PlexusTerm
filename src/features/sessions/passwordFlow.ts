import type { SshError } from "../ssh/sshErrors";
import { isSshSession, libraryReducer, toTarget, type LibraryAction, type SavedSession, type SessionLibrary } from "./library";
import type { PasswordStorage, SshAuth, SshTarget } from "./types";

/** Label of the keyring item, as shown by keyring managers (e.g. Seahorse). */
export function secretLabel(target: { username: string; host: string; port: number }): string {
  return `NexusTerm: ${target.username}@${target.host}:${target.port}`;
}

/** Target that connects with the password saved in the keyring; the frontend never sees it. */
export function storedPasswordTarget(session: SavedSession): SshTarget {
  return { ...toTarget(session), auth: { method: "storedPassword", sessionId: session.id } };
}

/** Target that connects with a password typed in the prompt. */
export function typedPasswordTarget(
  session: SavedSession,
  password: string,
  storage: PasswordStorage | undefined,
): SshTarget {
  const target = toTarget(session, password);
  return storage ? { ...target, storage } : target;
}

/**
 * What to do with the saved password after a login with a typed one:
 * ticked saves it, unticked forgets a password saved before.
 */
export function storageFor(
  session: { id: string; username: string; host: string; port: number },
  /** `undefined` while it is unknown whether a keyring exists: change nothing. */
  remember: boolean | undefined,
  hadSecret: boolean,
): PasswordStorage | undefined {
  if (remember === undefined) return undefined;
  if (remember) return { action: "remember", sessionId: session.id, label: secretLabel(session) };
  return hadSecret ? { action: "forget", sessionId: session.id } : undefined;
}

/** True when a login with the saved password failed in a way the prompt can fix. */
export function shouldAskAgain(auth: SshAuth, err: SshError): boolean {
  return auth.method === "storedPassword" && (err.kind === "secretMissing" || err.kind === "authFailed");
}

/** Saved SSH sessions that `action` removes from `library` (their saved passwords go with them). */
export function removedSshSessions(library: SessionLibrary, action: LibraryAction): SavedSession[] {
  const kept = new Set(libraryReducer(library, action).sessions.map((s) => s.id));
  return library.sessions.filter(isSshSession).filter((s) => !kept.has(s.id));
}

/** Id whose saved password must be forgotten when `before` is edited into `after` (password auth dropped). */
export function secretToForgetOnEdit(before: SavedSession, after: SavedSession | { kind: "serial" }): string | null {
  const usedPassword = before.auth.method === "password";
  const stillPassword = isSshSession(after as SavedSession) && (after as SavedSession).auth.method === "password";
  return usedPassword && !stillPassword ? before.id : null;
}
