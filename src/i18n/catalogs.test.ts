import { describe, expect, it } from "vitest";
import { catalogs } from "./catalogs";
import { LOCALES } from "./i18n";
import type { CatalogTree } from "./types";

/** Every message of a catalogue as [key, texts]; plural forms give one text per form. */
function messages(tree: CatalogTree, prefix = ""): [string, string[]][] {
  return Object.entries(tree).flatMap(([name, value]): [string, string[]][] => {
    const key = prefix + name;
    if (typeof value === "string") return [[key, [value]]];
    if (typeof value.other === "string") return [[key, Object.values(value) as string[]]];
    return messages(value as CatalogTree, `${key}.`);
  });
}

const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

describe("catalogues (S1)", () => {
  const english = new Map(messages(catalogs.en as CatalogTree));

  it("has one catalogue per interface language", () => {
    expect(Object.keys(catalogs).sort()).toEqual(LOCALES.map((l) => l.code).sort());
  });

  for (const { code } of LOCALES.filter((l) => l.code !== "en")) {
    it(`${code}: has every English key, no extra ones, and keeps each message's placeholders`, () => {
      const translated = new Map(messages(catalogs[code] as CatalogTree));
      expect([...translated.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [key, texts] of translated) {
        const wanted = placeholders(english.get(key)!.join(" "));
        for (const text of texts) {
          // A plural form may spell out the number ("one file"), so {count} is optional there.
          const got = placeholders(text);
          expect(got.filter((p) => p !== "{count}"), `${code} ${key}: ${text}`).toEqual(wanted.filter((p) => p !== "{count}"));
          expect(text.trim(), `${code} ${key} is empty`).not.toBe("");
        }
      }
    });
  }
});
