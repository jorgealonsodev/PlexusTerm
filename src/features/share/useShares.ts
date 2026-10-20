import { useEffect, useRef, useState } from "react";
import { blockOf, createInputHold, type Block, type InputHold } from "./inputHold";
import type { SharePane } from "./sharePane";
import {
  crashedShares,
  shareCommand,
  startShare,
  type Access,
  type EndKind,
  type Expiry,
  type HistoryChoice,
  type LinkInfo,
  type ShareCommand,
  type ShareEvent,
  type ShareViewer,
} from "./shareApi";

/** A timed share warns the sharer this long before it ends (PRD-share §4.1.6). */
export const EXPIRY_WARNING_MS = 10 * 60 * 1000;
/** How often held viewer input is looked at again. */
const HOLD_TICK_MS = 100;

export interface ShareOptions {
  accesses: Access[];
  expiry: Expiry;
  history: HistoryChoice;
}

export interface Share {
  paneId: string;
  tabKey: string;
  /** The tab's name when the share started, for messages. */
  tab: string;
  /** The backend's id once started. */
  id: number | null;
  phase: "starting" | "live" | "unreachable";
  options: ShareOptions;
  links: LinkInfo[];
  /** End time, Unix milliseconds. */
  expiresAt: number | null;
  viewers: ShareViewer[];
  pending: ShareViewer[];
  paused: boolean;
  /** Viewer input waits for a password typed on this computer. */
  passwordWait: boolean;
  /** The 10-minute warning is showing. */
  expiring: boolean;
  /** The warning was shown for the current end time. */
  warned: boolean;
}

/** What the sharing side tells the user, worded by the caller. */
export type ShareNotice =
  | { kind: "ended"; tab: string; end: EndKind; code: string | null }
  | { kind: "joinRequest"; tab: string; viewer: ShareViewer }
  | { kind: "password"; tab: string }
  | { kind: "crashed"; tab: string; at: number }
  | { kind: "failed"; tab: string; error: string };

export interface StartArgs {
  paneId: string;
  tabKey: string;
  tab: string;
  options: ShareOptions;
  relayUrl: string;
  viewerOrigin: string;
  viewNeedsApproval: boolean;
  recordInput: boolean;
  blockLid: boolean;
  /** Type `sudo -k` once the share is live (a Can type share in a Unix shell, when Settings ask). */
  sudoReset: boolean;
}

interface Live {
  hold: InputHold;
  unsubscribe: () => void;
  /** A password notice was given for the current wait. */
  toldPassword: boolean;
  sudoReset: boolean;
}

export interface Shares {
  byPane: Record<string, Share>;
  registerPane: (paneId: string, pane: SharePane) => () => void;
  start: (args: StartArgs) => Promise<void>;
  command: (paneId: string, command: ShareCommand) => void;
  /** Stops the share of `paneId` (no-op without one). */
  stop: (paneId: string) => void;
  /** Hides the 10-minute warning. */
  dismissWarning: (paneId: string) => void;
  /** People connected to the shares of these panes. */
  viewersOf: (paneIds: string[]) => number;
}

const viewerOnly = (list: ShareViewer[], viewer: number) => list.filter((v) => v.viewer !== viewer);

/**
 * Every shared pane of the window: starts and stops shares, answers the backend's snapshot
 * requests, types viewer input by the hold rules, and reports what the sharer must know.
 */
export function useShares(onNotice: (notice: ShareNotice) => void): Shares {
  const [byPane, setByPane] = useState<Record<string, Share>>({});
  const sharesRef = useRef(byPane);
  sharesRef.current = byPane;
  const panes = useRef(new Map<string, SharePane>());
  const live = useRef(new Map<string, Live>());
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const patch = (paneId: string, change: (share: Share) => Partial<Share>) =>
    setByPane((all) => {
      const share = all[paneId];
      if (!share) return all;
      const next = { ...all, [paneId]: { ...share, ...change(share) } };
      sharesRef.current = next;
      return next;
    });

  const send = (paneId: string, command: ShareCommand) => {
    const id = sharesRef.current[paneId]?.id;
    if (id != null) void shareCommand(id, command).catch(() => {});
  };

  const finish = (paneId: string) => {
    live.current.get(paneId)?.unsubscribe();
    live.current.delete(paneId);
    setByPane((all) => {
      if (!all[paneId]) return all;
      const next = { ...all };
      delete next[paneId];
      sharesRef.current = next;
      return next;
    });
  };

  /** Types what the hold rules let through. */
  const releaseInput = (paneId: string) => {
    const state = live.current.get(paneId);
    const pane = panes.current.get(paneId);
    const share = sharesRef.current[paneId];
    if (!state || !pane || !share) return;
    const now = performance.now();
    const block: Block = blockOf(
      { paused: share.paused, atPassword: pane.atPassword(), sharerTypedAt: pane.sharerTypedAt() },
      now,
    );
    const waitingForPassword = block === "password" && state.hold.size() > 0;
    if (waitingForPassword !== share.passwordWait) patch(paneId, () => ({ passwordWait: waitingForPassword }));
    if (waitingForPassword && !state.toldPassword) {
      state.toldPassword = true;
      noticeRef.current({ kind: "password", tab: share.tab });
    }
    if (block !== "password") state.toldPassword = false;
    for (const { data } of state.hold.release(now, block)) pane.inject(data);
  };

  const onEvent = (paneId: string, event: ShareEvent) => {
    const share = sharesRef.current[paneId];
    if (!share) return;
    switch (event.event) {
      case "unreachable":
        return patch(paneId, () => ({ phase: "unreachable" }));
      case "live": {
        const first = share.phase === "starting";
        patch(paneId, () => ({ phase: "live", links: event.data.links, expiresAt: event.data.expiresAt * 1000 }));
        const state = live.current.get(paneId);
        const pane = panes.current.get(paneId);
        if (first && state?.sudoReset && pane && !pane.fullScreen() && !pane.atPassword()) {
          // A leading space keeps it out of the shell's history.
          pane.inject(" sudo -k\r");
        }
        return;
      }
      case "joinRequest":
        patch(paneId, (s) => ({ pending: [...viewerOnly(s.pending, event.data.viewer.viewer), event.data.viewer] }));
        return noticeRef.current({ kind: "joinRequest", tab: share.tab, viewer: event.data.viewer });
      case "viewerJoined":
        return patch(paneId, (s) => ({
          pending: viewerOnly(s.pending, event.data.viewer.viewer),
          viewers: [...viewerOnly(s.viewers, event.data.viewer.viewer), event.data.viewer],
        }));
      case "viewerLeft":
        live.current.get(paneId)?.hold.forget(event.data.viewer);
        return patch(paneId, (s) => ({
          pending: viewerOnly(s.pending, event.data.viewer),
          viewers: viewerOnly(s.viewers, event.data.viewer),
        }));
      case "input":
        live.current.get(paneId)?.hold.push(event.data.viewer, event.data.data);
        return releaseInput(paneId);
      case "snapshotRequest": {
        const pane = panes.current.get(paneId);
        if (!pane) return;
        const viewer = event.data.viewer;
        void pane.snapshot(share.options.history).then(({ coversSeq, screen, full }) =>
          send(paneId, { cmd: "snapshot", viewer, coversSeq, screen, full }),
        );
        return;
      }
      case "expiry":
        return patch(paneId, () => ({ expiresAt: event.data.expiresAt * 1000, expiring: false, warned: false }));
      case "links":
        return patch(paneId, (s) => ({
          links: event.data.links,
          // View only: every viewer is View only now.
          viewers: event.data.links.every((l) => l.access === "view")
            ? s.viewers.map((v) => ({ ...v, access: "view" as const }))
            : s.viewers,
        }));
      case "ended":
        finish(paneId);
        return noticeRef.current({ kind: "ended", tab: share.tab, end: event.data.kind, code: event.data.code });
    }
  };

  // Held input goes as soon as the rules allow; timed shares warn 10 minutes before they end.
  const anyShare = Object.keys(byPane).length > 0;
  useEffect(() => {
    if (!anyShare) return;
    const timer = setInterval(() => {
      for (const [paneId, share] of Object.entries(sharesRef.current)) {
        const state = live.current.get(paneId);
        if (state && (state.hold.size() > 0 || share.passwordWait)) releaseInput(paneId);
        const timed = share.options.expiry !== "whenStopped";
        const soon = share.expiresAt !== null && share.expiresAt - Date.now() <= EXPIRY_WARNING_MS;
        if (timed && soon && !share.expiring && share.phase !== "starting" && !share.warned) {
          patch(paneId, () => ({ expiring: true, warned: true }));
        }
      }
    }, HOLD_TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyShare]);

  // Shares a crash ended in an earlier run are told once.
  useEffect(() => {
    void crashedShares()
      .then((list) => list.forEach((c) => noticeRef.current({ kind: "crashed", tab: c.tab, at: c.at * 1000 })))
      .catch(() => {});
  }, []);

  const start = async (args: StartArgs) => {
    const pane = panes.current.get(args.paneId);
    const tap = pane?.tap() ?? null;
    if (!pane || tap === null || sharesRef.current[args.paneId]) return;
    const { cols, rows } = pane.size();
    const share: Share = {
      paneId: args.paneId,
      tabKey: args.tabKey,
      tab: args.tab,
      id: null,
      phase: "starting",
      options: args.options,
      links: [],
      expiresAt: null,
      viewers: [],
      pending: [],
      paused: false,
      passwordWait: false,
      expiring: false,
      warned: false,
    };
    setByPane((all) => {
      const next = { ...all, [args.paneId]: share };
      sharesRef.current = next;
      return next;
    });
    const unsubscribe = pane.onResize((c, r) => send(args.paneId, { cmd: "resize", cols: c, rows: r }));
    live.current.set(args.paneId, { hold: createInputHold(), unsubscribe, toldPassword: false, sudoReset: args.sudoReset });
    try {
      const id = await startShare(
        {
          tap,
          tab: args.tab,
          relayUrl: args.relayUrl,
          viewerOrigin: args.viewerOrigin,
          accesses: args.options.accesses,
          expiry: args.options.expiry,
          cols,
          rows,
          viewNeedsApproval: args.viewNeedsApproval,
          recordInput: args.recordInput,
          blockLid: args.blockLid,
        },
        (event) => onEvent(args.paneId, event),
      );
      patch(args.paneId, () => ({ id }));
    } catch (err) {
      finish(args.paneId);
      noticeRef.current({ kind: "failed", tab: args.tab, error: String(err) });
      throw err;
    }
  };

  const command = (paneId: string, cmd: ShareCommand) => {
    if (cmd.cmd === "pause") {
      patch(paneId, () => ({ paused: cmd.on }));
      if (!cmd.on) setTimeout(() => releaseInput(paneId), 0);
    }
    if (cmd.cmd === "allow" || cmd.cmd === "deny") {
      patch(paneId, (s) => ({ pending: viewerOnly(s.pending, cmd.viewer) }));
    }
    if (cmd.cmd === "expiry") patch(paneId, () => ({ expiring: false }));
    send(paneId, cmd);
  };

  return {
    byPane,
    registerPane: (paneId, pane) => {
      panes.current.set(paneId, pane);
      return () => {
        if (panes.current.get(paneId) === pane) panes.current.delete(paneId);
      };
    },
    start,
    command,
    stop: (paneId) => send(paneId, { cmd: "stop" }),
    dismissWarning: (paneId) => patch(paneId, () => ({ expiring: false })),
    viewersOf: (paneIds) => paneIds.reduce((n, id) => n + (byPane[id]?.viewers.length ?? 0), 0),
  };
}
