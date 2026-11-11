import { listen, type EventCallback } from "@tauri-apps/api/event";

/**
 * This window's label: "main", or "tab-<n>" for a window a tab was moved to. Read from what Tauri
 * gives the page; "main" outside Tauri (tests).
 */
export function windowLabel(): string {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: string } } } })
    .__TAURI_INTERNALS__;
  return internals?.metadata?.currentWebview?.label ?? "main";
}

/**
 * Listens to `event` when it is sent to every window or to this one. Tauri's plain `listen` also
 * hears an event sent to another window only, so with several windows each would act on it.
 */
export function listenHere<T>(event: string, handler: EventCallback<T>) {
  return listen<T>(event, handler, { target: windowLabel() });
}
