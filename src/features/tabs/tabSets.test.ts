import { describe, expect, it } from "vitest";
import {
  MAX_TAB_SET_NAME,
  TAB_SETS_VERSION,
  cleanTabSetName,
  findTabSet,
  parseTabSets,
  putTabSet,
  removeTabSet,
  renameTabSet,
  serializeTabSets,
  type TabSet,
} from "./tabSets";
import type { TabsDocument } from "./tabsPersist";

const doc = (sessionId: string): TabsDocument => ({
  version: 1,
  active: 0,
  tabs: [{ source: { sessionId }, layout: { kind: "pane", id: "pane-1" }, focused: "pane-1", panes: {} }],
});
const sets: TabSet[] = [
  { name: "Prod", tabs: doc("s1") },
  { name: "Project X", tabs: doc("s2") },
];

describe("tab sets file", () => {
  it("reads back what it writes", () => {
    expect(parseTabSets(serializeTabSets(sets))).toEqual(sets);
    expect(JSON.parse(serializeTabSets(sets)).version).toBe(TAB_SETS_VERSION);
  });

  it.each([
    ["no file", null],
    ["a bad file", "{not json"],
    ["a foreign file", JSON.stringify({ version: 1, folders: [], sessions: [] })],
    ["another version", JSON.stringify({ version: 2, sets: [] })],
    ["a list", "[]"],
  ])("reads %s as no sets", (_name, json) => {
    expect(parseTabSets(json)).toEqual([]);
  });

  it("drops sets without a name, repeated names and tabs that cannot be restored, through the tabs.json sanitizer", () => {
    const json = JSON.stringify({
      version: 1,
      sets: [
        { name: "  Prod  ", tabs: doc("s1") },
        { name: "prod", tabs: doc("s9") },
        { name: "", tabs: doc("s3") },
        { name: "No tabs", tabs: "x" },
        "junk",
        {
          name: "Mixed",
          tabs: {
            version: 1,
            active: 0,
            tabs: [
              { source: { target: { type: "shared", url: "https://x/#key" } }, layout: { kind: "pane", id: "p" }, focused: "p", panes: {} },
              {
                source: { target: { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "password", password: "hunter2" } } },
                layout: { kind: "pane", id: "p" },
                focused: "p",
                panes: {},
              },
            ],
          },
        },
      ],
    });
    const read = parseTabSets(json);
    expect(read.map((s) => s.name)).toEqual(["Prod", "Mixed"]);
    expect(read[0].tabs).toEqual(doc("s1"));
    expect(read[1].tabs.tabs).toHaveLength(1);
    expect(JSON.stringify(read)).not.toContain("hunter2");
  });
});

describe("tab set names", () => {
  it("trims a name and refuses an empty or too long one", () => {
    expect(cleanTabSetName("  Producción ")).toBe("Producción");
    expect(cleanTabSetName("   ")).toBeNull();
    expect(cleanTabSetName("n".repeat(MAX_TAB_SET_NAME))).toBe("n".repeat(MAX_TAB_SET_NAME));
    expect(cleanTabSetName("n".repeat(MAX_TAB_SET_NAME + 1))).toBeNull();
  });

  it("finds a set whatever the case", () => {
    expect(findTabSet(sets, "project x")?.name).toBe("Project X");
    expect(findTabSet(sets, "Staging")).toBeUndefined();
  });
});

describe("changing tab sets", () => {
  it("adds a new set at the end and replaces one with the same name in its place", () => {
    expect(putTabSet(sets, "Staging", doc("s3")).map((s) => s.name)).toEqual(["Prod", "Project X", "Staging"]);
    const replaced = putTabSet(sets, "prod", doc("s4"));
    expect(replaced.map((s) => s.name)).toEqual(["prod", "Project X"]);
    expect(replaced[0].tabs).toEqual(doc("s4"));
  });

  it("renames a set, keeping its tabs, and refuses a name another set has", () => {
    expect(renameTabSet(sets, "Prod", "Production")).toEqual([{ name: "Production", tabs: doc("s1") }, sets[1]]);
    expect(renameTabSet(sets, "Prod", "PROD")?.[0].name).toBe("PROD");
    expect(renameTabSet(sets, "Prod", "project x")).toBeNull();
  });

  it("removes a set", () => {
    expect(removeTabSet(sets, "Prod")).toEqual([sets[1]]);
  });
});
