import { describe, expect, it } from "vitest";
import { filterPalette, MAX_SHOWN, type PaletteItem } from "./paletteItems";

const item = (id: string, label: string, group: PaletteItem["group"] = "actions", detail?: string): PaletteItem => ({
  id,
  label,
  group,
  detail,
  run: () => {},
});

describe("filterPalette", () => {
  const items = [
    item("a1", "New terminal"),
    item("a2", "Split right"),
    item("s1", "Producción web", "sessions", "Etic"),
    item("s2", "staging", "sessions", "Etic/web"),
    item("m1", "Deploy web", "macros"),
    item("t1", "jorge@host: ~/src", "tabs"),
  ];
  const ids = (query: string) => filterPalette(items, query).map((i) => i.id);

  it("lists everything, in order, with an empty query", () => {
    expect(ids("")).toEqual(["a1", "a2", "s1", "s2", "m1", "t1"]);
  });

  it("keeps the items with every word of the query, in any order, without accents or case", () => {
    expect(ids("WEB produccion")).toEqual(["s1"]);
    expect(ids("web")).toEqual(["s1", "m1", "s2"]);
    expect(ids("nothing here")).toEqual([]);
  });

  it("finds an item by its detail too, but shows the ones whose name matches first", () => {
    // "etic" is only in the sessions' folder; "web" is in s1's and m1's names, only in s2's folder.
    expect(ids("etic")).toEqual(["s1", "s2"]);
    expect(ids("web")[2]).toBe("s2");
  });

  it("puts names that start with the query before the others", () => {
    const list = [item("x", "Clear the terminal"), item("y", "Terminal settings"), item("z", "New terminal")];
    expect(filterPalette(list, "term").map((i) => i.id)).toEqual(["y", "x", "z"]);
  });

  it("shows at most MAX_SHOWN items", () => {
    const many = Array.from({ length: MAX_SHOWN + 20 }, (_, n) => item(`i${n}`, `Item ${n}`));
    expect(filterPalette(many, "item")).toHaveLength(MAX_SHOWN);
  });
});
