// @vitest-environment jsdom
import { act, cleanup, fireEvent, render as renderUi, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { Channel, invoke } from "@tauri-apps/api/core";
import { AUTO_SAVE_DELAY_MS, SettingsDialog } from "./SettingsDialog";
import packageJson from "../../../package.json";
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS, type TerminalSettings } from "./settings";
import { ShellsContext } from "../platform/useShells";
import { UpdateInstallationProvider } from "../updates/UpdateInstallation";
import type { ReactNode } from "react";
import { EXAMPLE_RULE } from "../terminal/highlightRules";

const render = (ui: ReactNode) => renderUi(<UpdateInstallationProvider>{ui}</UpdateInstallationProvider>);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
// jsdom cannot draw text: the dialog sees one installed font.
vi.mock("./fontCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fontCatalog")>()),
  detectInstalledFonts: () => ["Consolas"],
}));
const opener = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
/** What `update_check` answers (a function so a test can make it fail). */
const updates = vi.hoisted(() => ({
  check: async (): Promise<unknown> => ({ current: "0.1.2", latest: null }),
  install: async (): Promise<unknown> => "installed",
}));
/** The keyring of the AI key commands, by provider. */
const keys = vi.hoisted(() => new Map<string, string>());
/** What `ai_opencode_models` answers (a function so a test can make it fail). */
const go = vi.hoisted(() => {
  const models = async (_refresh: boolean): Promise<unknown> => ({
    models: [
      { id: "gemini-4-argon-contributor", name: "Gemini 4 Argon Contributor", format: "google", supported: false },
      { id: "kimi-k3", name: "Kimi K3", format: "chat", supported: true },
      { id: "minimax-m3", name: "MiniMax-M3", format: "messages", supported: true },
    ],
    note: null,
    fetchedAt: 1,
  });
  return { models, initial: models };
});
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class { onmessage = (_message: unknown) => {}; },
  invoke: vi.fn(async (cmd: string, args?: { provider?: string; key?: string; refresh?: boolean }) => {
    if (cmd === "ai_opencode_models") return go.models(args!.refresh!);
    if (cmd === "ai_key_status") return keys.has(args!.provider!);
    if (cmd === "ai_key_save") keys.set(args!.provider!, args!.key!);
    if (cmd === "ai_key_delete") keys.delete(args!.provider!);
    if (cmd === "usage_key_status") return keys.has(`usage:${args!.provider!}`);
    if (cmd === "usage_key_save") keys.set(`usage:${args!.provider!}`, args!.key!);
    if (cmd === "usage_key_delete") keys.delete(`usage:${args!.provider!}`);
    if (cmd === "history_load") return null;
    if (cmd === "update_check") return updates.check();
    if (cmd === "update_install") return updates.install();
    return null;
  }),
}));

/** The AI key field (the usage key field under Terminal shows the same status texts). */
const aiKey = () => within(screen.getByLabelText("API key").closest(".field") as HTMLElement);

afterEach(() => {
  cleanup();
  keys.clear();
  go.models = go.initial;
  vi.mocked(invoke).mockClear();
});

const setup = () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
};

describe("SettingsDialog", () => {
  it("finds any setting from the search box, in every section, and Escape empties it before closing", () => {
    const { onCancel } = setup();
    /** Shown when neither it nor a section or option around it is left out. */
    const shown = (el: Element) => !el.closest("[hidden], [data-search-hidden]");
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    expect(document.activeElement).toBe(search);
    // An Appearance option, found while General is the open section; accents and case do not matter.
    fireEvent.change(search, { target: { value: "ÍCONS ONLY" } });
    expect(shown(screen.getByLabelText("Show only icons in the toolbar"))).toBe(true);
    expect(shown(screen.getByLabelText("Hide the sidebar completely when folded"))).toBe(false);
    // Found by the help of its (?) tip too.
    fireEvent.change(search, { target: { value: "folds the sidebar" } });
    expect(shown(screen.getByLabelText("Hide the sidebar completely when folded"))).toBe(true);
    fireEvent.change(search, { target: { value: "zzzz-nothing" } });
    expect(screen.getByText("No setting matches “zzzz-nothing”.")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(onCancel).not.toHaveBeenCalled();
    // Back to General, the open section: its options show again, Appearance's are hidden.
    expect(shown(screen.getByLabelText("Check for updates at startup"))).toBe(true);
    expect(shown(screen.getByLabelText("Show only icons in the toolbar"))).toBe(false);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows one section at a time from the side menu, starting with General", () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} />);
    const sections = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(sections).toEqual([
      "General",
      "Appearance",
      "Toolbar",
      "Terminal",
      "DEV mode",
      "Connections",
      "Files",
      "AI",
      "Sharing",
      "Shortcuts",
      "About",
    ]);
    const visible = () => screen.getAllByRole("tabpanel").filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"));
    expect(visible()).toEqual(["General"]);
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(visible()).toEqual(["Files"]);
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the edits of every section when saving", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Terminal font size"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByRole("tab", { name: "Connections" }));
    fireEvent.click(screen.getByLabelText("Remote monitor bar (SSH tabs)"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18, copyOnSelect: false, remoteMonitor: false }));
  });

  it("keeps the dragged sidebar width, which has no field, when saving", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, sidebarWidth: 400 }} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sidebarWidth: 400, copyOnSelect: false }));
  });

  it("turns ZMODEM transfers off and on from Terminal, with help on what they do", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    const box = screen.getByRole("checkbox", { name: /ZMODEM transfers \(rz\/sz\)/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.querySelector("[title], [aria-label]")).toBeTruthy();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ zmodem: false }));
  });

  it("shows the logo, the version and the project in About, light for light schemes", async () => {
    const { unmount } = render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).not.toContain("light");
    expect(await screen.findByText(`Version ${packageJson.version}`)).toBeTruthy();
    expect(screen.getByRole("link", { name: "github.com/jorgealonsodev/PlexusTerm" })).toBeTruthy();
    unmount();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, theme: "solarized-light" }} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).toContain("light");
  });

  it("shows the current settings", () => {
    setup();
    expect((screen.getByLabelText("Terminal font size") as HTMLInputElement).value).toBe("14");
    expect((screen.getByLabelText("Copy on select") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Right click pastes") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Confirm multi-line paste") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Show errors in red") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Colour scheme") as HTMLSelectElement).value).toBe("catppuccin-mocha");
    expect((screen.getByLabelText("Font family") as HTMLInputElement).value).toBe(DEFAULT_SETTINGS.fontFamily);
    expect((screen.getByLabelText("Remote monitor bar (SSH tabs)") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Reconnect SSH sessions automatically") as HTMLInputElement).checked).toBe(true);
    const editor = screen.getByLabelText("Text editor") as HTMLInputElement;
    expect(editor.value).toBe("");
    expect(editor.placeholder).toBe("System default");
  });

  it("chooses the text editor with Browse…, resets it to the system default and saves it", async () => {
    vi.mocked(open).mockResolvedValueOnce("/opt/My Editor/editor").mockResolvedValueOnce(null);
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("/opt/My Editor/editor"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false, defaultPath: "/usr/bin" }));
    // Cancelling the file picker keeps the program.
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("/opt/My Editor/editor");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "/opt/My Editor/editor" });

    fireEvent.click(screen.getByRole("button", { name: "Use system default" }));
    expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Text editor"), { target: { value: "  code --wait " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "code --wait" });
  });

  it("lists dark and light schemes separately and previews the selected one", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    const groups = [...screen.getByLabelText("Colour scheme").querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Dark", "Light"]);
    expect(screen.getByRole("option", { name: "Catppuccin Latte" }).parentElement?.getAttribute("label")).toBe("Light");
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "nord" } });
    const preview = screen.getByLabelText("Preview of Nord");
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("picks the font from the catalogue: default, bundled, installed, or typed by hand", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    const font = screen.getByLabelText("Font") as HTMLSelectElement;
    const family = screen.getByLabelText("Font family") as HTMLInputElement;
    expect(font.value).toBe(DEFAULT_FONT_FAMILY);
    expect(screen.getByRole("group", { name: "Included with PlexusTerm" }).textContent).toBe(
      "JetBrains MonoFira CodeCascadia CodeSource Code ProHack",
    );
    expect(screen.getByRole("group", { name: "Installed on this computer" }).textContent).toBe("Consolas");
    fireEvent.change(font, { target: { value: '"Fira Code Variable", monospace' } });
    expect(family.value).toBe('"Fira Code Variable", monospace');
    fireEvent.change(font, { target: { value: "Consolas" } });
    expect(family.value).toBe("Consolas");
    fireEvent.change(family, { target: { value: "Hack Nerd Font" } });
    expect(font.value).toBe("");
    fireEvent.change(font, { target: { value: '"Cascadia Code Variable", monospace' } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, fontFamily: '"Cascadia Code Variable", monospace' });
  });

  it("saves the edited settings, clamping the font size", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Terminal font size"), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByLabelText("Right click pastes"));
    fireEvent.click(screen.getByLabelText("Confirm multi-line paste"));
    fireEvent.click(screen.getByLabelText("Show errors in red"));
    fireEvent.click(screen.getByLabelText("Shift+Enter starts a new line"));
    fireEvent.click(screen.getByLabelText("Desktop notifications when a terminal needs attention"));
    fireEvent.click(screen.getByLabelText("GPU acceleration"));
    expect(screen.queryByLabelText("Show the git branch under the terminal")).toBeNull();
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "solarized-light" } });
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: " Hack Nerd Font " } });
    fireEvent.click(screen.getByLabelText("Remote monitor bar (SSH tabs)"));
    fireEvent.click(screen.getByLabelText("Reconnect SSH sessions automatically"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      fontSize: 32,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      errorHighlight: false,
      shiftEnterNewline: false,
      attentionNotifications: false,
      gpuAcceleration: false,
      theme: "solarized-light",
      fontFamily: "Hack Nerd Font",
      remoteMonitor: false,
      sshAutoReconnect: false,
      textEditor: "",
    });
  });

  it("edits the commands that turn DEV mode on (S10)", () => {
    const { onSave } = setup();
    const field = screen.getByLabelText("Commands that turn DEV mode on") as HTMLInputElement;
    expect(field.value).toBe("claude, codex, agy, opencode, pi, gentle-shell");
    fireEvent.change(field, { target: { value: "claude  aider, codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, devCommands: ["claude", "aider", "codex"] });
  });

  it("groups every option with the ones it belongs with, so searching a group's name shows all of them", () => {
    setup();
    const shown = (el: Element) => !el.closest("[hidden], [data-search-hidden]");
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    const groupShows = (group: string, inside: string[], outside: string[]) => {
      fireEvent.change(search, { target: { value: group } });
      for (const label of inside) expect(shown(screen.getByLabelText(label)), `${label} in ${group}`).toBe(true);
      for (const label of outside) expect(shown(screen.getByLabelText(label)), `${label} not in ${group}`).toBe(false);
    };
    // The AI options after the plan usage key used to fall under its heading.
    groupShows("Command suggestions", ["AI suggestions", "History commands sent as context"], ["Keep AI conversations after closing PlexusTerm"]);
    groupShows("Chat", ["Keep AI conversations after closing PlexusTerm"], ["History commands sent as context"]);
    groupShows("Notifications", [
      "Desktop notifications when a terminal needs attention",
      "Notify when a command takes longer than (seconds)",
    ], ["Show size and date in file lists"]);
    groupShows("Commands and folders", ["In DEV mode, the + opens in"], ["Hide the sidebar completely when folded"]);
    groupShows("Window and panes", ["Hide the sidebar completely when folded", "Show only icons in the toolbar"], ["In DEV mode, the + opens in"]);
    groupShows("Viewer and editor", ["Open the file viewer"], ["Show size and date in file lists"]);
  });

  it("edits the highlight rules in Terminal: add, explain an invalid expression, remove, and drop empty ones", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    // The example rule is there to start with.
    expect((screen.getByLabelText("Regular expression of rule 1") as HTMLInputElement).value).toBe(EXAMPLE_RULE.pattern);
    const add = () => fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    add();
    add();
    add();
    fireEvent.change(screen.getByLabelText("Regular expression of rule 2"), { target: { value: "ERROR|FATAL" } });
    fireEvent.change(screen.getByLabelText("Colour of rule 2"), { target: { value: "#ff8800" } });
    fireEvent.click(within(screen.getByLabelText("Regular expression of rule 2").closest(".rules__row") as HTMLElement).getByLabelText("Notify"));
    fireEvent.change(screen.getByLabelText("Regular expression of rule 3"), { target: { value: "(unclosed" } });
    expect(screen.getByRole("alert").textContent).toMatch(/^This expression cannot be used: /);
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 3" }));
    expect(screen.queryByRole("alert")).toBeNull();
    // Rule 4 (now 3) has no expression: it is dropped on save.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        highlightRules: [EXAMPLE_RULE, { pattern: "ERROR|FATAL", color: "#ff8800", matchCase: false, notify: true }],
      }),
    );
  });

  it("gives a highlight rule an action: send text or play a saved macro, and none again (S3)", () => {
    const onSave = vi.fn();
    const macros = [
      { id: "m1", name: "Deploy", steps: [] },
      { id: "m2", name: "Logs", steps: [] },
    ];
    const settings = {
      ...DEFAULT_SETTINGS,
      highlightRules: [EXAMPLE_RULE, { ...EXAMPLE_RULE, pattern: "deploy done" }, { ...EXAMPLE_RULE, pattern: "gone", action: { kind: "macro" as const, macroId: "old" } }],
    };
    render(<SettingsDialog settings={settings} onSave={onSave} onCancel={() => {}} initialSection="terminal" macros={macros} />);
    // Sent text is typed as if by you: the help says so.
    expect(screen.getAllByRole("button", { name: /typed into that terminal as if you typed it/ }).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Action of rule 1"), { target: { value: "send" } });
    fireEvent.change(screen.getByLabelText("Text rule 1 sends"), { target: { value: "y\\n" } });
    fireEvent.change(screen.getByLabelText("Action of rule 2"), { target: { value: "macro" } });
    // Play macro starts with the first saved macro; another can be picked.
    fireEvent.change(screen.getByLabelText("Macro rule 2 plays"), { target: { value: "m2" } });
    // A deleted macro is still shown as such until another is picked, and None removes the action.
    expect((screen.getByLabelText("Macro rule 3 plays") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Deleted macro");
    fireEvent.change(screen.getByLabelText("Action of rule 3"), { target: { value: "none" } });
    expect(screen.queryByLabelText("Macro rule 3 plays")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    const saved = onSave.mock.lastCall![0].highlightRules;
    expect(saved).toStrictEqual([
      { ...EXAMPLE_RULE, action: { kind: "send", text: "y\\n" } },
      { ...EXAMPLE_RULE, pattern: "deploy done", action: { kind: "macro", macroId: "m2" } },
      { ...EXAMPLE_RULE, pattern: "gone" },
    ]);
  });

  it("sets the settings' own synced folder in Connections and tells how the last sync went", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={() => {}} initialSection="ssh" />);
    const field = screen.getByLabelText(/^Settings synced folder/) as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "  /home/me/Settings  " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ settingsSyncFolder: "/home/me/Settings", syncFolder: "" }));
    cleanup();
    const synced = { ...DEFAULT_SETTINGS, settingsSyncFolder: "/home/me/Settings" };
    render(
      <SettingsDialog
        settings={synced}
        onSave={onSave}
        onCancel={() => {}}
        initialSection="ssh"
        settingsSyncStatus={{ state: "error", message: "x", foreign: true }}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/not a PlexusTerm settings file/);
  });

  it("sets the sessions' synced folder in Connections and tells how the last sync went", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={() => {}} initialSection="ssh" />);
    const field = screen.getByLabelText(/^Synced folder/) as HTMLInputElement;
    expect(field.value).toBe("");
    fireEvent.change(field, { target: { value: "  /home/me/Sync  " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ syncFolder: "/home/me/Sync" }));
    cleanup();
    const synced = { ...DEFAULT_SETTINGS, syncFolder: "/home/me/Sync" };
    render(<SettingsDialog settings={synced} onSave={onSave} onCancel={() => {}} initialSection="ssh" syncStatus={{ state: "error", message: "x", foreign: true }} />);
    expect(screen.getByRole("status").textContent).toMatch(/not a PlexusTerm sessions file/);
  });

  it("keeps an OpenCode Go key for the usage apart from the AI one, and hides it with the usage", async () => {
    const { onSave } = setup();
    // With the rest of the bar under the terminal, in DEV mode.
    fireEvent.click(screen.getByRole("tab", { name: "DEV mode" }));
    const usageKey = () => screen.getByLabelText("OpenCode Go API key for the usage") as HTMLInputElement;
    const usageField = () => within(usageKey().closest(".field") as HTMLElement);
    expect(await usageField().findByText("No key saved")).toBeTruthy();
    expect(usageField().getByText(/without it, the usage is read with the OpenCode Go key in Settings > AI/)).toBeTruthy();
    fireEvent.change(usageKey(), { target: { value: "oc-usage" } });
    fireEvent.click(usageField().getByRole("button", { name: "Save key" }));
    expect(await usageField().findByText("A key is saved")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("usage_key_save", { provider: "opencode-go", key: "oc-usage" });
    expect(invoke).not.toHaveBeenCalledWith("ai_key_save", expect.anything());
    expect(keys.has("opencode-go")).toBe(false);
    fireEvent.click(usageField().getByRole("button", { name: "Remove key" }));
    expect(await usageField().findByText("No key saved")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("usage_key_delete", { provider: "opencode-go" });
    fireEvent.click(screen.getByLabelText("Show AI plan usage in the bar under each terminal"));
    expect(screen.queryByLabelText("OpenCode Go API key for the usage")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aiUsageInFooter: false }));
  });

  it("sets the height of the bar under the terminals in Appearance, within 18-48 px", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    const field = screen.getByLabelText(/Height of the bar under the terminals \(px\)/) as HTMLInputElement;
    expect([field.type, field.value, field.min, field.max]).toEqual(["number", "22", "18", "48"]);
    fireEvent.change(field, { target: { value: "34" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ paneFooterHeight: 34 }));
    fireEvent.change(field, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ paneFooterHeight: 48 }));
  });


  it("restores the default font when the font family is left empty", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, fontFamily: "Hack" }} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("keeps the font size when the field is not a number", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Terminal font size"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    // Nothing changed: the saved size stays.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes with Close or Escape, saving nothing when nothing changed", () => {
    const { onSave, onCancel } = setup();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByLabelText("Terminal font size"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("applies a change by itself a moment after it, without a Save button", () => {
    vi.useFakeTimers();
    try {
      const { onSave, onCancel } = setup();
      fireEvent.click(screen.getByLabelText("Copy on select"));
      expect(onSave).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS));
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, copyOnSelect: false });
      // Typing a number: applied once, after the last key.
      const size = screen.getByLabelText("Terminal font size");
      fireEvent.change(size, { target: { value: "1" } });
      act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS / 2));
      fireEvent.change(size, { target: { value: "16" } });
      act(() => vi.advanceTimersByTime(AUTO_SAVE_DELAY_MS));
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 16, copyOnSelect: false }));
      // Closing right after an edit applies it at once.
      fireEvent.click(screen.getByLabelText("Copy on select"));
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledTimes(3);
      expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnSelect: true }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("AI section (S4)", () => {
    const openAi = () => {
      const result = setup();
      fireEvent.click(screen.getByRole("tab", { name: "AI" }));
      return result;
    };
    const field = <T extends HTMLElement = HTMLInputElement>(label: string) => screen.getByLabelText(label) as unknown as T;

    it("shows the defaults: suggestions and history on, AI off, Anthropic with its model", async () => {
      openAi();
      expect(field("Inline suggestions").checked).toBe(true);
      expect(field("Command history").checked).toBe(true);
      expect(field("AI suggestions").checked).toBe(false);
      expect(field<HTMLSelectElement>("Provider").value).toBe("anthropic");
      expect([...field<HTMLSelectElement>("Provider").options].map((o) => o.text)).toEqual([
        "Anthropic",
        "Gemini",
        "OpenAI",
        "OpenAI-compatible",
        "OpenCode Go",
      ]);
      expect(field("Model").value).toBe("claude-opus-5-5");
      expect(field("History commands sent as context").value).toBe("5");
      expect(screen.queryByLabelText("Base URL")).toBeNull();
      expect(await aiKey().findByText("No key saved")).toBeTruthy();
    });

    it("saves the AI settings, clamping the history context", () => {
      const { onSave } = openAi();
      fireEvent.click(field("Inline suggestions"));
      fireEvent.click(field("Command history"));
      fireEvent.click(field("AI suggestions"));
      fireEvent.change(field("Provider"), { target: { value: "openai-compatible" } });
      fireEvent.change(field("Base URL"), { target: { value: " http://localhost:11434/v1 " } });
      fireEvent.change(field("Model"), { target: { value: " llama3.1 " } });
      fireEvent.change(field("History commands sent as context"), { target: { value: "40" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        inlineSuggestions: false,
        commandHistory: false,
        aiSuggestions: true,
        aiProvider: "openai-compatible",
        aiBaseUrl: "http://localhost:11434/v1",
        aiModel: "llama3.1",
        aiHistoryContext: 20,
      });
    });

    it("switches a provider's default model to the new provider's default, but keeps a custom one", () => {
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "gemini" } });
      expect(field("Model").value).toBe("gemini-3.5-flash-lite");
      fireEvent.change(field("Provider"), { target: { value: "openai" } });
      expect(field("Model").value).toBe("");
      fireEvent.change(field("Provider"), { target: { value: "anthropic" } });
      expect(field("Model").value).toBe("claude-opus-5-5");
      fireEvent.change(field("Model"), { target: { value: "claude-haiku-4-5" } });
      fireEvent.change(field("Provider"), { target: { value: "gemini" } });
      expect(field("Model").value).toBe("claude-haiku-4-5");
    });

    it("saves and removes the provider's API key in the keyring, showing only whether one is saved", async () => {
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "gemini" } });
      expect(await aiKey().findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "AIza-secret" } });
      fireEvent.click(aiKey().getByRole("button", { name: "Save key" }));
      expect(await aiKey().findByText("A key is saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_save", { provider: "gemini", key: "AIza-secret" });
      expect(field("API key").value).toBe("");
      expect(screen.queryByDisplayValue("AIza-secret")).toBeNull();
      fireEvent.click(aiKey().getByRole("button", { name: "Remove key" }));
      expect(await aiKey().findByText("No key saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_delete", { provider: "gemini" });
      // Another provider has its own key.
      keys.set("anthropic", "sk-ant");
      fireEvent.change(field("Provider"), { target: { value: "anthropic" } });
      expect(await aiKey().findByText("A key is saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_status", { provider: "anthropic" });
    });

    it("shows the backend's message when the key cannot be saved", async () => {
      const backend = vi.mocked(invoke).getMockImplementation()!;
      // Tauri rejects with the serialized AiError: a plain object, not an Error.
      vi.mocked(invoke).mockImplementation(async (cmd, args) => {
        if (cmd === "ai_key_save") {
          throw { kind: "config", message: "Could not use the system keyring: the system keyring is not available." };
        }
        return backend(cmd, args);
      });
      onTestFinished(() => {
        vi.mocked(invoke).mockImplementation(backend);
      });
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "gemini" } });
      expect(await aiKey().findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "AIza-secret" } });
      fireEvent.click(aiKey().getByRole("button", { name: "Save key" }));
      expect(
        await screen.findByText(
          "Could not save the key: Could not use the system keyring: the system keyring is not available.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/\[object Object\]/)).toBeNull();
      expect(aiKey().getByText("No key saved")).toBeTruthy();
    });

    it("offers OpenCode Go models in a list fetched by the backend, with a refresh and a usage note", async () => {
      const { onSave } = openAi();
      expect(screen.queryByText(/OpenCode Go is meant for coding agents/)).toBeNull();
      fireEvent.change(field("Provider"), { target: { value: "opencode-go" } });
      expect(
        screen.getByText(
          "OpenCode Go is meant for coding agents and monitors traffic; inline AI suggestions send many short requests.",
        ),
      ).toBeTruthy();
      expect(screen.queryByLabelText("Base URL")).toBeNull();
      await screen.findByRole("option", { name: "Kimi K3 (kimi-k3)" });
      expect(invoke).toHaveBeenCalledWith("ai_opencode_models", { refresh: false });
      const model = field<HTMLSelectElement>("Model");
      expect(model.tagName).toBe("SELECT");
      expect(model.value).toBe("");
      const options = [...model.options].map((o) => [o.text, o.value, o.disabled]);
      expect(options).toEqual([
        ["Choose a model", "", true],
        ["Gemini 4 Argon Contributor (gemini-4-argon-contributor) — not supported yet", "gemini-4-argon-contributor", true],
        ["Kimi K3 (kimi-k3)", "kimi-k3", false],
        ["MiniMax-M3 (minimax-m3)", "minimax-m3", false],
      ]);
      fireEvent.change(model, { target: { value: "minimax-m3" } });
      fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
      await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai_opencode_models", { refresh: true }));
      expect(field<HTMLSelectElement>("Model").value).toBe("minimax-m3");
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aiProvider: "opencode-go", aiModel: "minimax-m3", aiBaseUrl: "" }));
    });

    it("keeps a saved OpenCode Go model that is not in the list, and shows the list's note", async () => {
      go.models = async () => ({ models: [{ id: "kimi-k3", name: "Kimi K3", format: "chat", supported: true }], note: "Saved list.", fetchedAt: 1 });
      render(
        <SettingsDialog
          settings={{ ...DEFAULT_SETTINGS, aiProvider: "opencode-go", aiModel: "retired-model" }}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          initialSection="ai"
        />,
      );
      await screen.findByRole("option", { name: "Kimi K3 (kimi-k3)" });
      const model = field<HTMLSelectElement>("Model");
      expect(model.value).toBe("retired-model");
      expect([...model.options].map((o) => o.value)).toContain("retired-model");
      expect(screen.getByText("Saved list.")).toBeTruthy();
    });

    it("falls back to typing the OpenCode Go model when the list cannot be fetched", async () => {
      go.models = async () => Promise.reject({ kind: "network", message: "Could not fetch the OpenCode Go model list." });
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "opencode-go" } });
      expect(await screen.findByText(/Could not fetch the OpenCode Go model list\./)).toBeTruthy();
      expect(screen.getByText(/https:\/\/opencode\.ai\/inference\/go\/v1\/models/)).toBeTruthy();
      const model = field("Model");
      expect(model.tagName).toBe("INPUT");
      fireEvent.change(model, { target: { value: "kimi-k3" } });
      expect(field("Model").value).toBe("kimi-k3");
    });

    it("hides file sizes and dates by default and saves the choice (L15)", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const details = field("Show size and date in file lists");
      expect(details.checked).toBe(false);
      fireEvent.click(details);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fileDetails: true }));
    });

    it("chooses how often the Explorer's list is read again, every 3 seconds by default, and saves it", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const every = screen.getByLabelText(/Refresh the Explorer's list every/) as HTMLSelectElement;
      expect(every.value).toBe("3");
      expect([...every.options].map((o) => o.value)).toEqual(["1", "2", "3", "5", "10", "30"]);
      fireEvent.change(every, { target: { value: "10" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fileListRefreshSeconds: 10 }));
    });

    it("chooses the terminal line height, 1.0 by default, warns what a taller one does, and saves it", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
      const height = screen.getByLabelText("Terminal line height") as HTMLSelectElement;
      expect(height.value).toBe("1");
      expect([...height.options].map((o) => o.textContent)).toEqual(["1.0", "1.05", "1.1", "1.15", "1.2", "1.25", "1.3"]);
      expect(screen.getByRole("button", { name: /above 1\.0 can look blurred with GPU acceleration/ })).toBeTruthy();
      fireEvent.change(height, { target: { value: "1.2" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lineHeight: 1.2 }));
    });

    it("chooses the cursor's shape and blinking, a blinking bar by default, explains them, and saves them", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
      const shape = screen.getByLabelText(/^Cursor shape/) as HTMLSelectElement;
      expect(shape.value).toBe("bar");
      expect([...shape.options].map((o) => [o.value, o.textContent])).toEqual([
        ["bar", "Bar"],
        ["block", "Block"],
        ["underline", "Underline"],
      ]);
      const blink = screen.getByLabelText(/^Blinking cursor/) as HTMLInputElement;
      expect(blink.checked).toBe(true);
      expect(shape.closest(".field")!.querySelector(".help-tip")).not.toBeNull();
      expect(blink.closest(".check")!.querySelector(".help-tip")).not.toBeNull();
      fireEvent.change(shape, { target: { value: "block" } });
      fireEvent.click(blink);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ cursorShape: "block", cursorBlink: false }));
    });

    it("chooses the weight of the terminal font, regular by default, and saves it", () => {
      const { onSave } = setup();
      const weight = screen.getByLabelText("Terminal font weight") as HTMLSelectElement;
      expect(weight.value).toBe("400");
      expect([...weight.options].map((o) => o.textContent)).toEqual(["Light", "Regular", "Medium", "Semibold"]);
      fireEvent.change(weight, { target: { value: "300" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontWeight: 300 }));
    });

    it("shows git status in file lists by default and saves the choice", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const git = field("Show git status in file lists");
      expect(git.checked).toBe(true);
      fireEvent.click(git);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gitFileStatus: false }));
    });

    it("leaves auto-save of edited files off by default and saves the choice", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const auto = field("Save edited files automatically");
      expect(auto.checked).toBe(false);
      fireEvent.click(auto);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ viewerAutoSave: true }));
    });

    it("opens the file viewer at the left by default and saves another side", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const side = screen.getByRole("combobox", { name: "Open the file viewer" }) as HTMLSelectElement;
      expect(side.value).toBe("left");
      fireEvent.change(side, { target: { value: "below" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ viewerPosition: "below" }));
    });

    it("chooses how the sidebar opens at startup (L17)", () => {
      const { onSave } = setup();
      const select = screen.getByLabelText("Sidebar when PlexusTerm opens") as HTMLSelectElement;
      expect(select.value).toBe("last");
      expect([...select.options].map((o) => o.textContent)).toEqual(["As I left it", "Open", "Folded"]);
      fireEvent.change(select, { target: { value: "collapsed" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sidebarAtStartup: "collapsed" }));
    });

    it("chooses how DEV mode's tab column folds and how it opens at startup", () => {
      const { onSave } = setup();
      const hide = screen.getByLabelText("Hide the DEV tab column completely when folded") as HTMLInputElement;
      expect(hide.checked).toBe(false);
      fireEvent.click(hide);
      const select = screen.getByLabelText("DEV tab column when PlexusTerm opens") as HTMLSelectElement;
      expect(select.value).toBe("last");
      expect([...select.options].map((o) => o.textContent)).toEqual(["As I left it", "Open", "Folded"]);
      fireEvent.change(select, { target: { value: "expanded" } });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ devColumnHideWhenCollapsed: true, devColumnAtStartup: "expanded", devColumnCollapsed: false }),
      );
    });

    it("chooses how many recent DEV mode folders to keep, and whether the bar under a DEV terminal names its folder", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
      const limit = screen.getByLabelText("Recent DEV mode folders to remember") as HTMLInputElement;
      expect(limit.value).toBe("10");
      fireEvent.change(limit, { target: { value: "99" } });
      const folder = screen.getByLabelText("Show the terminal's folder in the bar under it in DEV mode") as HTMLInputElement;
      expect(folder.checked).toBe(true);
      fireEvent.click(folder);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recentFolderLimit: 50, devFolderInFooter: false }));
    });

    it("changes the terminal's folder with the file browser by default, and saves the choice (L16)", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const follows = field("Change the terminal's folder when you open a folder in the file browser");
      expect(follows.checked).toBe(true);
      fireEvent.click(follows);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ terminalFollowsBrowser: false }));
    });

    it("keeps AI conversations by default and saves the choice (S9)", () => {
      const { onSave } = openAi();
      const keep = field("Keep AI conversations after closing PlexusTerm");
      expect(keep.checked).toBe(true);
      fireEvent.click(keep);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aiSaveChats: false }));
    });

    it("saves the OpenCode Go key under its own provider", async () => {
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "opencode-go" } });
      expect(await aiKey().findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "oc-secret" } });
      fireEvent.click(aiKey().getByRole("button", { name: "Save key" }));
      expect(await aiKey().findByText("A key is saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_save", { provider: "opencode-go", key: "oc-secret" });
      expect(invoke).toHaveBeenCalledWith("ai_key_status", { provider: "opencode-go" });
    });

    it("clears the command history at once", async () => {
      openAi();
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      expect(await screen.findByText("History cleared.")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("history_save", { contents: '{"version":1,"hosts":{}}' });
    });

    it("no longer edits the assistant shortcut, which moved to Shortcuts", () => {
      openAi();
      expect(within(screen.getByRole("tabpanel", { name: "AI" })).queryByLabelText("AI assistant")).toBeNull();
    });
  });
});

describe("Shortcuts section", () => {
  const openShortcuts = (settings: TerminalSettings = DEFAULT_SETTINGS) => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<SettingsDialog settings={settings} onSave={onSave} onCancel={onCancel} initialSection="shortcuts" />);
    return { onSave, onCancel };
  };
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const press = (input: HTMLElement, init: Record<string, unknown>) => {
    fireEvent.focus(input);
    fireEvent.keyDown(input, init);
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));

  it("lists the actions by group, with the fixed keys for reference", () => {
    openShortcuts();
    for (const group of ["Tabs and panes", "Connections", "Terminal", "Font size", "Sidebar and macros", "Tools", "AI assistant", "Fixed keys"]) {
      expect(screen.getByRole("heading", { name: group })).toBeTruthy();
    }
    expect(field("New terminal").value).toBe("Ctrl+Shift+T");
    expect(field("Bigger font").value).toBe("Ctrl+=");
    expect(field("Next tab").value).toBe("");
    expect(field("Next tab").placeholder).toBe("Not set");
    expect(screen.getByText("Ctrl+Alt+1–9")).toBeTruthy();
    expect(screen.getByText("Play the macro bound to that key")).toBeTruthy();
  });

  it("captures a new combination; Escape cancels without closing; saving emits the overrides", () => {
    const { onSave, onCancel } = openShortcuts();
    const input = field("New terminal");
    press(input, { key: "Control", ctrlKey: true });
    press(input, { key: "n", ctrlKey: true, altKey: true });
    expect(input.value).toBe("Ctrl+Alt+N");
    press(input, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(input.value).toBe("Ctrl+Alt+N");
    press(field("Next tab"), { key: "PageDown", ctrlKey: true });
    save();
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, shortcuts: { newTerminal: "Ctrl+Alt+N", nextTab: "Ctrl+PageDown" } });
  });

  it("refuses the combination the drop-down window uses, for an action and for the assistant", () => {
    openShortcuts({ ...DEFAULT_SETTINGS, dropDownShortcut: "Ctrl+Alt+F12" });
    press(field("Close tab"), { key: "F12", ctrlKey: true, altKey: true });
    expect(screen.getByText("Ctrl+Alt+F12 is already used by “Drop-down window”.")).toBeTruthy();
    expect(field("Close tab").value).toBe("");
  });

  it("refuses a combination another action, a fixed key or the assistant uses, naming it", () => {
    openShortcuts();
    const input = field("Close tab");
    press(input, { key: "T", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Ctrl+Shift+T is already used by “New terminal”.")).toBeTruthy();
    press(input, { key: "2", ctrlKey: true, altKey: true });
    expect(screen.getByText("Ctrl+Alt+2 is already used by “Play the macro bound to that key”.")).toBeTruthy();
    press(input, { key: " ", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Ctrl+Shift+Space is already used by “AI assistant”.")).toBeTruthy();
    press(input, { key: "a" });
    expect(screen.getByText("Use Ctrl, Alt or Meta with a key.")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("binds a shortcut to fold DEV mode's tab column, which has none by default", () => {
    const { onSave } = openShortcuts();
    const input = field("Toggle DEV tab column");
    expect(input.value).toBe("");
    press(input, { key: "b", ctrlKey: true, altKey: true });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcuts: { toggleDevColumn: "Ctrl+Alt+B" } }));
  });

  it("binds a shortcut to list the recent DEV mode folders, which has none by default", () => {
    const { onSave } = openShortcuts();
    const input = field("Open recent (DEV mode)");
    expect(input.value).toBe("");
    press(input, { key: "r", ctrlKey: true, altKey: true });
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcuts: { recentFolders: "Ctrl+Alt+R" } }));
  });

  it("lets a freed default be taken by another action", () => {
    const { onSave } = openShortcuts();
    press(field("New terminal"), { key: "n", ctrlKey: true, altKey: true });
    press(field("Close tab"), { key: "T", ctrlKey: true, shiftKey: true });
    expect(field("Close tab").value).toBe("Ctrl+Shift+T");
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcuts: { newTerminal: "Ctrl+Alt+N", closeTab: "Ctrl+Shift+T" } }));
  });

  it("clears a shortcut, and resets one row to its default", () => {
    const { onSave } = openShortcuts({ ...DEFAULT_SETTINGS, shortcuts: { splitRight: "Alt+R" } });
    expect(field("Split right").value).toBe("Alt+R");
    fireEvent.click(screen.getByRole("button", { name: "Reset “Split right” to its default" }));
    expect(field("Split right").value).toBe("Ctrl+Shift+D");
    fireEvent.click(screen.getByRole("button", { name: "Remove the shortcut of “Toggle sidebar”" }));
    expect(field("Toggle sidebar").value).toBe("");
    save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shortcuts: { toggleSidebar: "" } }));
  });

  it("refuses a reset whose default another action took meanwhile", () => {
    openShortcuts({ ...DEFAULT_SETTINGS, shortcuts: { newTerminal: "Alt+N", closeTab: "Ctrl+Shift+T" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset “New terminal” to its default" }));
    expect(screen.getByText("Ctrl+Shift+T is already used by “Close tab”.")).toBeTruthy();
    expect(field("New terminal").value).toBe("Alt+N");
  });

  it("restores every default, the assistant's too", () => {
    const { onSave } = openShortcuts({ ...DEFAULT_SETTINGS, assistantShortcut: "Ctrl+Alt+K", shortcuts: { keyGen: "Alt+K", find: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(field("SSH key generator").value).toBe("");
    expect(field("Find").value).toBe("Ctrl+Shift+F");
    expect(field("AI assistant").value).toBe("Ctrl+Shift+Space");
    save();
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("captures the assistant shortcut, refusing app shortcuts", () => {
    const { onSave } = openShortcuts();
    const input = field("AI assistant");
    press(input, { key: "T", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Ctrl+Shift+T is already used by “New terminal”.")).toBeTruthy();
    press(input, { key: "j", ctrlKey: true, altKey: true });
    expect(input.value).toBe("Ctrl+Alt+J");
    save();
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, assistantShortcut: "Ctrl+Alt+J" });
  });
});

describe("Shell for local terminals", () => {
  const SHELLS = {
    default: { name: "bash", program: "/bin/bash" },
    available: [
      { name: "bash", program: "/bin/bash" },
      { name: "fish", program: "/usr/bin/fish" },
    ],
  };
  const renderWith = (patch: Partial<TerminalSettings> = {}, shells: typeof SHELLS | null = SHELLS) => {
    const onSave = vi.fn();
    render(
      <ShellsContext.Provider value={shells}>
        <SettingsDialog settings={{ ...DEFAULT_SETTINGS, ...patch }} onSave={onSave} onCancel={vi.fn()} initialSection="terminal" />
      </ShellsContext.Provider>,
    );
    return onSave;
  };
  const shellSelect = () => screen.getByLabelText("Shell for local terminals") as HTMLSelectElement;
  const optionValue = (text: string) => Array.from(shellSelect().options).find((o) => o.textContent === text)!.value;
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));

  it("lists the system default and the detected shells, and saves the chosen one with its arguments", () => {
    const onSave = renderWith();
    expect(Array.from(shellSelect().options).map((o) => o.textContent)).toEqual([
      "System default (bash)",
      "bash — /bin/bash",
      "fish — /usr/bin/fish",
      "Other…",
    ]);
    expect(shellSelect().value).toBe("");
    expect(screen.queryByLabelText("Arguments")).toBeNull();
    fireEvent.change(shellSelect(), { target: { value: "/usr/bin/fish" } });
    expect(screen.queryByLabelText("Program")).toBeNull();
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: " --login " } });
    save();
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, localShell: "/usr/bin/fish", localShellArgs: "--login" });
  });

  it("Other… takes any program, typed or chosen with Browse…", async () => {
    vi.mocked(open).mockResolvedValueOnce("/opt/nu/bin/nu");
    const onSave = renderWith();
    fireEvent.change(shellSelect(), { target: { value: optionValue("Other…") } });
    expect((screen.getByLabelText("Program") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect((screen.getByLabelText("Program") as HTMLInputElement).value).toBe("/opt/nu/bin/nu"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: "-l" } });
    save();
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, localShell: "/opt/nu/bin/nu", localShellArgs: "-l" });
  });

  it("shows a saved shell that was not detected under Other…", () => {
    renderWith({ localShell: "/opt/nu/bin/nu", localShellArgs: "-l" });
    expect(shellSelect().value).toBe(optionValue("Other…"));
    expect((screen.getByLabelText("Program") as HTMLInputElement).value).toBe("/opt/nu/bin/nu");
    expect((screen.getByLabelText("Arguments") as HTMLInputElement).value).toBe("-l");
  });

  it("going back to the system default forgets the program and its arguments", () => {
    const onSave = renderWith({ localShell: "/usr/bin/fish", localShellArgs: "--login" });
    expect(shellSelect().value).toBe("/usr/bin/fish");
    fireEvent.change(shellSelect(), { target: { value: "" } });
    save();
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("saves the starting folder of local terminals, typed or chosen (S8)", async () => {
    vi.mocked(open).mockResolvedValueOnce("/home/me/work");
    const onSave = renderWith();
    const folder = screen.getByLabelText("Starting folder for local terminals") as HTMLInputElement;
    expect(folder.value).toBe("");
    expect(folder.placeholder).toBe("Home directory");
    fireEvent.click(screen.getByRole("button", { name: "Choose the starting directory" }));
    await waitFor(() => expect(folder.value).toBe("/home/me/work"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    save();
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, localCwd: "/home/me/work" });
  });

  it("offers the system default and Other… before the shells are known", () => {
    renderWith({}, null);
    expect(Array.from(shellSelect().options).map((o) => o.textContent)).toEqual(["System default", "Other…"]);
  });
});

describe("Updates in About", () => {
  const renderAbout = (patch: Partial<TerminalSettings> = {}) => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, ...patch }} onSave={onSave} onCancel={vi.fn()} initialSection="about" />);
    return onSave;
  };
  const checkNow = () => fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

  it("says when PlexusTerm is up to date", async () => {
    renderAbout();
    checkNow();
    expect(screen.getByRole("status").textContent).toBe("Checking for updates…");
    expect(await screen.findByText("PlexusTerm is up to date (0.1.2).")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("offers installation with only a channel and an independent release-page action", async () => {
    updates.check = async () => ({
      current: "0.1.2",
      latest: { version: "0.2.0", notes: "Fixes.", url: "https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0" },
    });
    onTestFinished(() => {
      updates.check = async () => ({ current: "0.1.2", latest: null });
      opener.openUrl.mockClear();
    });
    renderAbout();
    checkNow();
    expect(await screen.findByText("PlexusTerm 0.2.0 is available.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText("Update installed. Restart PlexusTerm manually when ready.")).toBeTruthy();
    const installs = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "update_install");
    expect(installs).toEqual([["update_install", { onProgress: expect.any(Channel) }]]);
  });

  it("keeps manual checks independent of startup settings and shows busy progress, errors and retry", async () => {
    updates.check = async () => ({
      current: "0.1.2",
      latest: { version: "0.2.0", notes: "Fixes.", url: "https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0" },
    });
    let reject!: (error: string) => void;
    updates.install = () => new Promise((_resolve, fail) => { reject = fail; });
    onTestFinished(() => {
      updates.check = async () => ({ current: "0.1.2", latest: null });
      updates.install = async () => "installed";
      opener.openUrl.mockReset();
    });
    const onSave = renderAbout({ checkUpdates: false });
    expect(invoke).not.toHaveBeenCalledWith("update_check");
    checkNow();
    await screen.findByText("PlexusTerm 0.2.0 is available.");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const installs = () => vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "update_install");
    expect(installs()).toEqual([["update_install", { onProgress: expect.any(Channel) }]]);
    const channel = (installs()[0][1] as { onProgress: Channel<unknown> }).onProgress;
    expect(screen.getByText("Checking installation…").getAttribute("role")).toBe("status");
    act(() => channel.onmessage({ phase: "downloading" }));
    expect(screen.getByText("Downloading…")).toBeTruthy();
    act(() => channel.onmessage({ phase: "downloading", downloaded: 50 }));
    expect(screen.getByText("Downloading… 50 bytes")).toBeTruthy();
    await act(async () => reject("Checksum mismatch"));
    expect(screen.getByRole("alert").textContent).toBe("Could not install update: Checksum mismatch");
    opener.openUrl.mockRejectedValueOnce("No browser");
    fireEvent.click(screen.getByRole("button", { name: "Visit download page" }));
    await screen.findByText("Could not open download page: No browser");
    expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0");
    updates.install = async () => "installerOpened";
    fireEvent.click(screen.getByRole("button", { name: "Retry download" }));
    expect(await screen.findByText("Installer completed. Restart PlexusTerm manually when ready.")).toBeTruthy();
    expect(installs()).toHaveLength(2);
    expect(screen.queryByText(/Could not install update/)).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows why a check failed", async () => {
    updates.check = async () => {
      throw "GitHub answered 503";
    };
    onTestFinished(() => {
      updates.check = async () => ({ current: "0.1.2", latest: null });
    });
    renderAbout();
    checkNow();
    expect(await screen.findByText("Could not check for updates: GitHub answered 503")).toBeTruthy();
  });

  it("saves the startup check choice", () => {
    const onSave = renderAbout();
    const box = screen.getByLabelText("Check for updates at startup") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, checkUpdates: false });
  });

  it("saves the restore tabs choice from General, explained by a help tip", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} initialSection="general" />);
    const box = screen.getByLabelText(/Restore tabs at startup/) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")!.querySelector(".help-tip")).not.toBeNull();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, restoreTabs: false });
  });

  it("sets a drop-down shortcut and height in General, explained by help tips", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} initialSection="general" />);
    const field = screen.getByLabelText(/Drop-down shortcut/) as HTMLInputElement;
    expect(field.value).toBe("");
    expect(field.closest(".field")!.querySelector(".help-tip")).not.toBeNull();
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: "k" });
    expect(screen.getByText("Use Ctrl, Alt or Meta with a key.")).toBeTruthy();
    fireEvent.keyDown(field, { key: "k", ctrlKey: true, altKey: true });
    expect(field.value).toBe("Ctrl+Alt+K");
    fireEvent.change(screen.getByLabelText(/Drop-down height/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, dropDownShortcut: "Ctrl+Alt+K", dropDownHeight: 100 });
  });

  it("refuses a drop-down shortcut PlexusTerm already uses, and clears it", () => {
    const onSave = vi.fn();
    const settings = { ...DEFAULT_SETTINGS, dropDownShortcut: "Ctrl+Alt+K" };
    render(<SettingsDialog settings={settings} onSave={onSave} onCancel={vi.fn()} initialSection="general" />);
    const field = screen.getByLabelText(/Drop-down shortcut/) as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: " ", ctrlKey: true, shiftKey: true });
    expect(screen.getByText("Ctrl+Shift+Space is already used by “AI assistant”.")).toBeTruthy();
    expect(field.value).toBe("Ctrl+Alt+K");
    fireEvent.click(screen.getByRole("button", { name: "Remove the drop-down shortcut" }));
    expect(field.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("shows under the drop-down shortcut why the system refused it", () => {
    render(
      <SettingsDialog
        settings={{ ...DEFAULT_SETTINGS, dropDownShortcut: "Ctrl+Alt+K" }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        initialSection="general"
        dropDownError={{ kind: "wayland" }}
      />,
    );
    expect(screen.getByText(/not available in a Wayland session/)).toBeTruthy();
  });

  it("turns the diagnostic log on and saves its folder, trimmed", () => {
    const onSave = renderAbout();
    const dir = screen.getByLabelText("Log folder") as HTMLInputElement;
    expect(dir.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Write a diagnostic log"));
    expect(dir.disabled).toBe(false);
    fireEvent.change(dir, { target: { value: "  /var/log/plexus  " } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, diagnosticLog: true, diagnosticLogDir: "/var/log/plexus" });
  });

  it("shows the log file in the chosen folder", () => {
    renderAbout();
    fireEvent.change(screen.getByLabelText("Log folder"), { target: { value: "/var/log/plexus/" } });
    expect(screen.getByText("Log file: /var/log/plexus/plexusterm.log")).toBeTruthy();
  });
});

describe("Focused pane border in Appearance", () => {
  it("saves a chosen colour and intensity, and goes back to the scheme's accent", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} initialSection="appearance" />);
    fireEvent.change(screen.getByLabelText("Border colour"), { target: { value: "#FF8800" } });
    fireEvent.change(screen.getByLabelText("Intensity: 55%"), { target: { value: "30" } });
    expect(screen.getByLabelText("Intensity: 30%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, focusBorderColor: "#ff8800", focusBorderStrength: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Scheme accent" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, focusBorderStrength: 30 });
  });
});

describe("File icon packs in Files", () => {
  it("saves the pack of the plain lists and the one of DEV mode's trees", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} initialSection="files" />);
    fireEvent.change(screen.getByLabelText("File list icons"), { target: { value: "lines" } });
    fireEvent.change(screen.getByLabelText("DEV mode tree icons"), { target: { value: "material" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, fileIconsList: "lines", fileIconsTree: "material" });
  });
});

describe("Credits in About", () => {
  it("names who made the file icons", () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} initialSection="about" />);
    expect(screen.getByText(/Material Icon Theme by Philipp Kief.*Seti UI by Jesse Weed/)).toBeTruthy();
  });
});

describe("Feedback in About", () => {
  const renderAbout = () =>
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} initialSection="about" />);
  const issues = "https://github.com/jorgealonsodev/PlexusTerm/issues/new";

  it("opens the bug report form with the version filled in", () => {
    onTestFinished(() => {
      opener.openUrl.mockClear();
    });
    renderAbout();
    fireEvent.click(screen.getByRole("button", { name: "Report a problem" }));
    expect(opener.openUrl).toHaveBeenCalledWith(`${issues}?template=bug_report.yml&version=${packageJson.version}`);
  });

  it("opens the feature request form", () => {
    onTestFinished(() => {
      opener.openUrl.mockClear();
    });
    renderAbout();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an improvement" }));
    expect(opener.openUrl).toHaveBeenCalledWith(`${issues}?template=feature_request.yml`);
  });
});

describe("Open-source licenses in About", () => {
  it("lists the shipped libraries in their own dialog and goes back to Settings", async () => {
    const onCancel = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={onCancel} initialSection="about" />);
    fireEvent.click(screen.getByRole("button", { name: "Open-source licenses" }));
    const list = await screen.findByRole("list", { name: "Libraries" }, { timeout: 5000 });
    expect(within(list).getByRole("button", { name: /^react \d/ })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /^russh \d/ })).toBeTruthy();
    // Escape closes the licenses only, not Settings under them.
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Libraries" })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open-source licenses" }));
    // The licenses' own Close (Settings' Close comes after it).
    fireEvent.click((await screen.findAllByRole("button", { name: "Close" }))[0]);
    expect(screen.queryByRole("list", { name: "Libraries" })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open-source licenses" })).toBeTruthy();
  });
});


describe("SettingsDialog > Sharing", () => {
  it("links to the relay's project to install it", () => {
    onTestFinished(() => {
      opener.openUrl.mockClear();
    });
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} initialSection="sharing" />);
    fireEvent.click(screen.getByRole("link", { name: "How to install the relay" }));
    expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/jorgealonsodev/plexusterm-relay");
  });
});
