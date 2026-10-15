import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiLimiter } from "./aiLimiter";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A request that stays open until `finish` is called. */
function deferred() {
  let finish!: (value: string) => void;
  const promise = new Promise<string>((resolve) => (finish = resolve));
  return { promise, finish, run: vi.fn(() => promise) };
}

describe("createAiLimiter", () => {
  it("keeps at most one request in flight per pane, sending the newest waiting one next", async () => {
    const limit = createAiLimiter(1000);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const a = limit("p1", first.run);
    const b = limit("p1", second.run);
    const c = limit("p1", third.run);
    expect(first.run).toHaveBeenCalledTimes(1);
    expect(second.run).not.toHaveBeenCalled();
    // A newer request replaces one that has not been sent yet.
    await expect(b).resolves.toBeNull();
    first.finish("one");
    await expect(a).resolves.toBe("one");
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.run).not.toHaveBeenCalled();
    expect(third.run).toHaveBeenCalledTimes(1);
    third.finish("three");
    await expect(c).resolves.toBe("three");
  });

  it("waits the minimum interval between two requests of a pane, but not across panes", async () => {
    const limit = createAiLimiter(1000);
    const one = vi.fn(async () => "1");
    const two = vi.fn(async () => "2");
    const other = vi.fn(async () => "x");
    await limit("p1", one);
    const next = limit("p1", two);
    await limit("p2", other);
    expect(other).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(two).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(two).toHaveBeenCalledTimes(1);
    await expect(next).resolves.toBe("2");
  });

  it("passes errors on and keeps serving the pane", async () => {
    const limit = createAiLimiter(0);
    await expect(limit("p1", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    await expect(limit("p1", async () => "ok")).resolves.toBe("ok");
  });
});
