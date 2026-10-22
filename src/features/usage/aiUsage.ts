import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AiUsageChoice } from "../settings/settings";

/** The AI plans whose usage PlexusTerm can read (plain opencode only keeps a cost total). */
export type UsageProvider = "claude" | "codex" | "agy" | "opencodeGo";
export const USAGE_PROVIDERS: UsageProvider[] = ["claude", "codex", "agy", "opencodeGo"];

export type WindowKind = "fiveHour" | "weekly" | "monthly";

/** One rate-limit window (src-tauri/src/usage.rs): percent spent, reset time in Unix seconds. */
export interface UsageWindow {
  kind: WindowKind;
  percent: number;
  resetsAt: number | null;
  limited: boolean;
  /** The group of models it counts (Antigravity has several), or null. */
  group: string | null;
}

export interface Usage {
  windows: UsageWindow[];
}

export interface UsageState {
  usage: Usage | null;
  error: string | null;
  loading: boolean;
}

/** A provider is read at most this often, however many bars show it. */
export const USAGE_REFRESH_MS = 60_000;

/** Whose usage a terminal's bar shows: the chosen provider, or the CLI running in it. */
export function providerFor(choice: AiUsageChoice, cli: string | null): UsageProvider | null {
  if (choice === "off") return null;
  if (choice !== "auto") return choice;
  if (cli === "claude" || cli === "codex" || cli === "agy") return cli;
  if (cli === "opencode") return "opencodeGo";
  return null;
}

const READERS: Record<UsageProvider, () => Promise<Usage>> = {
  claude: () => invoke<Usage>("usage_claude"),
  codex: () => invoke<Usage>("usage_codex"),
  agy: () => invoke<Usage>("usage_agy"),
  opencodeGo: () => invoke<Usage>("ai_opencode_go_usage"),
};

/** The message of a failed read: a string (usage commands) or `{ message }` (AI commands). */
export function usageError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

interface Entry {
  state: UsageState;
  readAt: number;
  pending: Promise<void> | null;
}

const IDLE: UsageState = { usage: null, error: null, loading: false };
const cache = new Map<UsageProvider, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Reads `provider` unless it was read less than a minute ago (or `force`); one read at a time. */
export function refreshUsage(provider: UsageProvider, force = false): Promise<void> {
  const entry = cache.get(provider) ?? { state: IDLE, readAt: -Infinity, pending: null };
  cache.set(provider, entry);
  if (entry.pending) return entry.pending;
  if (!force && Date.now() - entry.readAt < USAGE_REFRESH_MS) return Promise.resolve();
  entry.state = { ...entry.state, loading: true };
  notify();
  entry.pending = READERS[provider]()
    .then(
      (usage) => {
        entry.state = { usage, error: null, loading: false };
      },
      (error) => {
        entry.state = { usage: null, error: usageError(error), loading: false };
      },
    )
    .finally(() => {
      entry.readAt = Date.now();
      entry.pending = null;
      notify();
    });
  return entry.pending;
}

/** Forgets every read (tests). */
export function resetUsageCache() {
  cache.clear();
}

/**
 * The usage of `provider`, read when first shown and every minute while `active` (a bar on
 * screen); bars showing the same provider share one read.
 */
export function useAiUsage(provider: UsageProvider | null, active: boolean): UsageState {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!provider || !active) return;
    void refreshUsage(provider);
    const timer = setInterval(() => void refreshUsage(provider), USAGE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [provider, active]);
  return provider ? (cache.get(provider)?.state ?? IDLE) : IDLE;
}
