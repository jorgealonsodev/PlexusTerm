import { invoke } from "@tauri-apps/api/core";

/** Provider ids (Rust `ai::Provider`). */
export type AiProvider = "anthropic" | "gemini" | "openai" | "openai-compatible";

/** Provider settings sent with every request; API keys stay in the backend keyring. */
export interface AiConfig {
  provider: AiProvider;
  /** Only used (and required) by `openai-compatible`, e.g. `http://localhost:11434/v1`. */
  baseUrl?: string | null;
  model: string;
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

export interface AiAssistRequest {
  prompt: string;
  /** Terminal selection the user chose to include. */
  selection?: string | null;
  os: string;
  shell?: string | null;
  cwd?: string | null;
  history: string[];
}

/** One single-line command (possibly empty) and a short explanation; never executed by the backend. */
export interface AiSuggestion {
  command: string;
  explanation: string;
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

const FALLBACK: Record<AiErrorKind, string> = {
  noKey: "No API key is saved for this provider.",
  auth: "The API key was rejected.",
  rateLimit: "The AI provider is limiting requests; try again in a moment.",
  network: "Could not reach the AI provider.",
  timeout: "The AI provider did not answer in time.",
  refused: "The AI provider declined to answer this request.",
  badResponse: "The AI provider sent an answer PlexusTerm could not read.",
  config: "Check the AI settings.",
};

export function isAiError(err: unknown): err is AiError {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { kind?: unknown }).kind === "string" &&
    (err as { kind: string }).kind in FALLBACK
  );
}

export function describeAiError(err: unknown): string {
  if (isAiError(err)) return err.message || FALLBACK[err.kind];
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Whether a key is saved for `provider`; the key itself never comes back. */
export const aiKeyStatus = (provider: AiProvider) => invoke<boolean>("ai_key_status", { provider });

export const aiKeySave = (provider: AiProvider, key: string) => invoke<void>("ai_key_save", { provider, key });

export const aiKeyDelete = (provider: AiProvider) => invoke<void>("ai_key_delete", { provider });

/** Text to append after `request.line` ("" when there is no useful completion). */
export const aiComplete = async (config: AiConfig, request: AiCompleteRequest) =>
  (await invoke<{ completion: string }>("ai_complete", { config, request })).completion;

export const aiAssist = (config: AiConfig, request: AiAssistRequest) =>
  invoke<AiSuggestion>("ai_assist", { config, request });
