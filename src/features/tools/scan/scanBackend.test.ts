import { describe, expect, it } from "vitest";
import { compareHosts } from "./scanBackend";

describe("compareHosts", () => {
  it("orders IPv4 addresses numerically and other hosts after them", () => {
    expect(["10.0.0.10", "fe80::1", "10.0.0.9", "192.168.1.1"].sort(compareHosts)).toEqual([
      "10.0.0.9",
      "10.0.0.10",
      "192.168.1.1",
      "fe80::1",
    ]);
  });
});
