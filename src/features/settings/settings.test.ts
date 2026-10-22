import { describe, expect, it } from "vitest";
import { cleanShareUrl, DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS, focusBorderCss, FONT_WEIGHTS, LINE_HEIGHTS, parseSettings, serializeSettings, stepChatFontSize, stepFontSize } from "./settings";

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
      errorHighlight: true,
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
      localCwd: "",
      sidebarWidth: null,
      checkUpdates: true,
      aiSaveChats: true,
      fileDetails: false,
      terminalFollowsBrowser: true,
      sidebarAtStartup: "last",
      language: "system",
      shortcuts: {},
      shiftEnterNewline: true,
      attentionNotifications: true,
      gpuAcceleration: true,
      gitFileStatus: true,
      viewerAutoSave: false,
      viewerPosition: "left" as const,
      viewerChangedLines: true,
      fontWeight: 400,
      lineHeight: 1,
      uiFontSize: 13,
      chatFontSize: 13,
      viewerFontSize: 13,
      devCommands: ["claude", "codex", "agy", "opencode", "pi", "gentle-shell"],
      tabColumnWidth: null,
      devColumnCollapsed: false,
      devColumnHideWhenCollapsed: false,
      devColumnAtStartup: "last",
      recentFolderLimit: 10,
      devFolderInFooter: true,
      shareRelayUrl: "",
      shareViewerOrigin: "",
      shareViewNeedsApproval: true,
      shareSudoReset: true,
      shareBlockLid: false,
      shareRecordInput: false,
      diagnosticLog: false,
      diagnosticLogDir: "",
      fileIconsList: "material",
      fileIconsTree: "seti",
      focusBorderColor: "",
      focusBorderStrength: 55,
    });
    expect(DEFAULT_SETTINGS.fontSize).toBe(14);
  });

  it("opens the sidebar as Settings choose at startup, or as it was left (L17)", () => {
    const at = (sidebarAtStartup: string, sidebarCollapsed: boolean) =>
      parseSettings(JSON.stringify({ sidebarAtStartup, sidebarCollapsed })).sidebarCollapsed;
    expect(at("last", true)).toBe(true);
    expect(at("last", false)).toBe(false);
    expect(at("expanded", true)).toBe(false);
    expect(at("collapsed", false)).toBe(true);
    expect(parseSettings(JSON.stringify({ sidebarAtStartup: "sideways" })).sidebarAtStartup).toBe("last");
  });

  it("opens the DEV tab column as Settings choose at startup, or as it was left", () => {
    const at = (devColumnAtStartup: string, devColumnCollapsed: boolean) =>
      parseSettings(JSON.stringify({ devColumnAtStartup, devColumnCollapsed })).devColumnCollapsed;
    expect(at("last", true)).toBe(true);
    expect(at("last", false)).toBe(false);
    expect(at("expanded", true)).toBe(false);
    expect(at("collapsed", false)).toBe(true);
    expect(parseSettings(JSON.stringify({ devColumnAtStartup: "sideways" })).devColumnAtStartup).toBe("last");
    expect(parseSettings(JSON.stringify({ devColumnHideWhenCollapsed: true })).devColumnHideWhenCollapsed).toBe(true);
  });

  it("keeps between 1 and 50 recent DEV mode folders, 10 by default", () => {
    const of = (recentFolderLimit: unknown) => parseSettings(JSON.stringify({ recentFolderLimit })).recentFolderLimit;
    expect(of(20)).toBe(20);
    expect(of(0)).toBe(1);
    expect(of(99)).toBe(50);
    expect(of(7.6)).toBe(8);
    expect(of("many")).toBe(10);
    expect(parseSettings(JSON.stringify({ devFolderInFooter: false })).devFolderInFooter).toBe(false);
  });

  it("reads where the file viewer opens, the left when unknown", () => {
    const of = (viewerPosition: unknown) => parseSettings(JSON.stringify({ viewerPosition })).viewerPosition;
    expect(of("right")).toBe("right");
    expect(of("below")).toBe("below");
    expect(of("above")).toBe("left");
    expect(parseSettings(null).viewerPosition).toBe("left");
  });

  it("returns the defaults for a file that is not a JSON object", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("null")).toEqual(DEFAULT_SETTINGS);
  });

  it("reads saved values", () => {
    const json =
      '{"version":1,"fontSize":18,"copyOnSelect":false,"rightClickPastes":false,"confirmMultilinePaste":false,"errorHighlight":false,"theme":"nord","fontFamily":"Fira Code","remoteMonitor":false,"textEditor":"code --wait",' +
      '"inlineSuggestions":false,"commandHistory":false,"aiSuggestions":true,"aiProvider":"openai-compatible",' +
      '"aiBaseUrl":"http://localhost:11434/v1","aiModel":"llama3.1","aiHistoryContext":0,"assistantShortcut":"Ctrl+Alt+K",' +
      '"sidebarCollapsed":true,"sidebarHideWhenCollapsed":true,"sidebarWidth":320,"localShell":" /usr/bin/fish ","localShellArgs":" --login ","localCwd":" ~/projects ","checkUpdates":false,"aiSaveChats":false,"fileDetails":true,"terminalFollowsBrowser":false,"sidebarAtStartup":"collapsed","language":"ja"}';
    expect(parseSettings(json)).toEqual({
      fontSize: 18,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      errorHighlight: false,
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
      localCwd: "~/projects",
      sidebarWidth: 320,
      checkUpdates: false,
      aiSaveChats: false,
      fileDetails: true,
      terminalFollowsBrowser: false,
      sidebarAtStartup: "collapsed",
      language: "ja",
      // A file from before customisable shortcuts loads with the defaults.
      shortcuts: {},
      // So do the settings added for AI command-line tools.
      shiftEnterNewline: true,
      attentionNotifications: true,
      gpuAcceleration: true,
      gitFileStatus: true,
      viewerAutoSave: false,
      viewerPosition: "left" as const,
      viewerChangedLines: true,
      fontWeight: 400,
      lineHeight: 1,
      uiFontSize: 13,
      chatFontSize: 13,
      viewerFontSize: 13,
      devCommands: ["claude", "codex", "agy", "opencode", "pi", "gentle-shell"],
      tabColumnWidth: null,
      devColumnCollapsed: false,
      devColumnHideWhenCollapsed: false,
      devColumnAtStartup: "last",
      recentFolderLimit: 10,
      devFolderInFooter: true,
      shareRelayUrl: "",
      shareViewerOrigin: "",
      shareViewNeedsApproval: true,
      shareSudoReset: true,
      shareBlockLid: false,
      shareRecordInput: false,
      diagnosticLog: false,
      diagnosticLogDir: "",
      fileIconsList: "material",
      fileIconsTree: "seti",
      focusBorderColor: "",
      focusBorderStrength: 55,
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

  it("keeps only usable shortcut overrides", () => {
    const shortcuts = (value: unknown, extra: Record<string, unknown> = {}) =>
      parseSettings(JSON.stringify({ shortcuts: value, ...extra })).shortcuts;
    expect(shortcuts({ newTerminal: "Ctrl+Alt+N", toggleSidebar: "", keyGen: "Alt+K" })).toEqual({
      newTerminal: "Ctrl+Alt+N",
      toggleSidebar: "",
      keyGen: "Alt+K",
    });
    // Unknown actions, invalid shortcuts and values that are not text.
    expect(shortcuts({ launchRocket: "Alt+R", closeTab: "Shift+A", nextTab: 3, previousTab: "Ctrl+" })).toEqual({});
    // The fixed keys and the assistant shortcut.
    expect(shortcuts({ closeTab: "Ctrl+Alt+2", nextTab: "Ctrl+ArrowRight", previousTab: "Ctrl+Shift+Space" })).toEqual({});
    expect(shortcuts({ previousTab: "Alt+A" }, { assistantShortcut: "Alt+A" })).toEqual({});
    // Taken by another action's default, or by another override.
    expect(shortcuts({ closeTab: "Ctrl+Shift+T" })).toEqual({});
    expect(shortcuts({ closeTab: "Alt+X", nextTab: "Alt+X" })).toEqual({ closeTab: "Alt+X" });
    // Freed by another override: a swap is kept.
    expect(shortcuts({ newTerminal: "Ctrl+Shift+S", quickConnect: "Ctrl+Shift+T" })).toEqual({
      newTerminal: "Ctrl+Shift+S",
      quickConnect: "Ctrl+Shift+T",
    });
    expect(shortcuts("Ctrl+Shift+T")).toEqual({});
    expect(shortcuts(["Alt+X"])).toEqual({});
  });

  it("lets the assistant take a combination an override freed", () => {
    const parsed = parseSettings(JSON.stringify({ shortcuts: { newTerminal: "Alt+N" }, assistantShortcut: "Ctrl+Shift+T" }));
    expect(parsed.assistantShortcut).toBe("Ctrl+Shift+T");
    expect(parsed.shortcuts).toEqual({ newTerminal: "Alt+N" });
  });

  it("keeps valid values next to invalid ones", () => {
    expect(parseSettings('{"fontSize":20,"copyOnSelect":"no"}')).toEqual({ ...DEFAULT_SETTINGS, fontSize: 20 });
  });
});

describe("the removed gitBranch setting", () => {
  it("is ignored in older settings files: the branch only depends on DEV mode", () => {
    const parsed = parseSettings('{"version":1,"gitBranch":false,"fontSize":15}');
    expect(parsed.fontSize).toBe(15);
    expect("gitBranch" in parsed).toBe(false);
    expect("gitBranch" in DEFAULT_SETTINGS).toBe(false);
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
      localCwd: "~/work",
      aiSaveChats: false,
      fileDetails: true,
      terminalFollowsBrowser: false,
      sidebarAtStartup: "last" as const,
      sidebarWidth: 480,
      checkUpdates: false,
      errorHighlight: false,
      language: "pt-BR" as const,
      shortcuts: { newTerminal: "Ctrl+Alt+N", toggleSidebar: "", nextTab: "Ctrl+PageDown" },
      shiftEnterNewline: false,
      attentionNotifications: false,
      gpuAcceleration: false,
      gitFileStatus: false,
      viewerAutoSave: true,
      viewerPosition: "left" as const,
      viewerChangedLines: false,
      fontWeight: 500,
      lineHeight: 1,
      uiFontSize: 15,
      chatFontSize: 17,
      viewerFontSize: 13,
      devCommands: ["aider"],
      tabColumnWidth: 300,
      devColumnCollapsed: true,
      devColumnHideWhenCollapsed: true,
      devColumnAtStartup: "last" as const,
      recentFolderLimit: 25,
      devFolderInFooter: false,
      shareRelayUrl: "wss://relay.example.com",
      shareViewerOrigin: "https://view.example.com",
      shareViewNeedsApproval: false,
      shareSudoReset: false,
      shareBlockLid: true,
      shareRecordInput: true,
      diagnosticLog: true,
      diagnosticLogDir: "/var/tmp/plexus-logs",
      fileIconsList: "lines" as const,
      fileIconsTree: "material" as const,
      focusBorderColor: "#ff8800",
      focusBorderStrength: 30,
    };
    const json = serializeSettings(settings);
    expect(JSON.parse(json)).toEqual({ version: 2, ...settings });
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

  it("keeps a dragged width within 160..640 px and forgets anything else", () => {
    expect(DEFAULT_SETTINGS.sidebarWidth).toBeNull();
    expect(parseSettings(JSON.stringify({ sidebarWidth: 300 })).sidebarWidth).toBe(300);
    expect(parseSettings(JSON.stringify({ sidebarWidth: 300.6 })).sidebarWidth).toBe(301);
    expect(parseSettings(JSON.stringify({ sidebarWidth: 20 })).sidebarWidth).toBe(160);
    expect(parseSettings(JSON.stringify({ sidebarWidth: 5000 })).sidebarWidth).toBe(640);
    for (const bad of ["300", null, true]) {
      expect(parseSettings(JSON.stringify({ sidebarWidth: bad })).sidebarWidth).toBeNull();
    }
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

describe("focused pane border", () => {
  it("uses the scheme's accent at 55% by default, keeps a #rrggbb colour and a strength within 10..100", () => {
    expect([DEFAULT_SETTINGS.focusBorderColor, DEFAULT_SETTINGS.focusBorderStrength]).toEqual(["", 55]);
    const parsed = parseSettings(JSON.stringify({ focusBorderColor: " #FF8800 ", focusBorderStrength: 3 }));
    expect([parsed.focusBorderColor, parsed.focusBorderStrength]).toEqual(["#ff8800", 10]);
    const bad = parseSettings(JSON.stringify({ focusBorderColor: "red", focusBorderStrength: "x" }));
    expect([bad.focusBorderColor, bad.focusBorderStrength]).toEqual(["", 55]);
    expect(focusBorderCss("", 55)).toBe("color-mix(in srgb, var(--accent) 55%, var(--bg))");
    expect(focusBorderCss("#ff8800", 100)).toBe("color-mix(in srgb, #ff8800 100%, var(--bg))");
  });
});

describe("file icon packs", () => {
  it("are Material for the plain lists and Seti for DEV mode by default, and keep only a known pack", () => {
    expect([DEFAULT_SETTINGS.fileIconsList, DEFAULT_SETTINGS.fileIconsTree]).toEqual(["material", "seti"]);
    const parsed = parseSettings(JSON.stringify({ fileIconsList: "seti", fileIconsTree: "lines" }));
    expect([parsed.fileIconsList, parsed.fileIconsTree]).toEqual(["seti", "lines"]);
    const bad = parseSettings(JSON.stringify({ fileIconsList: "fancy", fileIconsTree: 3 }));
    expect([bad.fileIconsList, bad.fileIconsTree]).toEqual(["material", "seti"]);
  });
});

describe("diagnostic log settings", () => {
  it("is off by default, in the app's log folder, and keeps only a saved boolean and a trimmed folder", () => {
    expect(DEFAULT_SETTINGS.diagnosticLog).toBe(false);
    expect(DEFAULT_SETTINGS.diagnosticLogDir).toBe("");
    const parsed = parseSettings(JSON.stringify({ diagnosticLog: true, diagnosticLogDir: "  ~/logs  " }));
    expect(parsed.diagnosticLog).toBe(true);
    expect(parsed.diagnosticLogDir).toBe("~/logs");
    const bad = parseSettings(JSON.stringify({ diagnosticLog: "yes", diagnosticLogDir: 7 }));
    expect(bad.diagnosticLog).toBe(false);
    expect(bad.diagnosticLogDir).toBe("");
  });
});

describe("update check setting", () => {
  it("is on by default and keeps only a saved boolean", () => {
    expect(DEFAULT_SETTINGS.checkUpdates).toBe(true);
    expect(parseSettings(JSON.stringify({ checkUpdates: false })).checkUpdates).toBe(false);
    expect(parseSettings(JSON.stringify({ checkUpdates: "no" })).checkUpdates).toBe(true);
  });
});

describe("language setting", () => {
  it("defaults to the system language and keeps only supported values", () => {
    expect(parseSettings(JSON.stringify({ language: "zh-CN" })).language).toBe("zh-CN");
    expect(parseSettings(JSON.stringify({ language: "klingon" })).language).toBe("system");
  });
});

describe("DEV mode commands setting (S10)", () => {
  it("lists the known AI CLIs by default and keeps an edited list, even an empty one", () => {
    expect(parseSettings(null).devCommands).toEqual(["claude", "codex", "agy", "opencode", "pi", "gentle-shell"]);
    expect(parseSettings(JSON.stringify({ devCommands: ["aider", " claude ", "bad name"] })).devCommands).toEqual([
      "aider",
      "claude",
    ]);
    expect(parseSettings(JSON.stringify({ devCommands: [] })).devCommands).toEqual([]);
    expect(parseSettings(JSON.stringify({ devCommands: "claude" })).devCommands).toEqual(DEFAULT_SETTINGS.devCommands);
  });
});

describe("DEV tab column width (S13)", () => {
  it("is the default width until dragged, kept within 140..480 px", () => {
    expect(parseSettings(null).tabColumnWidth).toBeNull();
    expect(parseSettings(JSON.stringify({ tabColumnWidth: 300.4 })).tabColumnWidth).toBe(300);
    expect(parseSettings(JSON.stringify({ tabColumnWidth: 10 })).tabColumnWidth).toBe(140);
    expect(parseSettings(JSON.stringify({ tabColumnWidth: 9999 })).tabColumnWidth).toBe(480);
    expect(parseSettings(JSON.stringify({ tabColumnWidth: "wide" })).tabColumnWidth).toBeNull();
  });
});

describe("interface and chat text sizes", () => {
  it("give the file viewer its own text size, 13 px by default, between 10 and 24", () => {
    expect(DEFAULT_SETTINGS.viewerFontSize).toBe(13);
    expect(parseSettings(JSON.stringify({ viewerFontSize: 99 })).viewerFontSize).toBe(24);
    expect(parseSettings(JSON.stringify({ viewerFontSize: 1 })).viewerFontSize).toBe(10);
    expect(parseSettings(JSON.stringify({ viewerFontSize: 16.4 })).viewerFontSize).toBe(16);
    expect(parseSettings(JSON.stringify({ viewerFontSize: "big" })).viewerFontSize).toBe(13);
  });

  it("default to 13 px and stay within their ranges", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ uiFontSize: 13, chatFontSize: 13 });
    expect(parseSettings(JSON.stringify({ uiFontSize: 99, chatFontSize: 1 }))).toMatchObject({ uiFontSize: 20, chatFontSize: 10 });
    expect(parseSettings(JSON.stringify({ uiFontSize: "big", chatFontSize: 15.6 }))).toMatchObject({ uiFontSize: 13, chatFontSize: 16 });
  });

  it("steps the chat text with Ctrl+= / Ctrl+- / Ctrl+0 within 10..24", () => {
    expect(stepChatFontSize(13, "increase")).toBe(14);
    expect(stepChatFontSize(13, "decrease")).toBe(12);
    expect(stepChatFontSize(24, "increase")).toBe(24);
    expect(stepChatFontSize(10, "decrease")).toBe(10);
    expect(stepChatFontSize(20, "reset")).toBe(13);
  });
});

describe("GPU acceleration on Linux", () => {
  it("is off by default there, as WebGL in WebKitGTK delays every key by several frames", () => {
    expect(parseSettings(null, { linux: true }).gpuAcceleration).toBe(false);
    expect(parseSettings(null, { linux: false }).gpuAcceleration).toBe(true);
    expect(parseSettings(null).gpuAcceleration).toBe(true);
  });

  it("is turned off once in settings saved before this change, and kept when turned on again", () => {
    const old = JSON.stringify({ version: 1, gpuAcceleration: true, fontSize: 16 });
    expect(parseSettings(old, { linux: true })).toMatchObject({ gpuAcceleration: false, fontSize: 16 });
    expect(parseSettings(old, { linux: false }).gpuAcceleration).toBe(true);
    const chosen = serializeSettings({ ...DEFAULT_SETTINGS, gpuAcceleration: true });
    expect(parseSettings(chosen, { linux: true }).gpuAcceleration).toBe(true);
  });
});

describe("terminal font weight", () => {
  it("is 400 by default and only one of the offered weights", () => {
    expect(DEFAULT_SETTINGS.fontWeight).toBe(400);
    expect(parseSettings(JSON.stringify({ fontWeight: 600 })).fontWeight).toBe(600);
    expect(parseSettings(JSON.stringify({ fontWeight: 450 })).fontWeight).toBe(400);
    expect(parseSettings(JSON.stringify({ fontWeight: "bold" })).fontWeight).toBe(400);
    expect(FONT_WEIGHTS).toEqual([300, 400, 500, 600]);
  });
});

describe("terminal line height", () => {
  it("is 1 by default and only one of the offered heights", () => {
    expect(DEFAULT_SETTINGS.lineHeight).toBe(1);
    expect(parseSettings(JSON.stringify({ lineHeight: 1 })).lineHeight).toBe(1);
    expect(parseSettings(JSON.stringify({ lineHeight: 1.3 })).lineHeight).toBe(1.3);
    expect(parseSettings(JSON.stringify({ lineHeight: 1.12 })).lineHeight).toBe(1);
    // A height saved earlier is kept.
    expect(parseSettings(JSON.stringify({ lineHeight: 1.15 })).lineHeight).toBe(1.15);
    expect(parseSettings(JSON.stringify({ lineHeight: "tall" })).lineHeight).toBe(1);
    expect(LINE_HEIGHTS).toEqual([1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3]);
  });
});

describe("sharing settings", () => {
  it("are off the relay until set, ask for View only joins and reset sudo by default", () => {
    const d = parseSettings(null);
    expect([d.shareRelayUrl, d.shareViewerOrigin]).toEqual(["", ""]);
    expect([d.shareViewNeedsApproval, d.shareSudoReset, d.shareBlockLid, d.shareRecordInput]).toEqual([true, true, false, false]);
  });

  it("keep only relay and viewer URLs of their schemes", () => {
    expect(cleanShareUrl(" wss://relay.example.com ", ["wss", "ws"])).toBe("wss://relay.example.com");
    expect(cleanShareUrl("https://relay.example.com", ["wss", "ws"])).toBe("");
    expect(cleanShareUrl("https://view.example.com", ["https", "http"])).toBe("https://view.example.com");
    expect(cleanShareUrl("javascript://x", ["https", "http"])).toBe("");
    expect(cleanShareUrl(42, ["https"])).toBe("");
    const parsed = parseSettings(JSON.stringify({ shareRelayUrl: "http://x", shareViewerOrigin: "https://v.example" }));
    expect([parsed.shareRelayUrl, parsed.shareViewerOrigin]).toEqual(["", "https://v.example"]);
  });
});
