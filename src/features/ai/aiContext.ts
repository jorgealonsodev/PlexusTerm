import type { AiProvider, TerminalSettings } from "../settings/settings";
import { t } from "../../i18n/i18n";
import { isAiError, type AiConfig } from "./aiClient";

/** Longest terminal selection the assistant sends (it is shown in full before sending). */
export const MAX_SELECTION_LENGTH = 2000;

/** The provider settings of a request; the base URL only matters to an OpenAI-compatible endpoint. */
export function aiConfigOf(settings: TerminalSettings, sessionId?: string): AiConfig {
  const config: AiConfig = { provider: settings.aiProvider, model: settings.aiModel };
  if (settings.aiProvider === "openai-compatible") config.baseUrl = settings.aiBaseUrl;
  if (sessionId) config.sessionId = sessionId;
  return config;
}

/** A new conversation ID (a UUID: letters, digits and '-', as OpenCode's session header expects). */
export const newAiSessionId = () => crypto.randomUUID();

/** Local OpenAI-compatible servers (Ollama, LM Studio) work without a key. */
export const needsApiKey = (provider: AiProvider) => provider !== "openai-compatible";

/** The short status hint a failed AI suggestion leaves in its pane. */
export function aiHint(err: unknown): string {
  if (!isAiError(err)) return t("ai.hint.unavailable");
  switch (err.kind) {
    case "noKey":
      return t("ai.hint.noKey");
    case "auth":
      return t("ai.hint.keyRejected");
    case "rateLimit":
      return t("ai.hint.rateLimited");
    default:
      return t("ai.hint.unavailable");
  }
}

export const truncateSelection = (text: string) => text.slice(0, MAX_SELECTION_LENGTH);
