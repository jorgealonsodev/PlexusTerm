import { describe, expect, it } from "vitest";
import { DEFAULT_PORTS, portsFor } from "./portChoice";

describe("portsFor", () => {
  it("uses the known ports by default", () => {
    expect(portsFor({ mode: "known", from: "1", to: "65535", list: "" })).toEqual({ ok: true, ports: DEFAULT_PORTS });
  });

  it("turns the range fields into from-to, or one port when they are equal", () => {
    expect(portsFor({ mode: "range", from: "1", to: "65535", list: "" })).toEqual({ ok: true, ports: "1-65535" });
    expect(portsFor({ mode: "range", from: " 443 ", to: "443", list: "" })).toEqual({ ok: true, ports: "443" });
  });

  it("rejects a range outside 1..65535 or reversed", () => {
    const bad = { ok: false, error: "Ports must be numbers from 1 to 65535" };
    expect(portsFor({ mode: "range", from: "0", to: "10", list: "" })).toEqual(bad);
    expect(portsFor({ mode: "range", from: "1", to: "70000", list: "" })).toEqual(bad);
    expect(portsFor({ mode: "range", from: "", to: "10", list: "" })).toEqual(bad);
    expect(portsFor({ mode: "range", from: "100", to: "10", list: "" })).toEqual({
      ok: false,
      error: "The first port must not be greater than the last one",
    });
  });

  it("passes a custom list as typed, and the known ports when it is empty", () => {
    expect(portsFor({ mode: "custom", from: "", to: "", list: " 22,80,8000-8100 " })).toEqual({ ok: true, ports: "22,80,8000-8100" });
    expect(portsFor({ mode: "custom", from: "", to: "", list: "  " })).toEqual({ ok: true, ports: DEFAULT_PORTS });
  });
});
