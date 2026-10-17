import { describe, expect, it } from "vitest";
import { basename, isRoot, joinPath, parentPath, validName } from "./localPath";

describe("local paths", () => {
  it("join with the separator the folder uses", () => {
    expect(joinPath("/home/me", "a")).toBe("/home/me/a");
    expect(joinPath("/", "a")).toBe("/a");
    expect(joinPath("C:\\Users\\me", "a")).toBe("C:\\Users\\me\\a");
    expect(joinPath("C:\\", "a")).toBe("C:\\a");
    expect(joinPath("C:/Users", "a")).toBe("C:/Users/a");
  });

  it("go up to the root and stay there", () => {
    expect(parentPath("/home/me/")).toBe("/home");
    expect(parentPath("/home")).toBe("/");
    expect(parentPath("/")).toBe("/");
    expect(parentPath("C:\\Users\\me")).toBe("C:\\Users");
    expect(parentPath("C:\\Users")).toBe("C:\\");
    expect(parentPath("C:\\")).toBe("C:\\");
    expect(parentPath("C:/Users")).toBe("C:/");
  });

  it("tell roots and names", () => {
    expect(isRoot("/")).toBe(true);
    expect(isRoot("C:\\")).toBe(true);
    expect(isRoot("C:")).toBe(true);
    expect(isRoot("/home")).toBe(false);
    expect(basename("/home/me/notes.txt")).toBe("notes.txt");
    expect(basename("C:\\Users\\me\\")).toBe("me");
    expect(basename("/")).toBe("/");
  });

  it("refuse names with separators", () => {
    expect(validName("a.txt")).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b"]) expect(validName(bad)).toBe(false);
  });
});
