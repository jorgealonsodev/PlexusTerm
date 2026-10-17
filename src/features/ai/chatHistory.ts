import { invoke } from "@tauri-apps/api/core";
import type { ChatTurn } from "./chatMemory";

/** Conversations kept in `ai-chats.json`; the oldest are dropped first. */
export const MAX_SAVED_CHATS = 100;

/** One AI conversation of the list (S9); `id` is its AI session id. */
export interface SavedChat {
  id: string;
  /** Its first question. */
  title: string;
  /** Unix milliseconds of its last answer. */
  updated: number;
  turns: ChatTurn[];
}

export interface ChatStorage {
  load: () => Promise<string | null>;
  save: (contents: string) => Promise<void>;
}

const isTurn = (value: unknown): value is ChatTurn => {
  const t = value as ChatTurn;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.id === "number" &&
    typeof t.question === "string" &&
    (t.selection === null || typeof t.selection === "string") &&
    (t.state === "answer" || t.state === "error") &&
    typeof t.answer === "string" &&
    (t.command === null || typeof t.command === "string") &&
    typeof t.error === "string" &&
    (t.files === undefined || (Array.isArray(t.files) && t.files.every((f) => typeof f === "string")))
  );
};

const isChat = (value: unknown): value is SavedChat => {
  const c = value as SavedChat;
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.updated === "number" &&
    Array.isArray(c.turns) &&
    c.turns.length > 0 &&
    c.turns.every(isTurn)
  );
};

const newestFirst = (chats: SavedChat[]) => [...chats].sort((a, b) => b.updated - a.updated).slice(0, MAX_SAVED_CHATS);

/** The conversations of an `ai-chats.json` file; a damaged file or entry is left out. */
export function parseChatHistory(contents: string): SavedChat[] {
  try {
    const data = JSON.parse(contents) as { version?: unknown; chats?: unknown };
    if (data?.version !== 1 || !Array.isArray(data.chats)) return [];
    return newestFirst(data.chats.filter(isChat));
  } catch {
    return [];
  }
}

/**
 * The AI conversations list: in memory for this run, and saved to disk while `saving()` is true
 * (Settings → AI → keep conversations). Writes are queued, one at a time.
 */
export function createChatHistory(storage: ChatStorage, saving: () => boolean) {
  let chats: SavedChat[] = [];
  const listeners = new Set<() => void>();
  /** The saved file was read (or found missing); until then nothing is written over it. */
  let fromDisk = false;
  let loading: Promise<void> | null = null;
  let writing: Promise<void> = Promise.resolve();
  const changed = () => listeners.forEach((listener) => listener());
  /** Reads the file once, merging it under what this run already has. */
  const load = (): Promise<void> => {
    if (fromDisk || !saving()) return Promise.resolve();
    loading ??= storage
      .load()
      .then((contents) => {
        const known = new Set(chats.map((c) => c.id));
        chats = newestFirst([...chats, ...(contents ? parseChatHistory(contents) : []).filter((c) => !known.has(c.id))]);
        fromDisk = true;
        changed();
      })
      .catch(() => {})
      .finally(() => (loading = null));
    return loading;
  };
  const persist = () => {
    if (!saving()) return;
    // Saving turned on later still keeps the conversations of earlier runs.
    writing = writing
      .then(load)
      .then(() => (fromDisk && saving() ? storage.save(JSON.stringify({ version: 1, chats })) : undefined))
      .catch(() => {});
  };
  return {
    /** Reads the saved conversations (only while saving is on). */
    ready: load,
    list: (): readonly SavedChat[] => chats,
    get: (id: string) => chats.find((c) => c.id === id),
    /** Records the answered turns of conversation `id`; nothing is kept until one is answered. */
    update(id: string, turns: ChatTurn[], now = Date.now()) {
      const done = turns.filter((t) => t.state !== "loading");
      if (done.length === 0) return;
      const chat: SavedChat = { id, title: done[0].question, updated: now, turns: done };
      chats = newestFirst([chat, ...chats.filter((c) => c.id !== id)]);
      changed();
      persist();
    },
    remove(id: string) {
      chats = chats.filter((c) => c.id !== id);
      changed();
      persist();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Waits for the writes queued so far. */
    flush: () => writing,
  };
}

export type ChatHistory = ReturnType<typeof createChatHistory>;

let savingOn = true;
/** Follows Settings → AI → keep conversations; the app calls it when the settings load or change. */
export const setChatSaving = (on: boolean) => void (savingOn = on);

/** The app's list, saved in `ai-chats.json` in the config folder. */
export const chatHistory = createChatHistory(
  {
    load: () => invoke<string | null>("ai_chats_load"),
    save: (contents) => invoke<void>("ai_chats_save", { contents }),
  },
  () => savingOn,
);
