import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, serializeSettings, stepFontSize } from "./settings";

describe("parseSettings", () => {
  it("returns the defaults when there is no settings file", () => {
    expect(parseSettings(null)).toEqual({
      fontSize: 14,
      copyOnSelect: true,
      rightClickPastes: true,
      confirmMultilinePaste: true,
    });
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
  });

  it("returns the defaults for a file that is not a JSON object", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("reads saved values", () => {
    const json = '{"version":1,"fontSize":18,"copyOnSelect":false,"rightClickPastes":false,"confirmMultilinePaste":false}';
    expect(parseSettings(json)).toEqual({
      fontSize: 18,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
    });
  });

  it("clamps the font size to 8..32 and rounds it", () => {
    expect(parseSettings('{"fontSize":2}').fontSize).toBe(8);
    expect(parseSettings('{"fontSize":99}').fontSize).toBe(32);
    expect(parseSettings('{"fontSize":15.6}').fontSize).toBe(16);
  });

  it("defaults invalid values and ignores unknown keys", () => {
    const parsed = parseSettings('{"fontSize":"big","copyOnSelect":"yes","rightClickPastes":0,"theme":"dark"}');
    expect(parsed).toEqual(DEFAULT_SETTINGS);
    expect(parsed).not.toHaveProperty("theme");
    expect(parseSettings('{"fontSize":null}').fontSize).toBe(14);
    expect(parseSettings('{"fontSize":1e999}').fontSize).toBe(14);
  });

  it("keeps valid values next to invalid ones", () => {
    expect(parseSettings('{"fontSize":20,"copyOnSelect":"no"}')).toEqual({ ...DEFAULT_SETTINGS, fontSize: 20 });
  });
});

describe("serializeSettings", () => {
  it("round-trips through parseSettings with a version", () => {
    const settings = { fontSize: 11, copyOnSelect: false, rightClickPastes: true, confirmMultilinePaste: false };
    const json = serializeSettings(settings);
    expect(JSON.parse(json)).toEqual({ version: 1, ...settings });
    expect(parseSettings(json)).toEqual(settings);
  });
});

describe("stepFontSize", () => {
  it("grows, shrinks and resets the font size within 8..32", () => {
    expect(stepFontSize(14, "increase")).toBe(15);
    expect(stepFontSize(14, "decrease")).toBe(13);
    expect(stepFontSize(20, "reset")).toBe(14);
    expect(stepFontSize(32, "increase")).toBe(32);
    expect(stepFontSize(8, "decrease")).toBe(8);
  });
});
