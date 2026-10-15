import { t } from "../../i18n/i18n";
import { toTarget, type SavedSession } from "./library";
import { storageFor } from "./passwordFlow";
import type { JumpTarget, PasswordStorage, SshAuth, SshTarget } from "./types";

/** How one hop of a chain logs in. */
export interface HopLogin {
  auth: SshAuth;
  storage?: PasswordStorage;
}

export interface PasswordAnswer {
  password: string;
  /** Undefined while the keyring state is unknown: the saved password is left as it is. */
  remember: boolean | undefined;
}

/**
 * Prompt label for hop `index` of `hops` (jump hosts first, the target last):
 * "bastion — jump host 1 of 2" for jump hosts, "user@host" for the target.
 */
export function hopLabel(hops: SavedSession[], index: number): string {
  const hop = hops[index];
  const jumps = hops.length - 1;
  return index < jumps ? t("sessions.jumps.label", { name: hop.name, index: index + 1, total: jumps }) : `${hop.username}@${hop.host}`;
}

/**
 * Collects how every hop logs in, in order: password sessions use the password
 * saved in the keyring when there is one, otherwise `askPassword(index)` asks for it
 * (one prompt at a time). Resolves to null when a prompt is cancelled.
 *
 * Without `deps`, every password hop gets its saved-password login and nothing is asked:
 * the backend tries the SSH agent and default keys first and reports `secretMissing`
 * when the password is needed, so callers that handle it prompt after connecting.
 */
export async function collectLogins(
  hops: SavedSession[],
  deps?: {
    secretExists: (sessionId: string) => Promise<boolean>;
    askPassword: (index: number) => Promise<PasswordAnswer | null>;
  },
): Promise<HopLogin[] | null> {
  const logins: HopLogin[] = [];
  for (const [index, hop] of hops.entries()) {
    if (hop.auth.method !== "password") {
      logins.push({ auth: toTarget(hop).auth });
    } else if (!deps || (await deps.secretExists(hop.id))) {
      logins.push({ auth: { method: "storedPassword", sessionId: hop.id } });
    } else {
      const answer = await deps.askPassword(index);
      if (answer === null) return null;
      const storage = storageFor(hop, answer.remember, false);
      logins.push({ auth: { method: "password", password: answer.password }, ...(storage ? { storage } : {}) });
    }
  }
  return logins;
}

/** One jump host of a chain, with its own login. */
export function jumpTarget(session: SavedSession, login: HopLogin): JumpTarget {
  const { host, port, username } = session;
  return { name: session.name, host, port, username, ...login };
}

/** SSH target for the last of `hops`, going through the others with their own logins. */
export function chainTarget(hops: SavedSession[], logins: HopLogin[]): SshTarget {
  const last = hops.length - 1;
  const target: SshTarget = { ...toTarget(hops[last]), ...logins[last] };
  if (last === 0) return target;
  return { ...target, jumps: hops.slice(0, last).map((hop, i) => jumpTarget(hop, logins[i])) };
}

/** Replaces jump host `index` of `jumps` with `patch` applied. */
export function patchJump(jumps: JumpTarget[], index: number, patch: Partial<JumpTarget>): JumpTarget[] {
  return jumps.map((jump, i) => (i === index ? { ...jump, ...patch } : jump));
}
