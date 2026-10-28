import { escapeStringEnd, escapeStringKind, splitIncompleteEscape, stripAnsi, type EscapeString } from "./output";

/** Longest tail kept back waiting for the end of an escape sequence. */
const MAX_TAIL = 4096;

export interface SessionLog {
  /** Queues output received from the session. */
  write: (data: string) => void;
  /** Writes what is queued and stops; later output is ignored. */
  stop: () => Promise<void>;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local date and time a logged line starts with: `[2026-10-27 09:05:07] `. */
export const logTimestamp = (date = new Date()) =>
  `[${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}] `;

/** Most text waiting for the disk; output beyond it is counted and left out of the log. */
export const MAX_LOG_BACKLOG = 8 * 1024 * 1024;

/** Text waiting for a file, written one append at a time. */
export interface AppendQueue {
  /** Queues texts (written together); what does not fit in the backlog is left out (and counted). */
  push: (...texts: string[]) => void;
  /** Resolves once nothing is in flight (what is queued meanwhile is written too). */
  drain: () => Promise<void>;
  /** An append failed: nothing more is written. */
  readonly failed: boolean;
}

/**
 * Appends text to a file one call at a time. While an append runs, later text joins one buffer of
 * at most `maxBacklog` characters, so a slow disk never makes the queue grow: what does not fit is
 * left out, and `droppedNote` writes in the file how much (in its place, in order). With `whole`,
 * each pushed text is kept or left out whole (a line that must stay intact), never cut.
 */
export function createAppendQueue(
  path: string,
  append: (path: string, text: string) => Promise<unknown>,
  {
    maxBacklog,
    droppedNote,
    onError,
    whole = false,
  }: {
    maxBacklog: number;
    droppedNote: (count: number) => string;
    onError?: (error: unknown) => void;
    whole?: boolean;
  },
): AppendQueue {
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

  return {
    push(...texts) {
      if (failed) return;
      for (const text of texts) {
        const room = Math.max(0, maxBacklog - backlog.length);
        const kept = whole ? (text.length <= room ? text.length : 0) : Math.min(room, text.length);
        backlog += text.slice(0, kept);
        dropped += text.length - kept;
      }
      pump();
    },
    async drain() {
      // What is left is at most the append in flight and one capped backlog.
      while (inFlight) await inFlight;
    },
    get failed() {
      return failed;
    },
  };
}

/**
 * Appends a session's output to a file as plain text (S15.5). Output is batched every
 * `intervalMs`, so a busy session costs one IPC call per batch instead of one per chunk, through an
 * append queue ({@link createAppendQueue}) of at most `maxBacklog` characters.
 */
export function createSessionLog(
  path: string,
  append: (path: string, text: string) => Promise<unknown>,
  {
    intervalMs = 500,
    onError,
    maxBacklog = MAX_LOG_BACKLOG,
    droppedNote = (count: number) => `\n[${count} characters of output not logged: the disk was too slow]\n`,
    timestamp,
  }: {
    intervalMs?: number;
    onError?: (error: unknown) => void;
    maxBacklog?: number;
    droppedNote?: (count: number) => string;
    /** Given, every line with output starts with what it returns (the time of its batch). */
    timestamp?: () => string;
  } = {},
): SessionLog {
  let pending = "";
  let stopped = false;
  const queue = createAppendQueue(path, append, { maxBacklog, droppedNote, onError });
  /** The last text logged ended a line: the next output starts a new one. */
  let atLineStart = true;
  /** An escape string too long to wait for (an image) is being left out until it ends. */
  let skipping: EscapeString | null = null;

  /** Puts the time before each line with output; empty lines stay empty. */
  const stamped = (text: string) => {
    if (!timestamp) return text;
    const prefix = timestamp();
    const parts = text.split("\n");
    let out = "";
    parts.forEach((part, i) => {
      if (part !== "") {
        if (atLineStart) out += prefix;
        out += part;
        atLineStart = false;
      }
      if (i < parts.length - 1) {
        out += "\n";
        atLineStart = true;
      }
    });
    return out;
  };

  const flush = (final: boolean) => {
    if (queue.failed || pending === "") return;
    let ready = "";
    for (;;) {
      if (skipping) {
        const end = escapeStringEnd(pending, skipping);
        if (end === -1) {
          // An ESC at the end may be the first half of the ST that ends the string.
          pending = !final && pending.endsWith("\x1b") ? "\x1b" : "";
          break;
        }
        skipping = null;
        pending = pending.slice(end);
      }
      const [complete, rest] = splitIncompleteEscape(pending);
      ready += complete;
      const kind = escapeStringKind(rest);
      if (kind && (final || rest.length > MAX_TAIL)) {
        // Sixel (DCS) and iTerm2 (OSC 1337) images run to megabytes: they are never logged as
        // text, however many chunks they arrive in; what follows their end is.
        skipping = kind;
        pending = rest.slice(2);
        continue;
      }
      if (final || rest.length > MAX_TAIL) [ready, pending] = [ready + rest, ""];
      else pending = rest;
      break;
    }
    queue.push(stamped(stripAnsi(ready)));
  };

  const timer = setInterval(() => flush(false), intervalMs);

  return {
    write(data) {
      if (!stopped && !queue.failed) pending += data;
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        flush(true);
      }
      await queue.drain();
    },
  };
}
