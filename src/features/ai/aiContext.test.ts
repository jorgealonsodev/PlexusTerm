import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { aiConfigOf, aiHint, needsApiKey, truncateSelection, MAX_SELECTION_LENGTH } from "./aiContext";

describe("aiConfigOf", () => {
  it("sends the base URL only for an OpenAI-compatible endpoint", () => {
    const base = { ...DEFAULT_SETTINGS, aiBaseUrl: "http://localhost:11434/v1" };
    expect(aiConfigOf({ ...base, aiProvider: "anthropic", aiModel: "claude-opus-5-5" })).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
    expect(aiConfigOf({ ...base, aiProvider: "openai-compatible", aiModel: "llama3.2" })).toEqual({
      provider: "openai-compatible",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
    });
  });
});

describe("aiHint", () => {
  it("names the reason in a few words", () => {
    expect(aiHint({ kind: "noKey", message: "x" })).toBe("AI: no API key");
    expect(aiHint({ kind: "auth", message: "x" })).toBe("AI: key rejected");
    expect(aiHint({ kind: "rateLimit", message: "x" })).toBe("AI: rate limited");
    expect(aiHint({ kind: "network", message: "x" })).toBe("AI: unavailable");
    expect(aiHint(new Error("boom"))).toBe("AI: unavailable");
  });
});

describe("needsApiKey", () => {
  it("is true for every provider but an OpenAI-compatible endpoint (local servers need none)", () => {
    expect(needsApiKey("anthropic")).toBe(true);
    expect(needsApiKey("gemini")).toBe(true);
    expect(needsApiKey("openai")).toBe(true);
    expect(needsApiKey("openai-compatible")).toBe(false);
  });
});

describe("truncateSelection", () => {
  it("keeps short selections and cuts long ones", () => {
    expect(truncateSelection("ls -la")).toBe("ls -la");
    expect(truncateSelection("x".repeat(MAX_SELECTION_LENGTH + 10))).toHaveLength(MAX_SELECTION_LENGTH);
  });
});
