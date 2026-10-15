import { splitIncompleteEscape, stripAnsi } from "./output";

/** Longest tail kept back waiting for the end of an escape sequence. */
const MAX_TAIL = 4096;

export interface SessionLog {
  /** Queues output received from the session. */
  write: (data: string) => void;
  /** Writes what is queued and stops; later output is ignored. */
  stop: () => Promise<void>;
}

/**
 * Appends a session's output to a file as plain text (S15.5). Output is batched every
 * `intervalMs`, so a busy session costs one IPC call per batch instead of one per chunk.
 */
export function createSessionLog(
  path: string,
  append: (path: string, text: string) => Promise<unknown>,
  { intervalMs = 500, onError }: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): SessionLog {
  let pending = "";
  let stopped = false;
  let failed = false;
  /** Appends run one after another so batches land in order. */
  let queue: Promise<unknown> = Promise.resolve();

  const flush = (final: boolean) => {
    if (failed || pending === "") return queue;
    let [ready, rest] = final ? [pending, ""] : splitIncompleteEscape(pending);
    if (rest.length > MAX_TAIL) [ready, rest] = [pending, ""];
    pending = rest;
    const text = stripAnsi(ready);
    if (text === "") return queue;
    queue = queue.then(() =>
      failed
        ? undefined
        : append(path, text).catch((error) => {
            failed = true;
            onError?.(error);
          }),
    );
    return queue;
  };

  const timer = setInterval(() => void flush(false), intervalMs);

  return {
    write(data) {
      if (!stopped && !failed) pending += data;
    },
    async stop() {
      if (stopped) return queue.then(() => undefined);
      stopped = true;
      clearInterval(timer);
      await flush(true);
    },
  };
}
