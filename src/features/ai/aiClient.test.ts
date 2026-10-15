import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  aiAssist,
  aiComplete,
  aiKeyDelete,
  aiKeySave,
  aiKeyStatus,
  describeAiError,
  isAiError,
  type AiConfig,
} from "./aiClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

const config: AiConfig = { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3.2" };

afterEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("aiClient commands", () => {
  it("asks whether a key is saved without ever receiving it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true);
    await expect(aiKeyStatus("anthropic")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("ai_key_status", { provider: "anthropic" });
  });

  it("saves and deletes a provider key", async () => {
    await aiKeySave("gemini", "AIza-test");
    expect(invoke).toHaveBeenCalledWith("ai_key_save", { provider: "gemini", key: "AIza-test" });
    await aiKeyDelete("gemini");
    expect(invoke).toHaveBeenCalledWith("ai_key_delete", { provider: "gemini" });
  });

  it("requests a completion with the config and only the given context", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ completion: "it -m wip" });
    const request = { line: "git comm", os: "linux", shell: "bash", history: ["git status"] };
    await expect(aiComplete(config, request)).resolves.toBe("it -m wip");
    expect(invoke).toHaveBeenCalledWith("ai_complete", { config, request });
  });

  it("requests an assistant answer with an optional command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ answer: "Free space.", command: "df -h" });
    const request = { prompt: "free space?", selection: "x", os: "linux", history: [] };
    await expect(aiAssist(config, request)).resolves.toEqual({ answer: "Free space.", command: "df -h" });
    expect(invoke).toHaveBeenCalledWith("ai_assist", { config, request });
  });

  it("passes backend errors through unchanged", async () => {
    const err = { kind: "noKey", message: "No Anthropic API key is saved. Add one in Settings > AI." };
    vi.mocked(invoke).mockRejectedValueOnce(err);
    await expect(aiAssist(config, { prompt: "p", os: "linux", history: [] })).rejects.toEqual(err);
  });
});

describe("describeAiError", () => {
  it("uses the backend message of a typed error", () => {
    const err = { kind: "auth", message: "The OpenAI API key was rejected. Check it in Settings > AI." };
    expect(isAiError(err)).toBe(true);
    expect(describeAiError(err)).toBe("The OpenAI API key was rejected. Check it in Settings > AI.");
  });

  it("falls back to a per-kind text when the message is empty", () => {
    expect(describeAiError({ kind: "timeout", message: "" })).toBe("The AI provider did not answer in time.");
    expect(describeAiError({ kind: "noKey", message: "" })).toBe("No API key is saved for this provider.");
  });

  it("stringifies anything that is not a typed error", () => {
    expect(isAiError("boom")).toBe(false);
    expect(describeAiError("boom")).toBe("boom");
    expect(describeAiError(new Error("network down"))).toBe("network down");
  });
});
