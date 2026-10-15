import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS, parseSettings, serializeSettings, stepFontSize } from "./settings";

describe("parseSettings", () => {
  it("returns the defaults when there is no settings file", () => {
    expect(parseSettings(null)).toEqual({
      fontSize: 14,
      copyOnSelect: true,
      rightClickPastes: true,
      confirmMultilinePaste: true,
      theme: "catppuccin-mocha",
      fontFamily: DEFAULT_FONT_FAMILY,
      remoteMonitor: true,
      textEditor: "",
    });
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
  });

  it("returns the defaults for a file that is not a JSON object", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("reads saved values", () => {
    const json =
      '{"version":1,"fontSize":18,"copyOnSelect":false,"rightClickPastes":false,"confirmMultilinePaste":false,"theme":"nord","fontFamily":"Fira Code","remoteMonitor":false,"textEditor":"code --wait"}';
    expect(parseSettings(json)).toEqual({
      fontSize: 18,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      theme: "nord",
      fontFamily: "Fira Code",
      remoteMonitor: false,
      textEditor: "code --wait",
    });
  });

  it("clamps the font size to 8..32 and rounds it", () => {
    expect(parseSettings('{"fontSize":2}').fontSize).toBe(8);
    expect(parseSettings('{"fontSize":99}').fontSize).toBe(32);
    expect(parseSettings('{"fontSize":15.6}').fontSize).toBe(16);
  });

  it("defaults invalid values and ignores unknown keys", () => {
    const parsed = parseSettings('{"fontSize":"big","copyOnSelect":"yes","rightClickPastes":0,"colour":"dark"}');
    expect(parsed).toEqual(DEFAULT_SETTINGS);
    expect(parsed).not.toHaveProperty("colour");
    expect(parseSettings('{"fontSize":null}').fontSize).toBe(14);
    expect(parseSettings('{"fontSize":1e999}').fontSize).toBe(14);
  });

  it("uses the default theme for unknown or invalid theme ids", () => {
    expect(parseSettings('{"theme":"dracula-pro"}').theme).toBe("catppuccin-mocha");
    expect(parseSettings('{"theme":7}').theme).toBe("catppuccin-mocha");
  });

  it("uses the default font for an empty, overlong or invalid font family and trims it", () => {
    expect(parseSettings('{"fontFamily":"   "}').fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(parseSettings(JSON.stringify({ fontFamily: "x".repeat(201) })).fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(parseSettings('{"fontFamily":false}').fontFamily).toBe(DEFAULT_FONT_FAMILY);
    expect(parseSettings('{"fontFamily":"  Hack Nerd Font  "}').fontFamily).toBe("Hack Nerd Font");
  });

  it("uses the default for an invalid remote monitor value", () => {
    expect(parseSettings('{"remoteMonitor":"off"}').remoteMonitor).toBe(true);
    expect(parseSettings('{"remoteMonitor":false}').remoteMonitor).toBe(false);
  });

  it("uses the system default text editor for an invalid or overlong value and trims it", () => {
    expect(parseSettings('{"textEditor":7}').textEditor).toBe("");
    expect(parseSettings('{"textEditor":"   "}').textEditor).toBe("");
    expect(parseSettings(JSON.stringify({ textEditor: "x".repeat(1025) })).textEditor).toBe("");
    expect(parseSettings(JSON.stringify({ textEditor: "x".repeat(1024) })).textEditor).toBe("x".repeat(1024));
    expect(parseSettings('{"textEditor":"  /usr/bin/kate  "}').textEditor).toBe("/usr/bin/kate");
  });

  it("keeps valid values next to invalid ones", () => {
    expect(parseSettings('{"fontSize":20,"copyOnSelect":"no"}')).toEqual({ ...DEFAULT_SETTINGS, fontSize: 20 });
  });
});

describe("serializeSettings", () => {
  it("round-trips through parseSettings with a version", () => {
    const settings = {
      fontSize: 11,
      copyOnSelect: false,
      rightClickPastes: true,
      confirmMultilinePaste: false,
      theme: "gruvbox-dark",
      fontFamily: "Iosevka",
      remoteMonitor: false,
      textEditor: "/opt/My Editor/editor",
    };
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
