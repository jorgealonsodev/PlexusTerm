/**
 * Times the commands the shell marks (OSC 133 C when one starts running, D with its exit code when
 * it ends), so a pane can say when a long one finished: a build or the tests you left running while
 * you looked elsewhere.
 */

export interface FinishedCommand {
  /** The command line sent with Enter; "" when it is not known. */
  command: string;
  /** Its exit code; null when the shell reports none (cmd). */
  exit: number | null;
  ms: number;
}

export interface CommandTimer {
  /** A command started running (the C mark). */
  started(command: string): void;
  /** The command ended (the D mark); returns it when it ran at least `minMs`, else null. */
  finished(exit: number | null, minMs: number): FinishedCommand | null;
}

export function createCommandTimer(now: () => number = () => performance.now()): CommandTimer {
  let running: { command: string; since: number } | null = null;
  return {
    started(command) {
      running = { command, since: now() };
    },
    finished(exit, minMs) {
      const ran = running;
      running = null;
      if (!ran || minMs <= 0) return null;
      const ms = now() - ran.since;
      return ms >= minMs ? { command: ran.command, exit, ms } : null;
    },
  };
}

/** A duration as people read it: "45 s", "2 min 14 s", "1 h 3 min" (SI symbols, the same in every language). */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`;
  if (min > 0) return s > 0 ? `${min} min ${s} s` : `${min} min`;
  return `${s} s`;
}

/** The longest command line a notice shows; a notification only has a line or two. */
const MAX_COMMAND = 80;

/** A command line shortened for a notice: its first line, cut with an ellipsis. */
export function shortCommand(command: string): string {
  const first = command.trim().split(/\r?\n/)[0] ?? "";
  return first.length > MAX_COMMAND ? `${first.slice(0, MAX_COMMAND - 1)}…` : first;
}
