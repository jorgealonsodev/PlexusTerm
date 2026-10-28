/**
 * Reading and playing asciicast v2 recordings (`.cast`, S6): the parser and the playback clock,
 * apart from any terminal so they can be tested on their own.
 */

/** An event the player replays: output (`o`) or a resize to `COLSxROWS` (`r`). */
export interface CastEvent {
  /** Seconds since the recording started. */
  time: number;
  type: "o" | "r";
  data: string;
}

export interface Cast {
  /** The terminal's size when the recording started. */
  width: number;
  height: number;
  /** In time order. */
  events: CastEvent[];
  /** Time of the last event, in seconds. */
  duration: number;
}

/** A file that is not an asciicast v2 recording; the message says why (and on which line). */
export class CastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CastError";
  }
}

/** Largest terminal side a recording may ask for; beyond it the file is not a sensible recording. */
const MAX_SIDE = 2000;
const SIZE = /^(\d+)x(\d+)$/;

const isSide = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SIDE;

/** The size `COLSxROWS` of a resize event, or null when it is not one. */
export function parseSize(data: string): { cols: number; rows: number } | null {
  const match = SIZE.exec(data);
  if (!match) return null;
  const cols = Number(match[1]);
  const rows = Number(match[2]);
  return isSide(cols) && isSide(rows) ? { cols, rows } : null;
}

/**
 * Reads an asciicast v2 file: a JSON header line with `version` 2 and the size, then one
 * `[time, type, data]` JSON array per line. Output and resizes are kept; input (`i`), markers (`m`)
 * and other event types are skipped. Throws {@link CastError} for anything else.
 */
export function parseCast(text: string): Cast {
  const lines = text.split("\n");
  let index = lines.findIndex((line) => line.trim() !== "");
  if (index === -1) throw new CastError("the file is empty");
  const where = (i: number) => `line ${i + 1}`;
  let header: unknown;
  try {
    header = JSON.parse(lines[index]);
  } catch {
    throw new CastError(`${where(index)}: the header is not JSON`);
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw new CastError(`${where(index)}: the header is not a JSON object`);
  }
  const { version, width, height } = header as Record<string, unknown>;
  if (version !== 2) throw new CastError(`${where(index)}: not an asciicast version 2 file`);
  if (!isSide(width) || !isSide(height)) throw new CastError(`${where(index)}: the header has no valid width and height`);

  const events: CastEvent[] = [];
  let last = 0;
  for (index++; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new CastError(`${where(index)}: the event is not JSON`);
    }
    if (!Array.isArray(event) || event.length < 3) throw new CastError(`${where(index)}: an event is [time, type, data]`);
    const [time, type, data] = event as unknown[];
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0) {
      throw new CastError(`${where(index)}: the time is not a number of seconds`);
    }
    if (typeof type !== "string" || typeof data !== "string") throw new CastError(`${where(index)}: the type and data are not text`);
    if (type === "r" && !parseSize(data)) throw new CastError(`${where(index)}: a resize is COLSxROWS`);
    if (type !== "o" && type !== "r") continue;
    // A clock that went back a little (a recorder's rounding) must not reorder the events.
    last = Math.max(last, time);
    events.push({ time: last, type, data });
  }
  return { width, height, events, duration: last };
}

/** A time in the player: `m:ss`, or `h:mm:ss` from an hour on. */
export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export interface CastPlayer {
  play: () => void;
  pause: () => void;
  playing: () => boolean;
  /** 1 plays at the recorded pace, 2 twice as fast. */
  setSpeed: (speed: number) => void;
  /** Where the playback is, in seconds of the recording. */
  position: () => number;
  /** Jumps to `seconds`: the screen starts again and everything up to there is written at once. */
  seek: (seconds: number) => void;
  dispose: () => void;
}

/**
 * Plays a recording on a screen: each event is written when its time comes, at `speed` times the
 * recorded pace, with one timer for the next event (events due together are written together).
 * `onChange` is told when playback starts or stops on its own (the end of the recording).
 */
export function createCastPlayer(
  cast: Cast,
  {
    write,
    resize,
    reset,
    now = () => performance.now(),
    onChange,
  }: {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    reset: () => void;
    /** A clock in milliseconds. */
    now?: () => number;
    onChange?: () => void;
  },
): CastPlayer {
  const { events, duration } = cast;
  /** The next event to play. */
  let next = 0;
  /** Where the playback was at `anchorAt` (or is, while paused). */
  let anchor = 0;
  let anchorAt = 0;
  let speed = 1;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const position = () => (running ? Math.min(duration, anchor + ((now() - anchorAt) / 1000) * speed) : anchor);

  /** Plays the events up to `until` (inclusive), joining consecutive outputs into one write. */
  const playUntil = (until: number) => {
    let output = "";
    for (; next < events.length && events[next].time <= until; next++) {
      const event = events[next];
      if (event.type === "o") {
        output += event.data;
        continue;
      }
      if (output) write(output);
      output = "";
      const size = parseSize(event.data);
      if (size) resize(size.cols, size.rows);
    }
    if (output) write(output);
  };

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const tick = () => {
    timer = null;
    if (!running || disposed) return;
    const at = position();
    playUntil(at);
    if (next >= events.length) {
      running = false;
      anchor = duration;
      onChange?.();
      return;
    }
    timer = setTimeout(tick, Math.max(0, ((events[next].time - at) / speed) * 1000));
  };

  const reanchor = () => {
    anchor = position();
    anchorAt = now();
  };

  const seek = (seconds: number) => {
    const target = Math.max(0, Math.min(duration, seconds));
    clearTimer();
    reset();
    resize(cast.width, cast.height);
    next = 0;
    playUntil(target);
    anchor = target;
    anchorAt = now();
    if (running) tick();
  };

  return {
    play() {
      if (running || disposed) return;
      if (next >= events.length && events.length > 0) seek(0);
      running = true;
      anchorAt = now();
      onChange?.();
      tick();
    },
    pause() {
      if (!running) return;
      reanchor();
      running = false;
      clearTimer();
      onChange?.();
    },
    playing: () => running,
    setSpeed(value) {
      if (value <= 0 || value === speed) return;
      if (running) reanchor();
      speed = value;
      if (running) {
        clearTimer();
        tick();
      }
    },
    position,
    seek,
    dispose() {
      disposed = true;
      running = false;
      clearTimer();
    },
  };
}
