import { describe, expect, it, vi } from "vitest";
import { projectRootOf } from "./projectRoot";

const tree: Record<string, string[]> = {
  "/home/me/repo": [".git", "src"],
  "/home/me/repo/src": ["main.ts"],
  "/home/me/repo/src/deep": [],
  "/home/me": ["repo"],
  "/home": ["me"],
  "/": ["home"],
  "C:\\work\\app": [".git"],
  "C:\\work\\app\\lib": [],
};
const list = vi.fn(async (path: string) => {
  const names = tree[path];
  if (!names) throw new Error(`cannot list ${path}`);
  return names.map((name) => ({ name }));
});

describe("projectRootOf (S10)", () => {
  it("is the git repository holding the folder", async () => {
    expect(await projectRootOf("/home/me/repo/src/deep", list)).toBe("/home/me/repo");
    expect(await projectRootOf("/home/me/repo", list)).toBe("/home/me/repo");
    expect(await projectRootOf("C:\\work\\app\\lib", list)).toBe("C:\\work\\app");
  });

  it("is the folder itself outside a repository or when a folder cannot be listed", async () => {
    expect(await projectRootOf("/home/me", list)).toBe("/home/me");
    expect(await projectRootOf("/nowhere/x", list)).toBe("/nowhere/x");
  });
});
