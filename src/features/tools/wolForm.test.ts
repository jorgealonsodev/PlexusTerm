import { describe, expect, it } from "vitest";
import { parseWolForm } from "./wolForm";

describe("parseWolForm", () => {
  it("accepts a MAC with the default broadcast address and port", () => {
    expect(parseWolForm({ mac: " AA-bb-cc-dd-ee-01 ", broadcast: "", port: "" })).toEqual({
      ok: true,
      mac: "aa:bb:cc:dd:ee:01",
      broadcast: "255.255.255.255",
      port: 9,
    });
  });

  it("keeps a given broadcast address and port", () => {
    expect(parseWolForm({ mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255", port: "7" })).toMatchObject({
      ok: true,
      broadcast: "192.168.1.255",
      port: 7,
    });
  });

  it("rejects a malformed MAC, broadcast address or port", () => {
    expect(parseWolForm({ mac: "aa:bb:cc:dd:ee", broadcast: "", port: "" })).toEqual({
      ok: false,
      error: "MAC address must look like aa:bb:cc:dd:ee:ff",
    });
    expect(parseWolForm({ mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1", port: "" })).toEqual({
      ok: false,
      error: "Broadcast address must be an IPv4 address",
    });
    expect(parseWolForm({ mac: "aa:bb:cc:dd:ee:01", broadcast: "", port: "70000" })).toEqual({
      ok: false,
      error: "Port must be a number between 1 and 65535",
    });
  });
});
