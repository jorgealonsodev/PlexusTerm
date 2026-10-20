// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { addRecentFolder, DEFAULT_RECENT_FOLDERS, loadRecentFolders, saveRecentFolders } from "./recentFolders";

afterEach(() => localStorage.clear());

describe("recent DEV mode folders", () => {
  it("puts the latest folder first, once, and keeps the last ten by default", () => {
    expect(addRecentFolder(["/a", "/b"], "/c")).toEqual(["/c", "/a", "/b"]);
    expect(addRecentFolder(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
    const many = Array.from({ length: DEFAULT_RECENT_FOLDERS }, (_, i) => `/p${i}`);
    const next = addRecentFolder(many, "/new");
    expect(next).toHaveLength(10);
    expect(next[0]).toBe("/new");
    expect(next).not.toContain("/p9");
  });

  it("keeps as many folders as asked", () => {
    expect(addRecentFolder(["/a", "/b", "/c"], "/d", 2)).toEqual(["/d", "/a"]);
    expect(addRecentFolder(["/a", "/b", "/c"], "/a", 2)).toEqual(["/a", "/b"]);
  });

  it("returns the same list when the folder is already first", () => {
    const list = ["/a", "/b"];
    expect(addRecentFolder(list, "/a")).toBe(list);
  });

  it("survives a restart in local storage and ignores a damaged value", () => {
    saveRecentFolders(["/work/app", "/work/api"]);
    expect(loadRecentFolders()).toEqual(["/work/app", "/work/api"]);
    localStorage.setItem("plexusterm.recentDevFolders", "{not json");
    expect(loadRecentFolders()).toEqual([]);
    localStorage.setItem("plexusterm.recentDevFolders", JSON.stringify(["/ok", 3, "", "/ok", "/two"]));
    expect(loadRecentFolders()).toEqual(["/ok", "/two"]);
    // Up to the largest limit Settings allow, whatever the limit now.
    saveRecentFolders(Array.from({ length: 60 }, (_, i) => `/p${i}`));
    expect(loadRecentFolders()).toHaveLength(50);
  });
});
