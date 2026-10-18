/** One desktop notification per source (a pane) at most this often: a flood of bells is one. */
export const NOTIFY_PER_SOURCE_MS = 10_000;
/** And at most `NOTIFY_WINDOW_MAX` from every source together in any `NOTIFY_WINDOW_MS`. */
export const NOTIFY_WINDOW_MS = 10_000;
export const NOTIFY_WINDOW_MAX = 3;

export interface Notifier {
  /** Sends the notification unless the limits hold it back; true when it was sent. */
  notify: (source: string, title: string, body: string) => boolean;
}

/** Rate-limits desktop notifications so that a program ringing the bell over and over cannot spam the desktop. */
export function createNotifier({
  send,
  now = Date.now,
}: {
  send: (title: string, body: string) => void;
  now?: () => number;
}): Notifier {
  const lastBySource = new Map<string, number>();
  let recent: number[] = [];
  return {
    notify(source, title, body) {
      const at = now();
      const last = lastBySource.get(source);
      if (last !== undefined && at - last < NOTIFY_PER_SOURCE_MS) return false;
      recent = recent.filter((time) => at - time < NOTIFY_WINDOW_MS);
      if (recent.length >= NOTIFY_WINDOW_MAX) return false;
      recent.push(at);
      lastBySource.set(source, at);
      send(title, body);
      return true;
    },
  };
}
