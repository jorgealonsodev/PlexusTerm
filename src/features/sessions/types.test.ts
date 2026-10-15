import { describe, expect, it } from "vitest";
import { sshLoginOf, targetTitle } from "./types";

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

  it("names Telnet tabs after the host (port only when not 23) and Mosh tabs after the SSH login", () => {
    expect(targetTitle({ type: "telnet", host: "switch.lan", port: 23 })).toBe("telnet switch.lan");
    expect(targetTitle({ type: "telnet", host: "switch.lan", port: 2323 })).toBe("telnet switch.lan:2323");
    expect(
      targetTitle({
        type: "mosh",
        ssh: { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "agent" } },
      }),
    ).toBe("mosh u@h");
  });

  it("finds the SSH login of SSH and Mosh targets only", () => {
    const ssh = { type: "ssh" as const, host: "h", port: 22, username: "u", auth: { method: "agent" as const } };
    expect(sshLoginOf(ssh)).toBe(ssh);
    expect(sshLoginOf({ type: "mosh", ssh })).toBe(ssh);
    expect(sshLoginOf({ type: "telnet", host: "h", port: 23 })).toBeNull();
    expect(sshLoginOf({ type: "local" })).toBeNull();
  });

  it("keeps the local and SSH titles", () => {
    expect(targetTitle({ type: "local" })).toBe("Local shell");
    expect(
      targetTitle({ type: "ssh", host: "h", port: 2222, username: "u", auth: { method: "agent" } }),
    ).toBe("u@h:2222");
  });
});
