import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_HISTORY,
  isHistoryFile,
  parseHistory,
  recentCommands,
  recordCommand,
  serializeHistory,
  suggest,
  type HistoryData,
} from "./history";

export interface HistoryIo {
  load: () => Promise<unknown>;
  save: (json: string) => Promise<unknown>;
}

/** The command history shared by every terminal pane (S1). */
export interface HistoryStore {
  /** Resolves once history.json was read (or could not be). */
  ready: () => Promise<void>;
  record: (hostKey: string, command: string) => void;
  suggest: (hostKey: string, prefix: string) => string | null;
  recent: (hostKey: string, count: number) => string[];
  /** Empties the history, in memory and on disk. */
  clear: () => Promise<void>;
  /** Writes pending changes now. */
  flush: () => Promise<void>;
}

/**
 * Loads history.json on first use and saves it a moment after the last recorded command,
 * one save at a time. A file that could not be read is never overwritten.
 */
export function createHistoryStore(
  io: HistoryIo,
  { debounceMs = 1000, now = Date.now }: { debounceMs?: number; now?: () => number } = {},
): HistoryStore {
  let data: HistoryData = EMPTY_HISTORY;
  let loading: Promise<void> | null = null;
  let canSave = true;
  /** Commands recorded before the file was read, replayed onto it. */
  let early: { hostKey: string; command: string; at: number }[] = [];
  let loaded = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const write = () => {
    if (!canSave) return queue;
    const json = serializeHistory(data);
    queue = queue.then(() => io.save(json)).catch(() => {});
    return queue;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, debounceMs);
  };

  const ready = () => {
    loading ??= io
      .load()
      .then(
        (json) => {
          // A file that is not valid history is kept as it is, like one that cannot be read.
          if (!isHistoryFile(json)) {
            canSave = false;
            return;
          }
          if (!loaded) data = parseHistory(json);
        },
        () => {
          // The commands recorded so far are already in memory.
          canSave = false;
          early = [];
        },
      )
      .then(() => {
        if (loaded) return;
        loaded = true;
        for (const { hostKey, command, at } of early) data = recordCommand(data, hostKey, command, at);
        if (early.length) schedule();
        early = [];
      });
    return loading;
  };

  return {
    ready,
    record(hostKey, command) {
      const at = now();
      if (!loaded) {
        early.push({ hostKey, command, at });
        void ready();
      }
      data = recordCommand(data, hostKey, command, at);
      if (loaded) schedule();
    },
    suggest: (hostKey, prefix) => {
      void ready();
      return suggest(data, hostKey, prefix);
    },
    recent: (hostKey, count) => recentCommands(data, hostKey, count),
    async clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      loaded = true;
      early = [];
      data = EMPTY_HISTORY;
      // Clearing is an explicit choice: it may replace even a file that could not be read.
      canSave = true;
      await write();
    },
    async flush() {
      if (!timer) return queue.then(() => {});
      clearTimeout(timer);
      timer = null;
      await write();
    },
  };
}

/** The app's command history, in history.json in the app config directory. */
export const commandHistory = createHistoryStore({
  load: () => invoke<string | null>("history_load"),
  save: (contents) => invoke("history_save", { contents }),
});

if (typeof window !== "undefined") window.addEventListener("pagehide", () => void commandHistory.flush());
