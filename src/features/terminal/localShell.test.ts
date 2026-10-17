import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { localTargetOf, runningShellOf, shellNameOf, splitArgs } from "./localShell";

const SHELLS = {
  default: { name: "pwsh", program: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
  available: [],
};

describe("splitArgs", () => {
  it("splits on spaces, keeping quoted text and Windows paths as one argument", () => {
    expect(splitArgs("")).toEqual([]);
    expect(splitArgs("  --login   -i ")).toEqual(["--login", "-i"]);
    expect(splitArgs(`-NoLogo -Command "Set-Location 'C:\\My Files'"`)).toEqual([
      "-NoLogo",
      "-Command",
      "Set-Location 'C:\\My Files'",
    ]);
    expect(splitArgs(`-d 'Ubuntu 24.04' ""`)).toEqual(["-d", "Ubuntu 24.04", ""]);
    expect(splitArgs(`a"b c"d`)).toEqual(["ab cd"]);
  });
});

describe("shellNameOf", () => {
  it("drops the directory and a .exe extension", () => {
    expect(shellNameOf("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell");
    expect(shellNameOf("CMD.EXE")).toBe("CMD");
    expect(shellNameOf("/usr/bin/zsh")).toBe("zsh");
    expect(shellNameOf(" fish ")).toBe("fish");
  });
});

describe("localTargetOf", () => {
  it("is a plain local target with the system default shell", () => {
    expect(localTargetOf(DEFAULT_SETTINGS)).toEqual({ type: "local" });
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localShellArgs: "--login" })).toEqual({ type: "local" });
  });

  it("carries the chosen shell and its arguments", () => {
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localShell: "/usr/bin/fish", localShellArgs: "--login -C 'echo hi'" })).toEqual({
      type: "local",
      program: "/usr/bin/fish",
      args: ["--login", "-C", "echo hi"],
    });
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localShell: "wsl.exe" })).toEqual({ type: "local", program: "wsl.exe" });
  });

  it("starts in the folder chosen in Settings (S8)", () => {
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localCwd: "~/projects" })).toEqual({ type: "local", cwd: "~/projects" });
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localShell: "fish", localCwd: "/srv" })).toEqual({
      type: "local",
      program: "fish",
      cwd: "/srv",
    });
    expect(localTargetOf({ ...DEFAULT_SETTINGS, localCwd: "  " })).toEqual({ type: "local" });
  });
});

describe("runningShellOf", () => {
  it("names the local tab's shell, or the default shell when the tab has none", () => {
    expect(runningShellOf({ type: "local", program: "C:\\Windows\\System32\\cmd.exe" }, SHELLS)).toBe("cmd");
    expect(runningShellOf({ type: "local", program: "  " }, SHELLS)).toBe("pwsh");
    expect(runningShellOf({ type: "local" }, SHELLS)).toBe("pwsh");
  });

  it("is unknown before the shells are known and for remote sessions", () => {
    expect(runningShellOf({ type: "local" }, null)).toBeNull();
    expect(runningShellOf({ type: "telnet", host: "switch", port: 23 }, SHELLS)).toBeNull();
  });
});
