/**
 * Output flow control: a program that prints faster than xterm parses would pile its output up in
 * the webview (and xterm drops writes beyond 50 MB). The pane asks the backend to stop reading the
 * session while too much output waits to be parsed, and to read on once most of it was.
 */

/** Pause reading once this many characters wait to be parsed. */
export const FLOW_HIGH = 512 * 1024;
/** Resume once fewer than this many still wait. */
export const FLOW_LOW = 128 * 1024;
/**
 * While paused, the pause is asked again this often: the backend lets a pause go after 5 s (in case
 * the resume never comes), and a pane that takes longer to catch up must keep the session waiting.
 */
export const FLOW_RENEW_MS = 3000;

export interface OutputFlow {
  /** Counts `length` characters handed to xterm; call the returned function once xterm parsed them. */
  queued(length: number): () => void;
  /** The pane is gone: resume a paused session, and ask nothing more. */
  dispose(): void;
}

/** Tracks the output still to parse; `setPaused` is called only when the state changes. */
export function createOutputFlow(setPaused: (paused: boolean) => void): OutputFlow {
  let pending = 0;
  let paused = false;
  let disposed = false;
  let renew: ReturnType<typeof setInterval> | null = null;
  const pause = (on: boolean) => {
    paused = on;
    if (renew) clearInterval(renew);
    renew = on ? setInterval(() => setPaused(true), FLOW_RENEW_MS) : null;
    setPaused(on);
  };
  return {
    queued(length) {
      pending += length;
      if (!disposed && !paused && pending > FLOW_HIGH) pause(true);
      return () => {
        pending -= length;
        if (!disposed && paused && pending < FLOW_LOW) pause(false);
      };
    },
    dispose() {
      if (!disposed && paused) pause(false);
      disposed = true;
    },
  };
}
