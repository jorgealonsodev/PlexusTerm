import { describe, expect, it } from "vitest";
import { basename, joinPath, parentPath, shellQuote } from "./remotePath";

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

describe("shellQuote", () => {
  it("leaves plain paths unquoted", () => {
    expect(shellQuote("/home/u/src/main.rs")).toBe("/home/u/src/main.rs");
    expect(shellQuote("/opt/app-1.2_x/a+b@c:d,e=f%")).toBe("/opt/app-1.2_x/a+b@c:d,e=f%");
  });

  it("single-quotes other paths and escapes single quotes", () => {
    expect(shellQuote("/home/u/my file.txt")).toBe("'/home/u/my file.txt'");
    expect(shellQuote("/tmp/it's")).toBe("'/tmp/it'\\''s'");
    expect(shellQuote("/tmp/$HOME;rm")).toBe("'/tmp/$HOME;rm'");
    expect(shellQuote("~/a")).toBe("'~/a'");
    expect(shellQuote("")).toBe("''");
  });
});
