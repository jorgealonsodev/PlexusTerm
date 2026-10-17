// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { SettingsDialog } from "./SettingsDialog";
import packageJson from "../../../package.json";
import { DEFAULT_SETTINGS, type TerminalSettings } from "./settings";
import { ShellsContext } from "../platform/useShells";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
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
    expect(sections).toEqual(["Appearance", "Terminal", "SSH", "Files", "AI", "About"]);
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
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "18" } });
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
    expect((screen.getByLabelText("Font size") as HTMLInputElement).value).toBe("14");
    expect((screen.getByLabelText("Copy on select") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Right click pastes") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Confirm multi-line paste") as HTMLInputElement).checked).toBe(true);
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
    const groups = [...document.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Dark", "Light"]);
    expect(screen.getByRole("option", { name: "Catppuccin Latte" }).parentElement?.getAttribute("label")).toBe("Light");
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "nord" } });
    const preview = screen.getByLabelText("Preview of Nord");
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("saves the edited settings, clamping the font size", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByLabelText("Right click pastes"));
    fireEvent.click(screen.getByLabelText("Confirm multi-line paste"));
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
      theme: "solarized-light",
      fontFamily: "Hack Nerd Font",
      remoteMonitor: false,
      textEditor: "",
    });
  });

  it("restores the default font when the font family is left empty", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("keeps the font size when the field is not a number", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("cancels without saving, also on Escape", () => {
    const { onSave, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByLabelText("Font size"), { key: "Escape" });
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
      expect(field("Assistant shortcut").value).toBe("Ctrl+Shift+Space");
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

    it("captures the assistant shortcut, refusing app shortcuts; Escape cancels without closing", () => {
      const { onSave, onCancel } = openAi();
      const input = field("Assistant shortcut");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Control", ctrlKey: true });
      fireEvent.keyDown(input, { key: "T", ctrlKey: true, shiftKey: true });
      expect(screen.getByText("Ctrl+Shift+T is already used by PlexusTerm.")).toBeTruthy();
      fireEvent.keyDown(input, { key: "a" });
      expect(screen.getByText("Use Ctrl, Alt or Meta with a key.")).toBeTruthy();
      fireEvent.keyDown(input, { key: "k", ctrlKey: true, altKey: true });
      expect(input.value).toBe("Ctrl+Alt+K");
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "j", ctrlKey: true, altKey: true });
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onCancel).not.toHaveBeenCalled();
      expect(input.value).toBe("Ctrl+Alt+J");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, assistantShortcut: "Ctrl+Alt+J" });
    });
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

  it("offers the system default and Other… before the shells are known", () => {
    renderWith({}, null);
    expect(Array.from(shellSelect().options).map((o) => o.textContent)).toEqual(["System default", "Other…"]);
  });
});
