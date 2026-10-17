import { describe, expect, it, vi } from "vitest";
import { MAX_SAVED_CHATS, createChatHistory, parseChatHistory, type SavedChat } from "./chatHistory";
import type { ChatTurn } from "./chatMemory";

const turn = (question: string, state: ChatTurn["state"] = "answer"): ChatTurn => ({
  id: 1,
  question,
  selection: null,
  state,
  answer: state === "answer" ? `answer to ${question}` : "",
  command: null,
  error: "",
});

const storage = (initial: string | null = null) => {
  let file = initial;
  return {
    load: vi.fn(async () => file),
    save: vi.fn(async (contents: string) => void (file = contents)),
    file: () => file,
  };
};

describe("chat history (S9)", () => {
  it("keeps answered conversations newest first, titled by their first question, and saves them", async () => {
    const disk = storage();
    const history = createChatHistory(disk, () => true);
    await history.ready();
    history.update("a", [turn("list files")], 1000);
    history.update("b", [turn("disk usage"), turn("and in GB?")], 2000);
    history.update("a", [turn("list files"), turn("hidden too")], 3000);
    expect(history.list().map((c) => [c.id, c.title, c.updated])).toEqual([
      ["a", "list files", 3000],
      ["b", "disk usage", 2000],
    ]);
    await history.flush();
    const saved = JSON.parse(disk.file()!);
    expect(saved.version).toBe(1);
    expect(saved.chats.map((c: SavedChat) => c.id)).toEqual(["a", "b"]);
  });

  it("never keeps questions still waiting, nor empty conversations", async () => {
    const history = createChatHistory(storage(), () => true);
    await history.ready();
    history.update("a", [turn("pending", "loading")], 1);
    expect(history.list()).toEqual([]);
    history.update("b", [turn("ok"), turn("pending", "loading")], 2);
    expect(history.get("b")!.turns.map((t) => t.question)).toEqual(["ok"]);
  });

  it("reads the saved conversations and drops the oldest beyond the limit", async () => {
    const chats = Array.from({ length: MAX_SAVED_CHATS + 5 }, (_, i) => ({
      id: `c${i}`,
      title: `q${i}`,
      updated: i,
      turns: [turn(`q${i}`)],
    }));
    const history = createChatHistory(storage(JSON.stringify({ version: 1, chats })), () => true);
    await history.ready();
    expect(history.list()).toHaveLength(MAX_SAVED_CHATS);
    expect(history.list()[0].id).toBe(`c${MAX_SAVED_CHATS + 4}`);
  });

  it("deletes a conversation", async () => {
    const disk = storage();
    const history = createChatHistory(disk, () => true);
    await history.ready();
    history.update("a", [turn("x")], 1);
    history.remove("a");
    await history.flush();
    expect(history.list()).toEqual([]);
    expect(JSON.parse(disk.file()!).chats).toEqual([]);
  });

  it("neither reads nor writes the file when saving is off", async () => {
    const disk = storage(JSON.stringify({ version: 1, chats: [{ id: "old", title: "t", updated: 1, turns: [turn("t")] }] }));
    const history = createChatHistory(disk, () => false);
    await history.ready();
    expect(history.list()).toEqual([]);
    history.update("a", [turn("x")], 1);
    await history.flush();
    expect(history.list().map((c) => c.id)).toEqual(["a"]);
    expect(disk.load).not.toHaveBeenCalled();
    expect(disk.save).not.toHaveBeenCalled();
  });

  it("keeps earlier runs' conversations when saving is turned on later", async () => {
    const disk = storage(JSON.stringify({ version: 1, chats: [{ id: "old", title: "t", updated: 1, turns: [turn("t")] }] }));
    let on = false;
    const history = createChatHistory(disk, () => on);
    await history.ready();
    history.update("a", [turn("x")], 5);
    on = true;
    history.update("a", [turn("x"), turn("y")], 6);
    await history.flush();
    expect(JSON.parse(disk.file()!).chats.map((c: SavedChat) => c.id)).toEqual(["a", "old"]);
  });

  it("does not overwrite a file it could not read", async () => {
    const disk = storage();
    disk.load.mockRejectedValueOnce(new Error("denied"));
    const history = createChatHistory(disk, () => true);
    history.update("a", [turn("x")], 1);
    await history.flush();
    expect(disk.save).not.toHaveBeenCalled();
  });

  it("ignores a damaged file and invalid entries", () => {
    expect(parseChatHistory("{oops")).toEqual([]);
    expect(parseChatHistory(JSON.stringify({ version: 2, chats: [] }))).toEqual([]);
    const good = { id: "a", title: "t", updated: 5, turns: [turn("t")] };
    expect(parseChatHistory(JSON.stringify({ version: 1, chats: [good, { id: 3 }, null] }))).toEqual([good]);
  });
});
