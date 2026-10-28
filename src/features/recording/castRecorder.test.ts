import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCastRecorder, recordingFileName } from "./castRecorder";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A recorder started at 2023-11-14 22:13:20 UTC, with a clock the test moves. */
const setup = (options: { maxBacklog?: number } = {}) => {
  let ms = 0;
  const write = vi.fn((_path: string, _text: string) => Promise.resolve());
  const append = vi.fn((_path: string, _text: string) => Promise.resolve());
  const onError = vi.fn();
  const recorder = createCastRecorder(
    "/tmp/s.cast",
    { write, append },
    {
      cols: 100,
      rows: 30,
      now: () => ms,
      startedAt: new Date(1_700_000_000_000),
      intervalMs: 200,
      onError,
      droppedNote: (count) => `[${count} not recorded]`,
      ...options,
    },
  );
  const at = (seconds: number) => void (ms = seconds * 1000);
  /** Every line written to the file, header first. */
  const lines = () =>
    [...write.mock.calls, ...append.mock.calls]
      .map((call) => call[1])
      .join("")
      .split("\n")
      .filter((line) => line !== "");
  return { recorder, write, append, onError, at, lines };
};

describe("createCastRecorder", () => {
  it("starts the file with an asciicast v2 header: size, start time and TERM", async () => {
    const { write, recorder } = setup();
    await recorder.stop();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]).toEqual([
      "/tmp/s.cast",
      '{"version":2,"width":100,"height":30,"timestamp":1700000000,"env":{"TERM":"xterm-256color"}}\n',
    ]);
  });

  it("writes each output as [seconds, \"o\", data] and each resize as [seconds, \"r\", \"COLSxROWS\"]", async () => {
    const { recorder, at, lines, append } = setup();
    await vi.advanceTimersByTimeAsync(0);
    at(0.5);
    recorder.output("\x1b[1mbold\x1b[0m\r\n");
    at(1.25);
    recorder.output('say "hi"');
    at(2);
    recorder.resize(120, 40);
    expect(append).not.toHaveBeenCalled(); // batched
    await vi.advanceTimersByTimeAsync(200);
    expect(append).toHaveBeenCalledTimes(1);
    expect(lines().slice(1)).toEqual([
      '[0.500000, "o", "\\u001b[1mbold\\u001b[0m\\r\\n"]',
      '[1.250000, "o", "say \\"hi\\""]',
      '[2.000000, "r", "120x40"]',
    ]);
    for (const line of lines()) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("joins outputs that arrive within a few milliseconds into one event", async () => {
    const { recorder, at, lines } = setup();
    at(1);
    recorder.output("a");
    at(1.004);
    recorder.output("b");
    at(1.5);
    recorder.output("c");
    await recorder.stop();
    expect(lines().slice(1)).toEqual(['[1.000000, "o", "ab"]', '[1.500000, "o", "c"]']);
  });

  it("writes what is queued when stopped and records nothing after", async () => {
    const { recorder, at, lines, append } = setup();
    at(0.1);
    recorder.output("last");
    await recorder.stop();
    expect(lines().slice(1)).toEqual(['[0.100000, "o", "last"]']);
    recorder.output("later");
    recorder.resize(10, 10);
    await vi.advanceTimersByTimeAsync(1000);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("leaves out whole events that do not fit while the disk is slow, and says so", async () => {
    const { recorder, at, lines, append } = setup({ maxBacklog: 40 });
    let finish: () => void = () => {};
    // The first batch's append is slow: later events queue meanwhile.
    append.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));
    at(1);
    recorder.output("x".repeat(10)); // [1.000000, "o", "xxxxxxxxxx"]\n is 30 characters
    await vi.advanceTimersByTimeAsync(200);
    at(2);
    recorder.output("y".repeat(10)); // fits in the backlog
    await vi.advanceTimersByTimeAsync(200);
    at(3);
    recorder.output("z".repeat(10)); // does not fit: left out whole
    await vi.advanceTimersByTimeAsync(200);
    finish();
    await recorder.stop();
    expect(lines().slice(1)).toEqual([
      '[1.000000, "o", "xxxxxxxxxx"]',
      '[2.000000, "o", "yyyyyyyyyy"]',
      '[3.000000, "o", "\\r\\n[30 not recorded]\\r\\n"]',
    ]);
    for (const line of lines()) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("reports a failed write once and records nothing more", async () => {
    const { recorder, append, onError, at } = setup();
    append.mockRejectedValueOnce(new Error("disk full"));
    at(1);
    recorder.output("a");
    await vi.advanceTimersByTimeAsync(200);
    expect(onError).toHaveBeenCalledTimes(1);
    recorder.output("b");
    await recorder.stop();
    expect(append).toHaveBeenCalledTimes(1);
  });
});

describe("recordingFileName", () => {
  it("names a recording after its local start time", () => {
    expect(recordingFileName(new Date(2026, 9, 28, 9, 5, 7))).toBe("session-20261028-090507.cast");
  });
});
