/**
 * The hold rules of viewer input (PRD-share §5.3, §6.2). Held means queued, never dropped:
 * - the sharer's own keyboard has priority: viewer input waits while the sharer types;
 * - a typing viewer holds the input for 2 s after their last key; other viewers' keys wait;
 * - at a password prompt, and while Pause viewer input is on, everything waits.
 * Each entry is one complete key event or bracketed paste and is released whole.
 */

/** A typing viewer keeps the input this long after their last key. */
export const VIEWER_HOLD_MS = 2000;
/** The sharer counts as typing for this long after their last key (an assumption: the PRD gives no figure). */
export const SHARER_HOLD_MS = 1000;

export interface HeldInput {
  viewer: number;
  data: string;
}

/** Why viewer input waits right now, or null when it may go through. */
export type Block = "paused" | "password" | "sharer" | null;

export interface InputHold {
  push(viewer: number, data: string): void;
  /** Input that may be typed now, in order; the rest stays queued. */
  release(now: number, block: Block): HeldInput[];
  /** A viewer left or was disconnected: its queued keys are dropped. */
  forget(viewer: number): void;
  /** The share became View only: no queued key may be typed any more. */
  clear(): void;
  /** Viewers whose keys are waiting. */
  waiting(): number[];
  /** The viewer holding the input until `until`, if any. */
  owner(now: number): { viewer: number; until: number } | null;
  size(): number;
}

export function createInputHold(): InputHold {
  let queue: HeldInput[] = [];
  let holder: { viewer: number; until: number } | null = null;
  const current = (now: number) => (holder && holder.until > now ? holder : null);
  return {
    push(viewer, data) {
      queue.push({ viewer, data });
    },
    release(now, block) {
      if (block !== null || queue.length === 0) return [];
      const owner = current(now)?.viewer ?? queue[0].viewer;
      const out = queue.filter((entry) => entry.viewer === owner);
      if (out.length === 0) return [];
      queue = queue.filter((entry) => entry.viewer !== owner);
      holder = { viewer: owner, until: now + VIEWER_HOLD_MS };
      return out;
    },
    forget(viewer) {
      queue = queue.filter((entry) => entry.viewer !== viewer);
      if (holder?.viewer === viewer) holder = null;
    },
    clear() {
      queue = [];
      holder = null;
    },
    waiting() {
      return [...new Set(queue.map((entry) => entry.viewer))];
    },
    owner: current,
    size: () => queue.length,
  };
}

/** The block that applies, in order of importance. */
export function blockOf(state: { paused: boolean; atPassword: boolean; sharerTypedAt: number }, now: number): Block {
  if (state.paused) return "paused";
  if (state.atPassword) return "password";
  if (now - state.sharerTypedAt < SHARER_HOLD_MS) return "sharer";
  return null;
}
