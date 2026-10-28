import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CastError, createCastPlayer, formatTime, parseCast, type Cast } from "./cast";

const HEADER = '{"version":2,"width":100,"height":30,"timestamp":1700000000,"env":{"TERM":"xterm-256color"}}';

describe("parseCast", () => {
  it("reads an asciicast v2 file: the size from the header, then the output and resize events", () => {
    const cast = parseCast(
      [HEADER, '[0.5, "o", "a\\r\\n"]', '[1.25, "i", "typed"]', '[2, "r", "120x40"]', '[3.000001, "o", "b"]', ""].join("\n"),
    );
    expect(cast.width).toBe(100);
    expect(cast.height).toBe(30);
    // Input events ("i") are not played.
    expect(cast.events).toEqual([
      { time: 0.5, type: "o", data: "a\r\n" },
      { time: 2, type: "r", data: "120x40" },
      { time: 3.000001, type: "o", data: "b" },
    ]);
    expect(cast.duration).toBe(3.000001);
  });

  it("accepts Windows line endings and a file with no events", () => {
    const cast = parseCast(`${HEADER}\r\n`);
    expect(cast.events).toEqual([]);
    expect(cast.duration).toBe(0);
    expect(parseCast(`${HEADER}\r\n[1, "o", "x"]\r\n`).events).toEqual([{ time: 1, type: "o", data: "x" }]);
  });

  it("keeps the events in time order even when a clock went back a little", () => {
    const cast = parseCast([HEADER, '[2, "o", "a"]', '[1.9, "o", "b"]'].join("\n"));
    expect(cast.events.map((e) => e.time)).toEqual([2, 2]);
  });

  it.each([
    ["an empty file", ""],
    ["a header that is not JSON", "not json"],
    ["another version", '{"version":1,"width":80,"height":24}'],
    ["a header without a size", '{"version":2}'],
    ["a size that is not a positive whole number", '{"version":2,"width":0,"height":24}'],
    ["an event that is not JSON", `${HEADER}\n[1, "o", "x"`],
    ["an event that is not [time, type, data]", `${HEADER}\n{"t":1}`],
    ["a negative time", `${HEADER}\n[-1, "o", "x"]`],
    ["data that is not text", `${HEADER}\n[1, "o", 5]`],
    ["a resize without COLSxROWS", `${HEADER}\n[1, "r", "wide"]`],
  ])("rejects %s", (_name, text) => {
    expect(() => parseCast(text)).toThrow(CastError);
  });

  it("names the line that is wrong", () => {
    expect(() => parseCast(`${HEADER}\n[1, "o", "x"]\n[oops]`)).toThrow(/line 3/);
  });
});

describe("formatTime", () => {
  it("shows minutes and seconds, and hours when there are", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(3725)).toBe("1:02:05");
  });
});

describe("createCastPlayer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const cast: Cast = {
    width: 80,
    height: 24,
    events: [
      { time: 1, type: "o", data: "a" },
      { time: 1, type: "o", data: "b" },
      { time: 2, type: "r", data: "100x30" },
      { time: 3, type: "o", data: "c" },
      { time: 10, type: "o", data: "d" },
    ],
    duration: 10,
  };

  const setup = () => {
    const screen = { written: [] as string[], sizes: [] as string[], resets: 0 };
    const onChange = vi.fn();
    const player = createCastPlayer(cast, {
      write: (data) => screen.written.push(data),
      resize: (cols, rows) => screen.sizes.push(`${cols}x${rows}`),
      reset: () => {
        screen.resets++;
        screen.written = [];
      },
      now: () => Date.now(),
      onChange,
    });
    return { player, screen, onChange };
  };

  it("plays the events at their times, joining those due together", async () => {
    const { player, screen } = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(999);
    expect(screen.written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.written).toEqual(["ab"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.sizes).toEqual(["100x30"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.written).toEqual(["ab", "c"]);
    expect(player.position()).toBeCloseTo(3);
  });

  it.each([
    [2, 1500],
    [4, 750],
  ])("plays %d× faster", async (speed, ms) => {
    const { player, screen } = setup();
    player.setSpeed(speed);
    player.play();
    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(screen.written).toEqual(["ab"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.written).toEqual(["ab", "c"]);
    expect(player.position()).toBeCloseTo(3);
  });

  it("changes speed while playing from where it is", async () => {
    const { player, screen } = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(2000); // at 2 s
    player.setSpeed(4);
    await vi.advanceTimersByTimeAsync(250); // 1 s of the recording at 4×
    expect(screen.written).toEqual(["ab", "c"]);
  });

  it("pauses and goes on from the same point", async () => {
    const { player, screen } = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(1500);
    player.pause();
    expect(player.playing()).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.written).toEqual(["ab"]);
    expect(player.position()).toBeCloseTo(1.5);
    player.play();
    await vi.advanceTimersByTimeAsync(1500);
    expect(screen.written).toEqual(["ab", "c"]);
  });

  it("stops at the end, and plays again from the start", async () => {
    const { player, screen, onChange } = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.written.join("")).toBe("abcd");
    expect(player.playing()).toBe(false);
    expect(player.position()).toBe(10);
    expect(onChange).toHaveBeenCalled();
    player.play();
    expect(screen.resets).toBe(1);
    expect(screen.sizes[screen.sizes.length - 1]).toBe("80x24");
    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.written).toEqual(["ab"]);
  });

  it("seeks by starting again and writing at once everything up to that time", async () => {
    const { player, screen } = setup();
    player.seek(5);
    expect(screen.resets).toBe(1);
    // Back to the header's size, then each resize in its place.
    expect(screen.sizes).toEqual(["80x24", "100x30"]);
    expect(screen.written).toEqual(["ab", "c"]);
    expect(player.position()).toBe(5);
    expect(player.playing()).toBe(false);
    player.play();
    await vi.advanceTimersByTimeAsync(4999);
    expect(screen.written).toEqual(["ab", "c"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.written).toEqual(["ab", "c", "d"]);
  });

  it("seeks back while playing and keeps playing", async () => {
    const { player, screen } = setup();
    player.play();
    await vi.advanceTimersByTimeAsync(3500);
    player.seek(0.5);
    expect(screen.written).toEqual([]);
    expect(player.playing()).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(screen.written).toEqual(["ab"]);
  });

  it("keeps a seek within the recording", () => {
    const { player } = setup();
    player.seek(-3);
    expect(player.position()).toBe(0);
    player.seek(99);
    expect(player.position()).toBe(10);
  });

  it("plays nothing more once disposed", async () => {
    const { player, screen } = setup();
    player.play();
    player.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.written).toEqual([]);
  });
});
