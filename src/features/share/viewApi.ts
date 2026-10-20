import { Channel, invoke } from "@tauri-apps/api/core";
import type { Access } from "./shareApi";

/** Where a pasted link's share lives, read from its viewer page. */
export interface ResolvedLink {
  relayUrl: string;
  relayHost: string;
}

export type DoneReason = "denied" | "kicked" | "stopped" | "expired" | "offline" | "idle" | "refused" | "lost";

export type ViewEvent =
  | { event: "reconnecting"; data: { retryIn: number } }
  | { event: "waiting" }
  | { event: "joined"; data: { access: Access; cols: number; rows: number } }
  | { event: "reset" }
  | { event: "output"; data: string }
  | { event: "resized"; data: { cols: number; rows: number } }
  | { event: "access"; data: Access }
  | { event: "inputPaused"; data: boolean }
  | { event: "programExited" }
  | { event: "sharerAway" }
  | { event: "sharerBack" }
  | { event: "expiry"; data: number }
  | { event: "done"; data: { reason: DoneReason; code: string | null } };

export const resolveShareLink = (url: string) => invoke<ResolvedLink>("view_resolve", { url });

export function startView(url: string, relayUrl: string, onEvent: (event: ViewEvent) => void): Promise<number> {
  const channel = new Channel<ViewEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("view_start", { url, relayUrl, onEvent: channel });
}

export const viewInput = (id: number, data: string) => invoke<void>("view_input", { id, data });
export const closeView = (id: number) => invoke<void>("view_close", { id });
