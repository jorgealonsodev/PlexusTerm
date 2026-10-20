import { describe, expect, it } from "vitest";
import { blockOf, createInputHold, SHARER_HOLD_MS, VIEWER_HOLD_MS } from "./inputHold";

describe("viewer input hold rules (S3)", () => {
  it("releases a viewer's keys whole and in order", () => {
    const hold = createInputHold();
    hold.push(1, "l");
    hold.push(1, "\x1b[200~a\nb\x1b[201~");
    expect(hold.release(0, null)).toEqual([
      { viewer: 1, data: "l" },
      { viewer: 1, data: "\x1b[200~a\nb\x1b[201~" },
    ]);
    expect(hold.size()).toBe(0);
  });

  it("keeps another viewer's keys while one types, for 2 s after their last key", () => {
    const hold = createInputHold();
    hold.push(1, "a");
    expect(hold.release(0, null)).toEqual([{ viewer: 1, data: "a" }]);
    hold.push(2, "x");
    hold.push(1, "b");
    // Viewer 1 holds the input: only its key goes.
    expect(hold.release(1000, null)).toEqual([{ viewer: 1, data: "b" }]);
    expect(hold.waiting()).toEqual([2]);
    expect(hold.release(1000 + VIEWER_HOLD_MS - 1, null)).toEqual([]);
    // 2 s after viewer 1's last key, viewer 2's waiting key goes, never dropped.
    expect(hold.release(1000 + VIEWER_HOLD_MS, null)).toEqual([{ viewer: 2, data: "x" }]);
    expect(hold.owner(1000 + VIEWER_HOLD_MS)?.viewer).toBe(2);
  });

  it("holds everything while blocked and lets it through afterwards", () => {
    const hold = createInputHold();
    hold.push(1, "secret?");
    for (const block of ["paused", "password", "sharer"] as const) expect(hold.release(0, block)).toEqual([]);
    expect(hold.size()).toBe(1);
    expect(hold.release(0, null)).toEqual([{ viewer: 1, data: "secret?" }]);
  });

  it("drops the keys of a viewer that left and frees the input", () => {
    const hold = createInputHold();
    hold.push(1, "a");
    hold.release(0, null);
    hold.push(1, "b");
    hold.push(2, "c");
    hold.forget(1);
    expect(hold.release(10, null)).toEqual([{ viewer: 2, data: "c" }]);
  });

  it("blocks for Pause, then a password prompt, then the sharer's own typing", () => {
    expect(blockOf({ paused: true, atPassword: true, sharerTypedAt: 0 }, 0)).toBe("paused");
    expect(blockOf({ paused: false, atPassword: true, sharerTypedAt: 0 }, 0)).toBe("password");
    expect(blockOf({ paused: false, atPassword: false, sharerTypedAt: 100 }, 100 + SHARER_HOLD_MS - 1)).toBe("sharer");
    expect(blockOf({ paused: false, atPassword: false, sharerTypedAt: 100 }, 100 + SHARER_HOLD_MS)).toBeNull();
  });

  it("clears every queued key when the share becomes View only", () => {
    const hold = createInputHold();
    hold.push(1, "a");
    hold.push(2, "b");
    hold.clear();
    expect(hold.release(0, null)).toEqual([]);
    expect(hold.owner(0)).toBeNull();
  });
});
