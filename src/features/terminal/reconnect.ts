import type { SshError } from "../ssh/sshErrors";

/**
 * Reconnecting a dropped SSH session (S1): the waits between attempts and which failures are
 * worth another attempt. TerminalView runs the attempts.
 */

/** Waits before the first attempts, in seconds; later attempts wait as long as the last one. */
const DELAYS_S = [1, 2, 5, 10, 30];

/** About three minutes of attempts (1 + 2 + 5 + 10 + 6 × 30 s), then the pane waits for Enter. */
export const MAX_RECONNECT_ATTEMPTS = 10;

/** Seconds to wait before reconnection attempt `attempt` (1-based); null once they are used up. */
export function reconnectDelay(attempt: number): number | null {
  if (attempt < 1 || attempt > MAX_RECONNECT_ATTEMPTS) return null;
  return DELAYS_S[Math.min(attempt, DELAYS_S.length) - 1];
}

/**
 * Whether a failed reconnection attempt is tried again: only the network failing again, on the
 * host or on a jump host. A rejected login, a missing password or a host key to trust needs the
 * user, so the attempts stop and the pane's usual prompt or message takes over.
 */
export function retriesAfter(err: SshError): boolean {
  if (err.kind === "hop") return retriesAfter(err.error);
  return err.kind === "connection";
}
