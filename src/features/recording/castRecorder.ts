import { createAppendQueue } from "../terminal/sessionLog";

/**
 * Records a terminal session to an asciinema v2 file (`.cast`, S6): a JSON header with the size and
 * start time, then one JSON array per line, `[seconds, "o", data]` for output and
 * `[seconds, "r", "COLSxROWS"]` for a resize. What the user types is never recorded.
 */
export interface CastRecorder {
  /** Output the session received. */
  output: (data: string) => void;
  /** The terminal took a new size. */
  resize: (cols: number, rows: number) => void;
  /** Writes what is queued and stops; later output is ignored. */
  stop: () => Promise<void>;
}

/** Most text waiting for the disk; events beyond it are left out whole. */
export const MAX_CAST_BACKLOG = 8 * 1024 * 1024;
/** Outputs this close to the one before (in milliseconds) join its event: fewer lines, same playback. */
export const MERGE_MS = 10;

const pad = (n: number) => String(n).padStart(2, "0");

/** The name offered in the save dialog: `session-YYYYMMDD-HHMMSS.cast`, the local start time. */
export const recordingFileName = (date = new Date()) =>
  `session-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
  `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.cast`;

const eventLine = (seconds: number, type: "o" | "r", data: string) =>
  `[${seconds.toFixed(6)}, "${type}", ${JSON.stringify(data)}]\n`;

/**
 * Starts recording to `path`: `write` creates the file with the header (replacing one the user
 * chose to overwrite), then `append` adds the events in batches every `intervalMs`, one call at a
 * time, as the session log does.
 */
export function createCastRecorder(
  path: string,
  files: {
    write: (path: string, text: string) => Promise<unknown>;
    append: (path: string, text: string) => Promise<unknown>;
  },
  {
    cols,
    rows,
    now = () => performance.now(),
    startedAt = new Date(),
    intervalMs = 200,
    maxBacklog = MAX_CAST_BACKLOG,
    droppedNote = (count: number) => `[${count} characters of output not recorded: the disk was too slow]`,
    onError,
  }: {
    cols: number;
    rows: number;
    /** A monotonic clock in milliseconds. */
    now?: () => number;
    startedAt?: Date;
    intervalMs?: number;
    maxBacklog?: number;
    /** The text played back where events were left out. */
    droppedNote?: (count: number) => string;
    onError?: (error: unknown) => void;
  },
): CastRecorder {
  const start = now();
  const elapsed = () => Math.max(0, now() - start) / 1000;
  let created = false;
  /** Time of the last event, where a note about left-out events goes. */
  let lastTime = 0;
  const queue = createAppendQueue(
    path,
    (file, text) => {
      if (created) return files.append(file, text);
      created = true;
      return files.write(file, text);
    },
    {
      maxBacklog,
      whole: true,
      droppedNote: (count) => eventLine(lastTime, "o", `\r\n${droppedNote(count)}\r\n`),
      onError,
    },
  );
  const header = { version: 2, width: cols, height: rows, timestamp: Math.floor(startedAt.getTime() / 1000), env: { TERM: "xterm-256color" } };
  queue.push(`${JSON.stringify(header)}\n`);

  /** Events of the current batch, in order; an output may still grow while outputs keep coming. */
  let events: { time: number; type: "o" | "r"; data: string }[] = [];
  let stopped = false;

  const flush = () => {
    if (events.length === 0) return;
    queue.push(...events.map((event) => eventLine(event.time, event.type, event.data)));
    events = [];
  };
  const timer = setInterval(flush, intervalMs);

  const add = (type: "o" | "r", data: string) => {
    if (stopped || queue.failed) return;
    const time = elapsed();
    lastTime = time;
    const last = events[events.length - 1];
    if (type === "o" && last?.type === "o" && (time - last.time) * 1000 < MERGE_MS) last.data += data;
    else events.push({ time, type, data });
  };

  return {
    output(data) {
      if (data !== "") add("o", data);
    },
    resize(newCols, newRows) {
      add("r", `${newCols}x${newRows}`);
    },
    async stop() {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
        flush();
      }
      await queue.drain();
    },
  };
}
