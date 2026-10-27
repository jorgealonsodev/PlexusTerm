import { describe, expect, it } from "vitest";
import { createCommandTimer, formatDuration, shortCommand } from "./commandTimer";

describe("createCommandTimer", () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => void (t += ms) };
  };

  it("reports a command that ran at least the threshold, with its exit code and duration", () => {
    const c = clock();
    const timer = createCommandTimer(c.now);
    timer.started("npm test");
    c.advance(134_000);
    expect(timer.finished(2, 10_000)).toEqual({ command: "npm test", exit: 2, ms: 134_000 });
  });

  it("stays quiet for a short command, a turned-off threshold, or an end with no start", () => {
    const c = clock();
    const timer = createCommandTimer(c.now);
    timer.started("ls");
    c.advance(9_999);
    expect(timer.finished(0, 10_000)).toBeNull();
    timer.started("make");
    c.advance(60_000);
    expect(timer.finished(0, 0)).toBeNull();
    // A prompt drawn again (Ctrl+C at the prompt) ends nothing that ran.
    expect(timer.finished(130, 10_000)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads like people say it", () => {
    expect(formatDuration(45_400)).toBe("45 s");
    expect(formatDuration(134_000)).toBe("2 min 14 s");
    expect(formatDuration(120_000)).toBe("2 min");
    expect(formatDuration(3_780_000)).toBe("1 h 3 min");
    expect(formatDuration(7_200_000)).toBe("2 h");
  });
});

describe("shortCommand", () => {
  it("keeps the first line, cut to fit a notification", () => {
    expect(shortCommand("  npm test  ")).toBe("npm test");
    expect(shortCommand("for x in a\ndo echo $x\ndone")).toBe("for x in a");
    const long = shortCommand("x".repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});
