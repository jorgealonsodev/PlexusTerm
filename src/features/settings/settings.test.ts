import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS, parseSettings, serializeSettings, stepFontSize } from "./settings";

describe("parseSettings", () => {
  it("drops OpenCode's own opencode-go/ prefix from OpenCode Go model ids", () => {
    const json = JSON.stringify({ aiProvider: "opencode-go", aiModel: "opencode-go/glm-5.3-flash" });
    expect(parseSettings(json).aiModel).toBe("glm-5.3-flash");
    // Other providers keep slashes (e.g. OpenRouter ids).
    expect(parseSettings(JSON.stringify({ aiProvider: "openai-compatible", aiModel: "meta/llama-4" })).aiModel).toBe("meta/llama-4");
  });

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
      inlineSuggestions: true,
      commandHistory: true,
      aiSuggestions: false,
      aiProvider: "anthropic",
      aiBaseUrl: "",
      aiModel: "claude-opus-5-5",
      aiHistoryContext: 5,
      assistantShortcut: "Ctrl+Shift+Space",
      sidebarCollapsed: false,
      sidebarHideWhenCollapsed: false,
      localShell: "",
      localShellArgs: "",
      language: "system",
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
      '{"version":1,"fontSize":18,"copyOnSelect":false,"rightClickPastes":false,"confirmMultilinePaste":false,"theme":"nord","fontFamily":"Fira Code","remoteMonitor":false,"textEditor":"code --wait",' +
      '"inlineSuggestions":false,"commandHistory":false,"aiSuggestions":true,"aiProvider":"openai-compatible",' +
      '"aiBaseUrl":"http://localhost:11434/v1","aiModel":"llama3.1","aiHistoryContext":0,"assistantShortcut":"Ctrl+Alt+K",' +
      '"sidebarCollapsed":true,"sidebarHideWhenCollapsed":true,"localShell":" /usr/bin/fish ","localShellArgs":" --login ","language":"ja"}';
    expect(parseSettings(json)).toEqual({
      fontSize: 18,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      theme: "nord",
      fontFamily: "Fira Code",
      remoteMonitor: false,
      textEditor: "code --wait",
      inlineSuggestions: false,
      commandHistory: false,
      aiSuggestions: true,
      aiProvider: "openai-compatible",
      aiBaseUrl: "http://localhost:11434/v1",
      aiModel: "llama3.1",
      aiHistoryContext: 0,
      assistantShortcut: "Ctrl+Alt+K",
      sidebarCollapsed: true,
      sidebarHideWhenCollapsed: true,
      localShell: "/usr/bin/fish",
      localShellArgs: "--login",
      language: "ja",
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

  it("defaults invalid suggestion and AI switches", () => {
    const parsed = parseSettings('{"inlineSuggestions":"no","commandHistory":1,"aiSuggestions":"yes"}');
    expect([parsed.inlineSuggestions, parsed.commandHistory, parsed.aiSuggestions]).toEqual([true, true, false]);
  });

  it("knows Anthropic, Gemini, OpenAI and OpenAI-compatible providers, each with its default model", () => {
    expect(parseSettings('{"aiProvider":"gemini"}')).toMatchObject({ aiProvider: "gemini", aiModel: "gemini-3.5-flash-lite" });
    expect(parseSettings('{"aiProvider":"openai"}')).toMatchObject({ aiProvider: "openai", aiModel: "" });
    expect(parseSettings('{"aiProvider":"opencode"}')).toMatchObject({ aiProvider: "anthropic", aiModel: "claude-opus-5-5" });
    expect(parseSettings('{"aiProvider":"gemini","aiModel":"  gemini-2.5-pro "}').aiModel).toBe("gemini-2.5-pro");
    expect(parseSettings(JSON.stringify({ aiModel: "x".repeat(201) })).aiModel).toBe("claude-opus-5-5");
    expect(parseSettings('{"aiProvider":"openai","aiModel":7}').aiModel).toBe("");
  });

  it("knows OpenCode Go, whose model is left for the user to pick", () => {
    expect(parseSettings('{"aiProvider":"opencode-go"}')).toMatchObject({ aiProvider: "opencode-go", aiModel: "" });
    expect(parseSettings('{"aiProvider":"opencode-go","aiModel":" kimi-k3 "}').aiModel).toBe("kimi-k3");
  });

  it("accepts only http(s) base URLs", () => {
    expect(parseSettings('{"aiBaseUrl":" https://openrouter.ai/api/v1 "}').aiBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(parseSettings('{"aiBaseUrl":"file:///etc/passwd"}').aiBaseUrl).toBe("");
    expect(parseSettings('{"aiBaseUrl":3}').aiBaseUrl).toBe("");
  });

  it("keeps 0..20 history commands as AI context, rounding and clamping", () => {
    expect(parseSettings('{"aiHistoryContext":25}').aiHistoryContext).toBe(20);
    expect(parseSettings('{"aiHistoryContext":-3}').aiHistoryContext).toBe(0);
    expect(parseSettings('{"aiHistoryContext":2.6}').aiHistoryContext).toBe(3);
    expect(parseSettings('{"aiHistoryContext":"many"}').aiHistoryContext).toBe(5);
  });

  it("uses the default assistant shortcut for an invalid one", () => {
    expect(parseSettings('{"assistantShortcut":"Space"}').assistantShortcut).toBe("Ctrl+Shift+Space");
    expect(parseSettings('{"assistantShortcut":"Ctrl+Shift+T"}').assistantShortcut).toBe("Ctrl+Shift+Space");
    expect(parseSettings('{"assistantShortcut":42}').assistantShortcut).toBe("Ctrl+Shift+Space");
    expect(parseSettings('{"assistantShortcut":"Alt+Shift+A"}').assistantShortcut).toBe("Alt+Shift+A");
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
      inlineSuggestions: false,
      commandHistory: true,
      aiSuggestions: true,
      aiProvider: "gemini" as const,
      aiBaseUrl: "",
      aiModel: "gemini-2.5-pro",
      aiHistoryContext: 12,
      assistantShortcut: "Ctrl+Alt+Space",
      sidebarCollapsed: true,
      sidebarHideWhenCollapsed: true,
      localShell: "C:\\Program Files\\Git\\bin\\bash.exe",
      localShellArgs: "--login -i",
      language: "pt-BR" as const,
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

describe("sidebar settings", () => {
  it("default to an open sidebar that folds to icons, and keep saved booleans only", () => {
    expect(DEFAULT_SETTINGS.sidebarCollapsed).toBe(false);
    expect(DEFAULT_SETTINGS.sidebarHideWhenCollapsed).toBe(false);
    const parsed = parseSettings(JSON.stringify({ sidebarCollapsed: true, sidebarHideWhenCollapsed: "yes" }));
    expect(parsed.sidebarCollapsed).toBe(true);
    expect(parsed.sidebarHideWhenCollapsed).toBe(false);
  });
});

describe("local shell settings", () => {
  it("default to the system shell and keep only text of at most 1024 characters", () => {
    expect(DEFAULT_SETTINGS.localShell).toBe("");
    expect(DEFAULT_SETTINGS.localShellArgs).toBe("");
    const parsed = parseSettings(JSON.stringify({ localShell: 7, localShellArgs: "x".repeat(1025) }));
    expect(parsed.localShell).toBe("");
    expect(parsed.localShellArgs).toBe("");
  });
});

describe("language setting", () => {
  it("defaults to the system language and keeps only supported values", () => {
    expect(parseSettings(JSON.stringify({ language: "zh-CN" })).language).toBe("zh-CN");
    expect(parseSettings(JSON.stringify({ language: "klingon" })).language).toBe("system");
  });
});
