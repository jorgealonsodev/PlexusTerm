import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionLog } from "./sessionLog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const setup = () => {
  const append = vi.fn((_p: string, _t: string) => Promise.resolve());
  const log = createSessionLog("/tmp/s.log", append, {
    intervalMs: 500,
    onError: vi.fn(),
    timestamps: false,
  } as any);
  return {
    log,
    append,
    out: () => append.mock.calls.map((c) => c[1]).join(""),
  };
};
const chunks = (s: string, n: number) => {
  const r: string[] = [];
  for (let i = 0; i < s.length; i += n) r.push(s.slice(i, i + n));
  return r;
};
const SIXEL =
  '\x1bPq"1;1;100;100#0;2;0;0;0' + "#0!100~-".repeat(2000) + "\x1b\\";
const IIP =
  "\x1b]1337;File=inline=1;size=99999:" +
  "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=".repeat(800) +
  "\x07";
const IIP_ST = "\x1b]1337;File=inline=1:" + "QUJD".repeat(3000) + "\x1b\\";

describe("session log drops image payloads", () => {
  for (const [name, img] of [
    ["sixel", SIXEL],
    ["iip BEL", IIP],
    ["iip ST", IIP_ST],
  ] as const) {
    for (const size of [1, 7, 100, 1000, 5000]) {
      for (const flushEvery of [true, false]) {
        it(`${name} in chunks of ${size}, flush each ${flushEvery}`, async () => {
          const { log, out } = setup();
          const all = "before\r\n" + img + "after\r\n";
          const parts = chunks(all, size);
          for (const p of parts) {
            log.write(p);
            if (flushEvery) await vi.advanceTimersByTimeAsync(500);
          }
          await vi.advanceTimersByTimeAsync(500);
          await log.stop();
          const text = out();
          expect(img.length).toBeGreaterThan(4096);
          expect(text).toBe("before\nafter\n");
        });
      }
    }
  }
  it("small complete sixel in one chunk is not logged as text", async () => {
    const { log, out } = setup();
    log.write("a\x1bPq#0;2;0;0;0#0~~~~\x1b\\b\r\n");
    await log.stop();
    expect(out()).toBe("ab\n");
  });
  it("small complete OSC 1337 in one chunk is not logged", async () => {
    const { log, out } = setup();
    log.write("a\x1b]1337;File=inline=1:QUJD\x07b\r\n");
    await log.stop();
    expect(out()).toBe("ab\n");
  });
  it("terminator ESC split from backslash across chunks", async () => {
    const { log, out } = setup();
    log.write("x" + SIXEL.slice(0, -1));
    await vi.advanceTimersByTimeAsync(500);
    log.write("\\y\r\n");
    await log.stop();
    expect(out()).toBe("xy\n");
  });
  it("plain long text without escapes is unchanged", async () => {
    const { log, out } = setup();
    const t = "z".repeat(10000) + "\r\n";
    for (const p of chunks(t, 333)) log.write(p);
    await log.stop();
    expect(out()).toBe("z".repeat(10000) + "\n");
  });
});
