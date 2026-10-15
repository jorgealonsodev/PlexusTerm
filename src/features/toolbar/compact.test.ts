import { describe, expect, it } from "vitest";
import { nextCompact } from "./compact";

describe("nextCompact", () => {
  const full = { compact: false, enteredAt: null };

  it("keeps the labels while everything fits", () => {
    expect(nextCompact(full, { width: 900, overflowing: false })).toEqual(full);
  });

  it("drops to icons only when even the shortened labels overflow, remembering that width", () => {
    expect(nextCompact(full, { width: 700, overflowing: true })).toEqual({ compact: true, enteredAt: 700 });
  });

  it("stays on icons until the toolbar is wider than where the labels stopped fitting", () => {
    const compact = { compact: true, enteredAt: 700 };
    expect(nextCompact(compact, { width: 650, overflowing: false })).toEqual(compact);
    expect(nextCompact(compact, { width: 700, overflowing: false })).toEqual(compact);
    expect(nextCompact(compact, { width: 701, overflowing: false })).toEqual(full);
  });
});
