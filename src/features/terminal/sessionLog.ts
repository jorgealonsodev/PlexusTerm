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
  let failed = false;
  /** Text waiting for the append in flight to finish. */
  let backlog = "";
  /** Characters left out since the last append started. */
  let dropped = 0;
  let inFlight: Promise<void> | null = null;
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
    const text = stamped(stripAnsi(ready));
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
