import { describe, expect, it } from "vitest";
import { basename, joinPath, parentPath } from "./remotePath";

describe("joinPath", () => {
  it("joins a directory and a name with one separator", () => {
    expect(joinPath("/home/u", "a.txt")).toBe("/home/u/a.txt");
    expect(joinPath("/home/u/", "a.txt")).toBe("/home/u/a.txt");
    expect(joinPath("/", "etc")).toBe("/etc");
  });
});

describe("parentPath", () => {
  it("returns the containing folder", () => {
    expect(parentPath("/home/u/docs")).toBe("/home/u");
    expect(parentPath("/home/u/docs/")).toBe("/home/u");
    expect(parentPath("/home")).toBe("/");
  });

  it("keeps the root as its own parent", () => {
    expect(parentPath("/")).toBe("/");
  });
});

describe("basename", () => {
  it("returns the last segment", () => {
    expect(basename("/home/u/a.txt")).toBe("a.txt");
    expect(basename("/home/u/")).toBe("u");
    expect(basename("/")).toBe("/");
  });
});
