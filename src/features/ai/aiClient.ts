import { invoke } from "@tauri-apps/api/core";
import { t } from "../../i18n/i18n";

/** Provider ids (Rust `ai::Provider`). */
export type AiProvider = "anthropic" | "gemini" | "openai" | "openai-compatible" | "opencode-go";

/** Provider settings sent with every request; API keys stay in the backend keyring. */
export interface AiConfig {
  provider: AiProvider;
  /** Only used (and required) by `openai-compatible`, e.g. `http://localhost:11434/v1`. */
  baseUrl?: string | null;
  model: string;
  /** One stable ID per conversation (pane or assistant opening), sent to OpenCode as `x-opencode-session`. */
  sessionId?: string;
}

/** The API an OpenCode Go model is served with (Rust `ai::opencode::GoFormat`). */
export type GoFormat = "chat" | "messages" | "responses" | "google" | "unknown";

export interface GoModel {
  id: string;
  name: string;
  format: GoFormat;
  /** False for APIs PlexusTerm cannot talk to yet. */
  supported: boolean;
}

/** The OpenCode Go model list, cached 24 h by the backend. */
export interface GoModels {
  models: GoModel[];
  /** Shown under the list, e.g. when the formats or a fresh list could not be fetched. */
  note: string | null;
  /** Unix seconds. */
  fetchedAt: number;
}

/** Context for completing the typed line. Terminal output is never sent. */
export interface AiCompleteRequest {
  line: string;
  os: string;
  shell?: string | null;
  cwd?: string | null;
  /** Last commands for this host, oldest first (the backend keeps at most 20). */
  history: string[];
}

/** One earlier question of a chat and its answer, replayed as context (the backend keeps the last 10, 16k chars). */
export interface AiTurn {
  question: string;
  selection: string | null;
  answer: string;
  command: string | null;
}

export interface AiAssistRequest {
  prompt: string;
  /** Terminal selection the user chose to include. */
  selection?: string | null;
  os: string;
  shell?: string | null;
  cwd?: string | null;
  history: string[];
  /** Earlier turns of the chat, oldest first. */
  conversation?: AiTurn[];
  /** Text of files dropped on the chat for this question (S6). */
  files?: { path: string; content: string }[];
}

/** The assistant's plain-text answer (line breaks kept) and, when one fits, one single-line command; nothing is ever executed. */
export interface AiAnswer {
  answer: string;
  command: string | null;
}

export type AiErrorKind =
  | "noKey"
  | "auth"
  | "rateLimit"
  | "network"
  | "timeout"
  | "refused"
  | "badResponse"
  | "config";

/** Mirrors the Rust `AiError` (`{ kind, message }`, message meant for the user). */
export interface AiError {
  kind: AiErrorKind;
  message: string;
}

/** Every error kind; the text shown when the backend sends no message is `ai.errors.<kind>`. */
const KINDS: Record<AiErrorKind, true> = {
  noKey: true,
  auth: true,
  rateLimit: true,
  network: true,
  timeout: true,
  refused: true,
  badResponse: true,
  config: true,
};

export function isAiError(err: unknown): err is AiError {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { kind?: unknown }).kind === "string" &&
    (err as { kind: string }).kind in KINDS
  );
}

export function describeAiError(err: unknown): string {
  if (isAiError(err)) return err.message || t(`ai.errors.${err.kind}`);
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Whether a key is saved for `provider`; the key itself never comes back. */
export const aiKeyStatus = (provider: AiProvider) => invoke<boolean>("ai_key_status", { provider });

export const aiKeySave = (provider: AiProvider, key: string) => invoke<void>("ai_key_save", { provider, key });

export const aiKeyDelete = (provider: AiProvider) => invoke<void>("ai_key_delete", { provider });

/** OpenCode Go models with names and API formats; `refresh` skips the 24 h cache. */
export const aiOpenCodeModels = (refresh: boolean) => invoke<GoModels>("ai_opencode_models", { refresh });

/** Text to append after `request.line` ("" when there is no useful completion). */
export const aiComplete = async (config: AiConfig, request: AiCompleteRequest) =>
  (await invoke<{ completion: string }>("ai_complete", { config, request })).completion;

export const aiAssist = (config: AiConfig, request: AiAssistRequest) =>
  invoke<AiAnswer>("ai_assist", { config, request });

/** One model of a provider's list (Rust `ai::models::ModelInfo`). */
export interface AiModelInfo {
  id: string;
  name: string;
  /** False for models PlexusTerm cannot talk to yet. */
  supported: boolean;
}

export interface AiModelList {
  models: AiModelInfo[];
  note: string | null;
}

/** The models `provider` offers, read with its saved key; `baseUrl` only for `openai-compatible`. */
export const aiModels = (provider: AiProvider, baseUrl?: string) =>
  invoke<AiModelList>("ai_models", baseUrl === undefined ? { provider } : { provider, baseUrl });
