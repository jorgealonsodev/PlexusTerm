// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ModelPicker } from "./ModelPicker";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

type Lists = Record<string, { id: string; name: string; supported: boolean }[] | Error>;

function backend(keys: string[], lists: Lists) {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const { provider } = args as { provider: string };
    if (cmd === "ai_key_status") return keys.includes(provider);
    if (cmd === "ai_models") {
      const list = lists[provider];
      if (list instanceof Error) throw { kind: "auth", message: list.message };
      return { models: list ?? [], note: null };
    }
    return null;
  });
}

const lists: Lists = {
  anthropic: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", supported: true }],
  "opencode-go": [
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", supported: true },
    { id: "gemini-4-argon", name: "Gemini 4 Argon", supported: false },
  ],
  gemini: [{ id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", supported: true }],
};

function renderPicker(baseUrl = "") {
  const onSelect = vi.fn();
  render(<ModelPicker provider="opencode-go" model="glm-5.3-flash" baseUrl={baseUrl} onSelect={onSelect} />);
  return onSelect;
}

const open = () => fireEvent.click(screen.getByRole("button", { name: /OpenCode Go · glm-5.3-flash/ }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

describe("ModelPicker (S10)", () => {
  it("shows the current provider and model, closed", () => {
    backend([], {});
    renderPicker();
    expect(screen.getByRole("button", { name: /OpenCode Go · glm-5.3-flash/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("lists the models of every provider with a saved key, each naming its provider", async () => {
    backend(["anthropic", "opencode-go"], lists);
    renderPicker();
    open();
    const list = await screen.findByRole("listbox", { name: "AI models" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(3));
    const labels = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Claude Opus 5.5Anthropic", "GLM 5.3 FlashOpenCode Go", "Gemini 4 ArgonOpenCode Go"]);
    expect(within(list).getByRole("option", { name: /GLM 5.3 Flash/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(list).getByRole("option", { name: /Gemini 4 Argon/ }).getAttribute("aria-disabled")).toBe("true");
    // Gemini has no key and there is no OpenAI-compatible base URL: never asked.
    const asked = vi.mocked(invoke).mock.calls.filter(([c]) => c === "ai_models").map(([, a]) => (a as { provider: string }).provider);
    expect(asked.sort()).toEqual(["anthropic", "opencode-go"]);
  });

  it("asks the OpenAI-compatible server only when its base URL is set", async () => {
    backend([], { "openai-compatible": [{ id: "llama4", name: "llama4", supported: true }] });
    renderPicker("http://localhost:11434/v1");
    open();
    expect(await screen.findByRole("option", { name: /llama4/ })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("ai_models", { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" });
  });

  it("leaves out an OpenAI-compatible server on opencode.ai that has no key of its own", async () => {
    backend(["opencode-go"], { ...lists, "openai-compatible": [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", supported: true }] });
    renderPicker("https://opencode.ai/zen/go/v1");
    open();
    await screen.findByRole("option", { name: /GLM 5.3 Flash/ });
    expect(screen.queryByRole("option", { name: /deepseek/ })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("ai_models", expect.objectContaining({ provider: "openai-compatible" }));
  });

  it("lists an OpenAI-compatible server on opencode.ai once it has its own key", async () => {
    backend(["openai-compatible"], { "openai-compatible": [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", supported: true }] });
    renderPicker("https://opencode.ai/zen/go/v1");
    open();
    expect(await screen.findByRole("option", { name: /deepseek/ })).toBeTruthy();
  });

  it("choosing a model selects it with its provider and closes", async () => {
    backend(["anthropic", "opencode-go"], lists);
    const onSelect = renderPicker();
    open();
    fireEvent.click(await screen.findByRole("option", { name: /Claude Opus 5.5/ }));
    expect(onSelect).toHaveBeenCalledWith("anthropic", "claude-opus-5-5");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not select a model PlexusTerm cannot use yet", async () => {
    backend(["opencode-go"], lists);
    const onSelect = renderPicker();
    open();
    fireEvent.click(await screen.findByRole("option", { name: /Gemini 4 Argon/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows a provider's error without hiding the other providers", async () => {
    backend(["anthropic", "opencode-go"], { ...lists, anthropic: new Error("The Anthropic API key was rejected.") });
    renderPicker();
    open();
    expect(await screen.findByText(/Anthropic API key was rejected/)).toBeTruthy();
    expect(await screen.findByRole("option", { name: /GLM 5.3 Flash/ })).toBeTruthy();
  });

  it("filters by name, id or provider and closes with Escape", async () => {
    backend(["anthropic", "opencode-go"], lists);
    renderPicker();
    open();
    await screen.findByRole("option", { name: /Claude Opus 5.5/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter models" }), { target: { value: "anthropic" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Filter models" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says when no provider has a key", async () => {
    backend([], {});
    renderPicker();
    open();
    expect(await screen.findByText(/No AI provider has an API key/)).toBeTruthy();
  });
});
