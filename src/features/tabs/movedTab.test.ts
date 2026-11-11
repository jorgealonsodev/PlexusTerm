import { describe, expect, it } from "vitest";
import { parseMovedTab } from "./movedTab";

const doc = {
  version: 1,
  active: 0,
  tabs: [{ source: { target: { type: "local" } }, layout: { kind: "pane", id: "pane-1" }, focused: "pane-1", panes: {} }],
};

describe("parseMovedTab", () => {
  it("reads the tab, the sessions of its panes and its title", () => {
    const adoption = { sessionId: 3, tap: 30, content: "x" };
    expect(parseMovedTab(JSON.stringify({ doc, panes: { "pane-1": adoption }, title: "api" }))).toEqual({
      doc: expect.objectContaining({ tabs: [expect.objectContaining({ focused: "pane-1" })] }),
      panes: { "pane-1": adoption },
      title: "api",
    });
  });

  it("leaves out a pane whose session cannot be read, and keeps the tab", () => {
    const moved = parseMovedTab(JSON.stringify({ doc, panes: { "pane-1": { sessionId: "3", tap: 30, content: "x" } }, title: 5 }));
    expect(moved?.panes).toEqual({});
    expect(moved?.title).toBeNull();
  });

  it("is null without a hand-off, for text that is not one, or for anything but one tab", () => {
    expect(parseMovedTab(null)).toBeNull();
    expect(parseMovedTab("not json")).toBeNull();
    expect(parseMovedTab(JSON.stringify({ doc: { ...doc, tabs: [] }, panes: {} }))).toBeNull();
    expect(parseMovedTab(JSON.stringify({ doc: { ...doc, tabs: [doc.tabs[0], doc.tabs[0]] }, panes: {} }))).toBeNull();
  });
});
