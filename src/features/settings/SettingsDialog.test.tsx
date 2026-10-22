// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { SettingsDialog } from "./SettingsDialog";
import packageJson from "../../../package.json";
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS, type TerminalSettings } from "./settings";
import { ShellsContext } from "../platform/useShells";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
// jsdom cannot draw text: the dialog sees one installed font.
vi.mock("./fontCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fontCatalog")>()),
  detectInstalledFonts: () => ["Consolas"],
}));
const opener = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);
/** What `update_check` answers (a function so a test can make it fail). */
const updates = vi.hoisted(() => ({ check: async (): Promise<unknown> => ({ current: "0.1.2", latest: null }) }));
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
  invoke: vi.fn(async (cmd: string, args?: { provider?: string; key?: string; refresh?: boolean }) => {
    if (cmd === "ai_opencode_models") return go.models(args!.refresh!);
    if (cmd === "ai_key_status") return keys.has(args!.provider!);
    if (cmd === "ai_key_save") keys.set(args!.provider!, args!.key!);
    if (cmd === "ai_key_delete") keys.delete(args!.provider!);
    if (cmd === "history_load") return null;
    if (cmd === "update_check") return updates.check();
    return null;
  }),
}));

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
  it("shows one section at a time from the side menu, starting with Appearance", () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} />);
    const sections = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(sections).toEqual(["Appearance", "Terminal", "Shortcuts", "SSH", "Files", "AI", "Sharing", "About"]);
    const visible = () => screen.getAllByRole("tabpanel").filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"));
    expect(visible()).toEqual(["Appearance"]);
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
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
    fireEvent.click(screen.getByRole("tab", { name: "SSH" }));
    fireEvent.click(screen.getByLabelText("Remote monitor bar (SSH tabs)"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18, copyOnSelect: false, remoteMonitor: false }));
  });

  it("keeps the dragged sidebar width, which has no field, when saving", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, sidebarWidth: 400 }} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sidebarWidth: 400 }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "/opt/My Editor/editor" });

    fireEvent.click(screen.getByRole("button", { name: "Use system default" }));
    expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Text editor"), { target: { value: "  code --wait " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "code --wait" });
  });

  it("lists dark and light schemes separately and previews the selected one", () => {
    setup();
    const groups = [...screen.getByLabelText("Colour scheme").querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Dark", "Light"]);
    expect(screen.getByRole("option", { name: "Catppuccin Latte" }).parentElement?.getAttribute("label")).toBe("Light");
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "nord" } });
    const preview = screen.getByLabelText("Preview of Nord");
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("picks the font from the catalogue: default, bundled, installed, or typed by hand", () => {
    const { onSave } = setup();
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      textEditor: "",
    });
  });

  it("edits the commands that turn DEV mode on (S10)", () => {
    const { onSave } = setup();
    const field = screen.getByLabelText("Commands that turn DEV mode on") as HTMLInputElement;
    expect(field.value).toBe("claude, codex, agy, opencode, pi, gentle-shell");
    fireEvent.change(field, { target: { value: "claude  aider, codex" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, devCommands: ["claude", "aider", "codex"] });
  });

  it("restores the default font when the font family is left empty", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("keeps the font size when the field is not a number", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Terminal font size"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("cancels without saving, also on Escape", () => {
    const { onSave, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByLabelText("Terminal font size"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
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
      expect(await screen.findByText("No key saved")).toBeTruthy();
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
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      expect(await screen.findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "AIza-secret" } });
      fireEvent.click(screen.getByRole("button", { name: "Save key" }));
      expect(await screen.findByText("A key is saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_save", { provider: "gemini", key: "AIza-secret" });
      expect(field("API key").value).toBe("");
      expect(screen.queryByDisplayValue("AIza-secret")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
      expect(await screen.findByText("No key saved")).toBeTruthy();
      expect(invoke).toHaveBeenCalledWith("ai_key_delete", { provider: "gemini" });
      // Another provider has its own key.
      keys.set("anthropic", "sk-ant");
      fireEvent.change(field("Provider"), { target: { value: "anthropic" } });
      expect(await screen.findByText("A key is saved")).toBeTruthy();
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
      expect(await screen.findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "AIza-secret" } });
      fireEvent.click(screen.getByRole("button", { name: "Save key" }));
      expect(
        await screen.findByText(
          "Could not save the key: Could not use the system keyring: the system keyring is not available.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/\[object Object\]/)).toBeNull();
      expect(screen.getByText("No key saved")).toBeTruthy();
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
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fileDetails: true }));
    });

    it("chooses the terminal line height, 1.0 by default, warns what a taller one does, and saves it", () => {
      const { onSave } = setup();
      const height = screen.getByLabelText("Terminal line height") as HTMLSelectElement;
      expect(height.value).toBe("1");
      expect([...height.options].map((o) => o.textContent)).toEqual(["1.0", "1.05", "1.1", "1.15", "1.2", "1.25", "1.3"]);
      expect(screen.getByRole("button", { name: /above 1\.0 can look blurred with GPU acceleration/ })).toBeTruthy();
      fireEvent.change(height, { target: { value: "1.2" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lineHeight: 1.2 }));
    });

    it("chooses the weight of the terminal font, regular by default, and saves it", () => {
      const { onSave } = setup();
      const weight = screen.getByLabelText("Terminal font weight") as HTMLSelectElement;
      expect(weight.value).toBe("400");
      expect([...weight.options].map((o) => o.textContent)).toEqual(["Light", "Regular", "Medium", "Semibold"]);
      fireEvent.change(weight, { target: { value: "300" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontWeight: 300 }));
    });

    it("shows git status in file lists by default and saves the choice", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const git = field("Show git status in file lists");
      expect(git.checked).toBe(true);
      fireEvent.click(git);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ gitFileStatus: false }));
    });

    it("leaves auto-save of edited files off by default and saves the choice", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const auto = field("Save edited files automatically");
      expect(auto.checked).toBe(false);
      fireEvent.click(auto);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ viewerAutoSave: true }));
    });

    it("opens the file viewer at the left by default and saves another side", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const side = screen.getByRole("combobox", { name: "Open the file viewer" }) as HTMLSelectElement;
      expect(side.value).toBe("left");
      fireEvent.change(side, { target: { value: "below" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ viewerPosition: "below" }));
    });

    it("chooses how the sidebar opens at startup (L17)", () => {
      const { onSave } = setup();
      const select = screen.getByLabelText("Sidebar when PlexusTerm opens") as HTMLSelectElement;
      expect(select.value).toBe("last");
      expect([...select.options].map((o) => o.textContent)).toEqual(["As I left it", "Open", "Folded"]);
      fireEvent.change(select, { target: { value: "collapsed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recentFolderLimit: 50, devFolderInFooter: false }));
    });

    it("changes the terminal's folder with the file browser by default, and saves the choice (L16)", () => {
      const { onSave } = setup();
      fireEvent.click(screen.getByRole("tab", { name: "Files" }));
      const follows = field("Change the terminal's folder when you open a folder in the file browser");
      expect(follows.checked).toBe(true);
      fireEvent.click(follows);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ terminalFollowsBrowser: false }));
    });

    it("keeps AI conversations by default and saves the choice (S9)", () => {
      const { onSave } = openAi();
      const keep = field("Keep AI conversations after closing PlexusTerm");
      expect(keep.checked).toBe(true);
      fireEvent.click(keep);
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aiSaveChats: false }));
    });

    it("saves the OpenCode Go key under its own provider", async () => {
      openAi();
      fireEvent.change(field("Provider"), { target: { value: "opencode-go" } });
      expect(await screen.findByText("No key saved")).toBeTruthy();
      fireEvent.change(field("API key"), { target: { value: "oc-secret" } });
      fireEvent.click(screen.getByRole("button", { name: "Save key" }));
      expect(await screen.findByText("A key is saved")).toBeTruthy();
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
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

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
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

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

  it("offers the download page of a newer release", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(opener.openUrl).toHaveBeenCalledWith("https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.2.0");
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, checkUpdates: false });
  });

  it("turns the diagnostic log on and saves its folder, trimmed", () => {
    const onSave = renderAbout();
    const dir = screen.getByLabelText("Log folder") as HTMLInputElement;
    expect(dir.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Write a diagnostic log"));
    expect(dir.disabled).toBe(false);
    fireEvent.change(dir, { target: { value: "  /var/log/plexus  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, focusBorderColor: "#ff8800", focusBorderStrength: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Scheme accent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, focusBorderStrength: 30 });
  });
});

describe("File icon packs in Files", () => {
  it("saves the pack of the plain lists and the one of DEV mode's trees", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} initialSection="files" />);
    fireEvent.change(screen.getByLabelText("File list icons"), { target: { value: "lines" } });
    fireEvent.change(screen.getByLabelText("DEV mode tree icons"), { target: { value: "material" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(screen.queryByRole("list", { name: "Libraries" })).toBeNull();
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
