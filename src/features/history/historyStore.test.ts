import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "./historyStore";

const saved = (save: ReturnType<typeof vi.fn>) => save.mock.calls.map(([json]) => JSON.parse(json as string));

describe("createHistoryStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (file: string | null = null) => {
    const load = vi.fn(async () => file);
    const save = vi.fn(async (_json: string) => {});
    let now = 100;
    const store = createHistoryStore({ load, save }, { debounceMs: 1000, now: () => now++ });
    return { store, load, save };
  };

  it("loads history.json once and suggests from it", async () => {
    const { store, load } = setup(JSON.stringify({ version: 1, hosts: { local: [{ command: "ls -la", count: 1, last: 1 }] } }));
    await store.ready();
    await store.ready();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.suggest("local", "ls")).toBe("ls -la");
  });

  it("saves recorded commands once after a pause", async () => {
    const { store, save } = setup();
    await store.ready();
    store.record("local", "make");
    store.record("local", "make test");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved(save)[0].hosts.local.map((e: { command: string }) => e.command)).toEqual(["make", "make test"]);
  });

  it("keeps commands recorded before the file finished loading", async () => {
    const { store, save } = setup(JSON.stringify({ version: 1, hosts: { local: [{ command: "old", count: 1, last: 1 }] } }));
    store.record("local", "new");
    await store.ready();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved(save)[0].hosts.local.map((e: { command: string }) => e.command)).toEqual(["old", "new"]);
  });

  it("never overwrites a history file it could not read", async () => {
    const load = vi.fn(async () => {
      throw new Error("denied");
    });
    const save = vi.fn(async () => {});
    const store = createHistoryStore({ load, save }, { debounceMs: 10 });
    store.record("local", "ls");
    await store.ready();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).not.toHaveBeenCalled();
    expect(store.suggest("local", "l")).toBe("ls");
    expect(store.recent("local", 5)).toEqual(["ls"]);
  });

  it("never overwrites a history file that is not valid JSON, until it is cleared", async () => {
    const { store, save } = setup('{"version":1,"hosts":{"local":[{"command":"ls"');
    await store.ready();
    store.record("local", "uptime");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(store.suggest("local", "up")).toBe("uptime");
    await store.clear();
    expect(saved(save)).toEqual([{ version: 1, hosts: {} }]);
  });

  it("counts a command recorded while an invalid file loads only once", async () => {
    const { store } = setup("[1,2]");
    store.record("local", "ls -a");
    await store.ready();
    store.record("local", "ls -b");
    // Both were run once, so the more recent one comes first; counted twice, "ls -a" would win.
    expect(store.suggest("local", "ls -")).toBe("ls -b");
  });

  it("clears the history at once, also on disk", async () => {
    const { store, save } = setup(JSON.stringify({ version: 1, hosts: { local: [{ command: "ls -la", count: 1, last: 1 }] } }));
    await store.ready();
    store.record("local", "pending");
    await store.clear();
    expect(saved(save)).toEqual([{ version: 1, hosts: {} }]);
    expect(store.suggest("local", "ls")).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
