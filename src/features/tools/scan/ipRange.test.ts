import { describe, expect, it } from "vitest";
import { DEFAULT_RANGE, parsePastedRange, rangeTarget } from "./ipRange";

describe("rangeTarget", () => {
  it("joins the fields into the a.b.c.start-end form the backend scans", () => {
    expect(rangeTarget(DEFAULT_RANGE)).toEqual({ ok: true, target: "192.168.1.1-254" });
    expect(rangeTarget({ a: "10", b: "0", c: "0", start: "5", end: "20" })).toEqual({ ok: true, target: "10.0.0.5-20" });
  });

  it("scans one address when start and end are equal", () => {
    expect(rangeTarget({ a: "10", b: "0", c: "0", start: "7", end: "7" })).toEqual({ ok: true, target: "10.0.0.7" });
  });

  it("rejects empty or out-of-range parts and a start after the end", () => {
    const bad = { ok: false, error: "Each part of the address must be a number from 0 to 255" };
    expect(rangeTarget({ ...DEFAULT_RANGE, a: "" })).toEqual(bad);
    expect(rangeTarget({ ...DEFAULT_RANGE, c: "300" })).toEqual(bad);
    expect(rangeTarget({ ...DEFAULT_RANGE, end: "x" })).toEqual(bad);
    expect(rangeTarget({ ...DEFAULT_RANGE, start: "200", end: "100" })).toEqual({
      ok: false,
      error: "The range start must not be greater than its end",
    });
  });
});

describe("parsePastedRange", () => {
  it("fills every field from an address, a range or a /24 network", () => {
    expect(parsePastedRange("10.1.2.7")).toEqual({ a: "10", b: "1", c: "2", start: "7", end: "7" });
    expect(parsePastedRange(" 10.1.2.5-40 ")).toEqual({ a: "10", b: "1", c: "2", start: "5", end: "40" });
    expect(parsePastedRange("172.16.4.0/24")).toEqual({ a: "172", b: "16", c: "4", start: "1", end: "254" });
  });

  it("ignores anything else, so a plain number is typed normally", () => {
    expect(parsePastedRange("12")).toBeNull();
    expect(parsePastedRange("10.0.0.0/16")).toBeNull();
    expect(parsePastedRange("host.lan")).toBeNull();
  });
});
