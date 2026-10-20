import { Channel, invoke } from "@tauri-apps/api/core";

/** View only or Can type. */
export type Access = "view" | "type";
export type Expiry = "whenStopped" | "oneHour" | "twelveHours";
/** History sent on join: the visible screen only, or that many lines before it. */
export type HistoryChoice = "screen" | 1000 | 5000;

export interface LinkInfo {
  access: Access;
  url: string;
  /** SVG markup of the link's QR code. */
  qr: string;
}

/** A viewer as the backend reports it; the label is worded with `viewerLabel`. */
export interface ShareViewer {
  viewer: number;
  number: number;
  access: Access;
  ip: string;
  browser: string | null;
  os: string | null;
  /** When it joined, Unix milliseconds. */
  since: number;
}

export type EndKind = "stopped" | "expired" | "offline" | "idle" | "programExited" | "refused";

export type ShareEvent =
  | { event: "unreachable"; data: { retryIn: number } }
  | { event: "live"; data: { links: LinkInfo[]; expiresAt: number } }
  | { event: "joinRequest"; data: { viewer: ShareViewer } }
  | { event: "viewerJoined"; data: { viewer: ShareViewer; rejoined: boolean; auto: boolean } }
  | { event: "viewerLeft"; data: { viewer: number } }
  | { event: "input"; data: { viewer: number; data: string } }
  | { event: "snapshotRequest"; data: { viewer: number } }
  | { event: "expiry"; data: { expiresAt: number } }
  | { event: "links"; data: { links: LinkInfo[] } }
  | { event: "ended"; data: { kind: EndKind; code: string | null } };

export type ShareCommand =
  | { cmd: "allow"; viewer: number }
  | { cmd: "deny"; viewer: number }
  | { cmd: "disconnect"; viewer: number }
  | { cmd: "viewOnly" }
  | { cmd: "pause"; on: boolean }
  | { cmd: "expiry"; expiry: Expiry }
  | { cmd: "snapshot"; viewer: number; coversSeq: number; screen: string | null; full: string }
  | { cmd: "resize"; cols: number; rows: number }
  | { cmd: "stop" };

export interface StartRequest {
  tap: number;
  tab: string;
  relayUrl: string;
  viewerOrigin: string;
  accesses: Access[];
  expiry: Expiry;
  cols: number;
  rows: number;
  viewNeedsApproval: boolean;
  /** Let every join in without asking, Can type included. */
  autoApprove: boolean;
  recordInput: boolean;
  blockLid: boolean;
}

export interface CrashedShare {
  tab: string;
  /** Unix seconds. */
  at: number;
}

export function startShare(request: StartRequest, onEvent: (event: ShareEvent) => void): Promise<number> {
  const channel = new Channel<ShareEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("share_start", { request, onEvent: channel });
}

export const shareCommand = (id: number, command: ShareCommand) => invoke<void>("share_command", { id, command });
export const crashedShares = () => invoke<CrashedShare[]>("share_crashed");
export const shareAuditLog = () => invoke<Record<string, unknown>[]>("share_audit_log");
export const relayTokenSaved = () => invoke<boolean>("share_token_status");
export const saveRelayToken = (token: string) => invoke<void>("share_token_save", { token });
export const deleteRelayToken = () => invoke<void>("share_token_delete");
export const viewerBuildHash = (origin: string) => invoke<string>("share_build_hash", { origin });
