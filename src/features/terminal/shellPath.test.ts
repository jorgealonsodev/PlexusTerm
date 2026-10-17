import { describe, expect, it } from "vitest";
import { cdCommand, quotePath, shellFlavor } from "./shellPath";

describe("shellFlavor", () => {
  it("follows the local shell and treats remote sessions as POSIX", () => {
    expect(shellFlavor("windows", "local", null)).toBe("powershell");
    expect(shellFlavor("windows", "local", "pwsh")).toBe("powershell");
    expect(shellFlavor("windows", "local", "CMD")).toBe("cmd");
    expect(shellFlavor("windows", "local", "bash")).toBe("posix");
    expect(shellFlavor("windows", "ssh", null)).toBe("posix");
    expect(shellFlavor("linux", "local", null)).toBe("posix");
    expect(shellFlavor("linux", "local", "pwsh")).toBe("powershell");
    expect(shellFlavor("macos", "ssh", "pwsh")).toBe("posix");
  });
});

describe("quotePath", () => {
  it("leaves plain paths alone", () => {
    expect(quotePath("/home/me/a.txt", "posix")).toBe("/home/me/a.txt");
    expect(quotePath("C:\\Users\\me", "powershell")).toBe("C:\\Users\\me");
    expect(quotePath("C:\\Users\\me", "cmd")).toBe("C:\\Users\\me");
  });

  it("quotes the rest for each shell", () => {
    expect(quotePath("/home/me/it's here", "posix")).toBe("'/home/me/it'\\''s here'");
    expect(quotePath("C:\\My Docs\\it's", "powershell")).toBe("'C:\\My Docs\\it''s'");
    expect(quotePath("C:\\My Docs & more", "cmd")).toBe('"C:\\My Docs & more"');
  });

  it("refuses control characters", () => {
    expect(quotePath("/tmp/a\nb", "posix")).toBeNull();
    expect(quotePath("C:\\a\u0015", "powershell")).toBeNull();
  });
});

describe("cdCommand", () => {
  it("changes folder in each shell, drive included for cmd", () => {
    expect(cdCommand("/srv/my app", "posix")).toBe("cd '/srv/my app'");
    expect(cdCommand("D:\\work", "powershell")).toBe("cd D:\\work");
    expect(cdCommand("D:\\my work", "cmd")).toBe('cd /d "D:\\my work"');
    expect(cdCommand("/a\rb", "posix")).toBeNull();
  });
});
