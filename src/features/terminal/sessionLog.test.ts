import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionLog } from "./sessionLog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = () => {
  const append = vi.fn((_path: string, _text: string) => Promise.resolve());
  const onError = vi.fn();
  const log = createSessionLog("/tmp/s.log", append, { intervalMs: 500, onError });
  return { log, append, onError };
};

describe("createSessionLog", () => {
  it("appends the received output in batches, without escape sequences", async () => {
    const { log, append } = setup();
    log.write("\x1b[32mok\x1b[0m\r\n");
    log.write("next ");
    expect(append).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith("/tmp/s.log", "ok\nnext ");
    await vi.advanceTimersByTimeAsync(500);
    expect(append).toHaveBeenCalledTimes(1); // nothing new, no call
  });

  it("keeps an escape sequence cut between chunks for the next batch", async () => {
    const { log, append } = setup();
    log.write("a\x1b[3");
    await vi.advanceTimersByTimeAsync(500);
    log.write("1mb");
    await vi.advanceTimersByTimeAsync(500);
    expect(append.mock.calls.map((c) => c[1])).toEqual(["a", "b"]);
  });

  it("flushes everything when stopped and ignores later output", async () => {
    const { log, append } = setup();
    log.write("last line\r");
    await log.stop();
    expect(append).toHaveBeenCalledWith("/tmp/s.log", "last line\r");
    log.write("after");
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("reports a failed append once and stops logging", async () => {
    const { log, append, onError } = setup();
    append.mockRejectedValueOnce("disk full");
    log.write("x");
    await vi.advanceTimersByTimeAsync(500);
    log.write("y");
    await vi.advanceTimersByTimeAsync(500);
    expect(onError).toHaveBeenCalledWith("disk full");
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("keeps one append in flight and joins the batches that arrive meanwhile", async () => {
    let release: () => void = () => {};
    const append = vi.fn((_path: string, _text: string) => new Promise<void>((resolve) => (release = resolve)));
    const log = createSessionLog("/tmp/s.log", append, { intervalMs: 500 });
    log.write("a");
    await vi.advanceTimersByTimeAsync(500);
    log.write("b");
    await vi.advanceTimersByTimeAsync(500);
    log.write("c");
    await vi.advanceTimersByTimeAsync(500);
    expect(append.mock.calls.map((c) => c[1])).toEqual(["a"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(append.mock.calls.map((c) => c[1])).toEqual(["a", "bc"]);
  });

  it("leaves out what does not fit while the disk is slow, and says so in the log", async () => {
    let release: () => void = () => {};
    const append = vi.fn((_path: string, _text: string) => new Promise<void>((resolve) => (release = resolve)));
    const log = createSessionLog("/tmp/s.log", append, { intervalMs: 500, maxBacklog: 4, droppedNote: (n) => `[${n} lost]` });
    log.write("x");
    await vi.advanceTimersByTimeAsync(500);
    log.write("123456");
    await vi.advanceTimersByTimeAsync(500);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(append.mock.calls.map((c) => c[1])).toEqual(["x", "1234[2 lost]"]);
    release();
    await log.stop();
    expect(append).toHaveBeenCalledTimes(2);
  });

  it("stops after the append in flight, without growing a queue", async () => {
    let release: () => void = () => {};
    const append = vi.fn((_path: string, _text: string) => new Promise<void>((resolve) => (release = resolve)));
    const log = createSessionLog("/tmp/s.log", append, { intervalMs: 500 });
    log.write("one");
    await vi.advanceTimersByTimeAsync(500);
    log.write("two");
    let stopped = false;
    void log.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(true);
    expect(append.mock.calls.map((c) => c[1])).toEqual(["one", "two"]);
    log.write("late");
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).toHaveBeenCalledTimes(2);
  });
});
