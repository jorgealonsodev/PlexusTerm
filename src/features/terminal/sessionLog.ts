import { splitIncompleteEscape, stripAnsi } from "./output";

/** Longest tail kept back waiting for the end of an escape sequence. */
const MAX_TAIL = 4096;

export interface SessionLog {
  /** Queues output received from the session. */
  write: (data: string) => void;
  /** Writes what is queued and stops; later output is ignored. */
  stop: () => Promise<void>;
}

/** Most text waiting for the disk; output beyond it is counted and left out of the log. */
export const MAX_LOG_BACKLOG = 8 * 1024 * 1024;

/**
 * Appends a session's output to a file as plain text (S15.5). Output is batched every
 * `intervalMs`, so a busy session costs one IPC call per batch instead of one per chunk. One append
 * runs at a time; while it does, later batches join one buffer of at most `maxBacklog` characters,
 * so a slow disk never makes the queue grow: what does not fit is left out, and `droppedNote`
 * writes in the log how much (in its place, in order).
 */
export function createSessionLog(
  path: string,
  append: (path: string, text: string) => Promise<unknown>,
  {
    intervalMs = 500,
    onError,
    maxBacklog = MAX_LOG_BACKLOG,
    droppedNote = (count: number) => `\n[${count} characters of output not logged: the disk was too slow]\n`,
  }: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
    maxBacklog?: number;
    droppedNote?: (count: number) => string;
  } = {},
): SessionLog {
  let pending = "";
  let stopped = false;
  let failed = false;
  /** Text waiting for the append in flight to finish. */
  let backlog = "";
  /** Characters left out since the last append started. */
  let dropped = 0;
  let inFlight: Promise<void> | null = null;

  const pump = () => {
    if (inFlight || failed || (backlog === "" && dropped === 0)) return;
    const text = backlog + (dropped > 0 ? droppedNote(dropped) : "");
    backlog = "";
    dropped = 0;
    inFlight = append(path, text).then(
      () => {
        inFlight = null;
        pump();
      },
      (error) => {
        failed = true;
        inFlight = null;
        backlog = "";
        onError?.(error);
      },
    );
  };

  const flush = (final: boolean) => {
    if (failed || pending === "") return;
    let [ready, rest] = final ? [pending, ""] : splitIncompleteEscape(pending);
    if (rest.length > MAX_TAIL) [ready, rest] = [pending, ""];
    pending = rest;
    const text = stripAnsi(ready);
    if (text === "") return;
    const room = Math.max(0, maxBacklog - backlog.length);
    backlog += text.slice(0, room);
    dropped += Math.max(0, text.length - room);
    pump();
  };

  const timer = setInterval(() => flush(false), intervalMs);

  return {
    write(data) {
      if (!stopped && !failed) pending += data;
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        flush(true);
      }
      // What is left is at most the append in flight and one capped backlog.
      while (inFlight) await inFlight;
    },
  };
}
