import { describe, expect, it } from "vitest";
import { clearLineKeys } from "./clearLine";

describe("clearLineKeys", () => {
  it("uses Ctrl+End then Ctrl+Home for local shells on Windows (PowerShell and cmd)", () => {
    expect(clearLineKeys("windows", "local")).toBe("\x1b[1;5F\x1b[1;5H");
  });

  it("uses Ctrl+E then Ctrl+U for local shells on Linux and macOS", () => {
    expect(clearLineKeys("linux", "local")).toBe("\x05\x15");
    expect(clearLineKeys("macos", "local")).toBe("\x05\x15");
  });

  it("uses Ctrl+E then Ctrl+U for remote sessions, whatever the local platform", () => {
    for (const type of ["ssh", "mosh", "telnet", "serial"] as const) {
      expect(clearLineKeys("windows", type)).toBe("\x05\x15");
    }
  });
});
