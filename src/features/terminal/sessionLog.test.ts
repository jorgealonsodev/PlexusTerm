import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionLog, logTimestamp } from "./sessionLog";

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

describe("inline images (S3.4)", () => {
  /** Writes `data` in chunks of `size`, one batch every chunk, as a slow image upload arrives. */
  const writeInBatches = async (log: ReturnType<typeof setup>["log"], data: string, size: number) => {
    for (let at = 0; at < data.length; at += size) {
      log.write(data.slice(at, at + size));
      await vi.advanceTimersByTimeAsync(500);
    }
  };
  const logged = (append: ReturnType<typeof setup>["append"]) => append.mock.calls.map((c) => c[1]).join("");
  // Far longer than the escape tail the log waits for (4096 characters).
  const pixels = "#0;2;0;0;0#0!200~-".repeat(2000);
  const base64 = "iVBORw0KGgoAAAANSUhEUgAA".repeat(2000);

  it("drops a sixel image (DCS) split across many batches whole, and keeps the text around it", async () => {
    const { log, append } = setup();
    await writeInBatches(log, `before\r\n\x1bPq${pixels}\x1b\\after\r\n`, 3000);
    await log.stop();
    expect(logged(append)).toBe("before\nafter\n");
  });

  it("drops an iTerm2 image (OSC 1337) split across many batches whole, ended by BEL or ST", async () => {
    const { log, append } = setup();
    const image = (end: string) => `\x1b]1337;File=inline=1;size=48000:${base64}${end}`;
    // The ST is cut between two batches (ESC at the end of one, \ at the start of the next).
    await writeInBatches(log, `one ${image("\x07")}two ${image("\x1b\\")}three`, 4367);
    await log.stop();
    expect(logged(append)).toBe("one two three");
  });

  it("never writes an image left unfinished when the log stops", async () => {
    const { log, append } = setup();
    await writeInBatches(log, `shown\x1bPq${pixels}`, 3000);
    await log.stop();
    expect(logged(append)).toBe("shown");
  });

  it("logs the output after an image cut short by another escape sequence", async () => {
    const { log, append } = setup();
    await writeInBatches(log, `\x1bPq${pixels}\x1b[31mred\x1b[0m\r\n`, 3000);
    await log.stop();
    expect(logged(append)).toBe("red\n");
  });
});

describe("timestamps", () => {
  it("start every line with output with the time, across batches, and leave empty lines alone", async () => {
    const append = vi.fn((_path: string, _text: string) => Promise.resolve());
    let n = 0;
    const log = createSessionLog("/tmp/s.log", append, { intervalMs: 500, timestamp: () => `[t${++n}] ` });
    log.write("\x1b[31mfirst\x1b[0m\r\nsecond half");
    await vi.advanceTimersByTimeAsync(500);
    log.write(" goes on\n\nthird\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(append.mock.calls.map((c) => c[1]).join("")).toBe("[t1] first\n[t1] second half goes on\n\n[t2] third\n");
  });

  it("are written as local date and time", () => {
    expect(logTimestamp(new Date(2026, 9, 27, 9, 5, 7))).toBe("[2026-10-27 09:05:07] ");
  });
});
