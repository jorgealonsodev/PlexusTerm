import { describe, expect, it } from "vitest";
import { targetTitle } from "./types";

describe("targetTitle", () => {
  it("names serial tabs after the device and baud rate", () => {
    expect(
      targetTitle({
        type: "serial",
        path: "/dev/ttyUSB0",
        baud: 115200,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flow: "none",
      }),
    ).toBe("/dev/ttyUSB0 @ 115200");
  });

  it("keeps the local and SSH titles", () => {
    expect(targetTitle({ type: "local" })).toBe("Local shell");
    expect(
      targetTitle({ type: "ssh", host: "h", port: 2222, username: "u", auth: { method: "agent" } }),
    ).toBe("u@h:2222");
  });
});
