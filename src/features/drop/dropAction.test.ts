import { describe, expect, it } from "vitest";
import { dropAction, sameMachine } from "./dropAction";

const dir = (path: string) => ({ path, isDir: true });
const file = (path: string) => ({ path, isDir: false });
const empty = { lineEmpty: true, sameMachine: true, flavor: "posix" as const };

describe("dropAction", () => {
  it("changes to a folder dropped on an empty line", () => {
    expect(dropAction([dir("/srv/my app")], empty)).toEqual({ kind: "run", command: "cd '/srv/my app'" });
    expect(dropAction([dir("D:\\work")], { ...empty, flavor: "cmd" })).toEqual({ kind: "run", command: "cd /d D:\\work" });
  });

  it("types the path when something is typed, for files, and for other machines", () => {
    expect(dropAction([dir("/srv")], { ...empty, lineEmpty: false })).toEqual({ kind: "type", text: "/srv " });
    expect(dropAction([file("/srv/a b.txt")], empty)).toEqual({ kind: "type", text: "'/srv/a b.txt' " });
    expect(dropAction([dir("/srv")], { ...empty, sameMachine: false })).toEqual({ kind: "type", text: "/srv " });
  });

  it("types several paths separated by spaces, quoted for the shell", () => {
    expect(dropAction([dir("/a"), file("C:\\it's.txt")], { ...empty, flavor: "powershell" })).toEqual({
      kind: "type",
      text: "/a 'C:\\it''s.txt' ",
    });
  });

  it("refuses paths with control characters", () => {
    expect(dropAction([dir("/a\nb")], empty)).toEqual({ kind: "unsafe" });
    expect(dropAction([file("/ok"), file("/bad\u0003")], empty)).toEqual({ kind: "unsafe" });
    expect(dropAction([], empty)).toEqual({ kind: "unsafe" });
  });
});

describe("sameMachine", () => {
  it("pairs local paths with local terminals and SFTP paths with their own SSH session", () => {
    expect(sameMachine({ kind: "local" }, "local", 3)).toBe(true);
    expect(sameMachine({ kind: "local" }, "ssh", 3)).toBe(false);
    expect(sameMachine({ kind: "sftp", sessionId: 3 }, "ssh", 3)).toBe(true);
    expect(sameMachine({ kind: "sftp", sessionId: 3 }, "ssh", 4)).toBe(false);
    expect(sameMachine({ kind: "sftp", sessionId: 3 }, "local", 3)).toBe(false);
    expect(sameMachine({ kind: "sftp", sessionId: 3 }, "mosh", 3)).toBe(false);
  });
});
