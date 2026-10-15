import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Macro, Step } from "./macros";
import { createTargetRegistry, playMacro, type MacroIo } from "./player";

/** Records what the player sends and lets the test emit pane output. */
function fakeIo() {
  const sent: string[] = [];
  const listeners = new Set<(text: string) => void>();
  const io: MacroIo = {
    send: (text) => sent.push(text),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { io, sent, emit: (text: string) => listeners.forEach((l) => l(text)), listeners };
}

const macroOf = (...steps: Step[]): Macro => ({ id: "m", name: "deploy", steps });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("playMacro (S16.3)", () => {
  it("sends steps with their escapes parsed, in order, reporting progress", async () => {
    const { io, sent } = fakeIo();
    const progress: [number, number][] = [];
    const run = playMacro(macroOf({ kind: "send", text: "ls\\r" }, { kind: "send", text: "^C" }), io, {
      onProgress: (step, total) => progress.push([step, total]),
    });
    await expect(run.done).resolves.toEqual({ status: "done" });
    expect(sent).toEqual(["ls\r", "\x03"]);
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("waits the given milliseconds before the next step", async () => {
    const { io, sent } = fakeIo();
    const run = playMacro(macroOf({ kind: "wait", ms: 1000 }, { kind: "send", text: "x" }), io);
    await vi.advanceTimersByTimeAsync(999);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run.done).resolves.toEqual({ status: "done" });
    expect(sent).toEqual(["x"]);
  });

  it("waitFor continues once the output since the step started contains the text, ANSI stripped", async () => {
    const { io, sent, emit, listeners } = fakeIo();
    emit("password: before the macro");
    const run = playMacro(
      macroOf({ kind: "send", text: "ssh h\\r" }, { kind: "waitFor", text: "password:", timeoutSec: 10 }, { kind: "send", text: "ok" }),
      io,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual(["ssh h\r"]);
    emit("pass");
    emit("\x1b[1mword\x1b[0m:");
    await expect(run.done).resolves.toEqual({ status: "done" });
    expect(sent).toEqual(["ssh h\r", "ok"]);
    expect(listeners.size).toBe(0);
  });

  it("waitFor fails after its timeout with a clear message", async () => {
    const { io, sent } = fakeIo();
    const run = playMacro(macroOf({ kind: "waitFor", text: "$ ", timeoutSec: 2 }, { kind: "send", text: "x" }), io);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(run.done).resolves.toEqual({
      status: "failed",
      message: 'Macro "deploy" stopped at step 1 of 2: "$ " did not appear within 2 s.',
    });
    expect(sent).toEqual([]);
  });

  it("stop() ends a running macro without sending the remaining steps", async () => {
    const { io, sent, listeners } = fakeIo();
    const run = playMacro(macroOf({ kind: "send", text: "a" }, { kind: "wait", ms: 5000 }, { kind: "send", text: "b" }), io);
    await vi.advanceTimersByTimeAsync(100);
    run.stop();
    await expect(run.done).resolves.toEqual({ status: "stopped" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(sent).toEqual(["a"]);
    expect(listeners.size).toBe(0);
  });

  it("finishes at once for an empty macro", async () => {
    const { io } = fakeIo();
    await expect(playMacro(macroOf(), io).done).resolves.toEqual({ status: "done" });
  });
});

describe("createTargetRegistry", () => {
  it("returns the registered target and never removes a newer one", () => {
    const registry = createTargetRegistry<string>();
    const first = registry.register("p1", "old");
    registry.register("p1", "new");
    first();
    expect(registry.get("p1")).toBe("new");
    expect(registry.get("p2")).toBeUndefined();
  });
});
