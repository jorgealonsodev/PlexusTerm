/** Minimum pause between two AI suggestion requests of one pane (S2). */
export const AI_MIN_INTERVAL_MS = 1000;

interface Waiting<T> {
  run: () => Promise<T>;
  resolve: (value: T | null) => void;
  reject: (err: unknown) => void;
}

interface PaneState<T> {
  busy: boolean;
  /** When the last request was sent, or -Infinity. */
  last: number;
  waiting: Waiting<T> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Rate limit for AI requests, per pane: at most one in flight and at least `minIntervalMs`
 * between two sends. Only the newest waiting request is sent; one it replaces resolves null.
 */
export function createAiLimiter(minIntervalMs = AI_MIN_INTERVAL_MS, now: () => number = () => Date.now()) {
  const panes = new Map<string, PaneState<unknown>>();

  const pump = (paneId: string) => {
    const pane = panes.get(paneId);
    if (!pane || pane.busy || pane.timer || !pane.waiting) return;
    const delay = pane.last + minIntervalMs - now();
    if (delay > 0) {
      pane.timer = setTimeout(() => {
        pane.timer = null;
        pump(paneId);
      }, delay);
      return;
    }
    const { run, resolve, reject } = pane.waiting;
    pane.waiting = null;
    pane.busy = true;
    pane.last = now();
    let sent: Promise<unknown>;
    try {
      sent = run();
    } catch (err) {
      sent = Promise.reject(err);
    }
    sent.then(resolve, reject).finally(() => {
      pane.busy = false;
      pump(paneId);
    });
  };

  return function limit<T>(paneId: string, run: () => Promise<T>): Promise<T | null> {
    let pane = panes.get(paneId) as PaneState<T> | undefined;
    if (!pane) {
      pane = { busy: false, last: -Infinity, waiting: null, timer: null };
      panes.set(paneId, pane as PaneState<unknown>);
    }
    pane.waiting?.resolve(null);
    const result = new Promise<T | null>((resolve, reject) => {
      pane.waiting = { run, resolve, reject };
    });
    pump(paneId);
    return result;
  };
}
