// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { loadFoldedSessionFolders, loadSidebarView, saveFoldedSessionFolders, saveSidebarView } from "./uiMemory";

const VIEWS = ["sessions", "explorer"] as const;

describe("how the interface was left", () => {
  it("remembers the sidebar tab, and ignores a value that is not a tab", () => {
    expect(loadSidebarView(VIEWS)).toBeNull();
    saveSidebarView("explorer");
    expect(loadSidebarView(VIEWS)).toBe("explorer");
    localStorage.setItem("plexusterm.sidebarView", JSON.stringify("nope"));
    expect(loadSidebarView(VIEWS)).toBeNull();
    localStorage.setItem("plexusterm.sidebarView", "{broken");
    expect(loadSidebarView(VIEWS)).toBeNull();
  });

  it("remembers the folded session folders", () => {
    expect(loadFoldedSessionFolders()).toEqual(new Set());
    saveFoldedSessionFolders(new Set(["Personales", "Etic/old"]));
    expect(loadFoldedSessionFolders()).toEqual(new Set(["Etic/old", "Personales"]));
    localStorage.setItem("plexusterm.foldedSessionFolders", JSON.stringify(["a", 3, null]));
    expect(loadFoldedSessionFolders()).toEqual(new Set(["a"]));
  });
});
