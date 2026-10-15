import type { AiProvider, TerminalSettings } from "../settings/settings";
import { isAiError, type AiConfig } from "./aiClient";

/** Longest terminal selection the assistant sends (it is shown in full before sending). */
export const MAX_SELECTION_LENGTH = 2000;

/** The provider settings of a request; the base URL only matters to an OpenAI-compatible endpoint. */
export function aiConfigOf(settings: TerminalSettings): AiConfig {
  const config: AiConfig = { provider: settings.aiProvider, model: settings.aiModel };
  if (settings.aiProvider === "openai-compatible") config.baseUrl = settings.aiBaseUrl;
  return config;
}

/** Local OpenAI-compatible servers (Ollama, LM Studio) work without a key. */
export const needsApiKey = (provider: AiProvider) => provider !== "openai-compatible";

/** The short status hint a failed AI suggestion leaves in its pane. */
export function aiHint(err: unknown): string {
  if (!isAiError(err)) return "AI: unavailable";
  switch (err.kind) {
    case "noKey":
      return "AI: no API key";
    case "auth":
      return "AI: key rejected";
    case "rateLimit":
      return "AI: rate limited";
    default:
      return "AI: unavailable";
  }
}

export const truncateSelection = (text: string) => text.slice(0, MAX_SELECTION_LENGTH);
