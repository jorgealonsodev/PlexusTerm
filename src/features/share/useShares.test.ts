// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SharePane } from "./sharePane";
import type { ShareEvent } from "./shareApi";

const api = vi.hoisted(() => ({
  onEvent: null as null | ((event: ShareEvent) => void),
  startShare: vi.fn(),
  shareCommand: vi.fn(async () => {}),
  crashedShares: vi.fn(async () => [] as { tab: string; at: number }[]),
}));
vi.mock("./shareApi", () => ({
  startShare: (request: unknown, onEvent: (event: ShareEvent) => void) => {
    api.onEvent = onEvent;
    return api.startShare(request);
  },
  shareCommand: api.shareCommand,
  crashedShares: api.crashedShares,
}));

import { useShares, type ShareNotice } from "./useShares";

const viewer = { viewer: 4, number: 1, access: "type" as const, ip: "1.2.3.4", browser: "Chrome", os: "Android", since: 0 };

function fakePane(overrides: Partial<SharePane> = {}): SharePane & { injected: string[] } {
  const injected: string[] = [];
  return {
    injected,
    tap: () => 11,
    size: () => ({ cols: 100, rows: 30 }),
    snapshot: async () => ({ coversSeq: 5, screen: "S", full: "F" }),
    inject: (data) => injected.push(data),
    sharerTypedAt: () => -Infinity,
    atPassword: () => false,
    fullScreen: () => false,
    lineEmpty: () => true,
    onResize: () => () => {},
    ...overrides,
  };
}

const args = (sudoReset = false) => ({
  paneId: "p1",
  tabKey: "t1",
  tab: "bash",
  options: { accesses: ["view", "type"] as ("view" | "type")[], expiry: "oneHour" as const, history: 1000 as const },
  relayUrl: "wss://relay.example.com",
  viewerOrigin: "https://view.example.com",
  viewNeedsApproval: true,
  recordInput: false,
  blockLid: false,
  sudoReset,
});

async function started(pane = fakePane(), sudoReset = false) {
  api.startShare.mockResolvedValue(3);
  const notices: ShareNotice[] = [];
  const hook = renderHook(() => useShares((n) => notices.push(n)));
  act(() => void hook.result.current.registerPane("p1", pane));
  await act(async () => hook.result.current.start(args(sudoReset)));
  const emit = (event: ShareEvent) => act(async () => api.onEvent!(event));
  await emit({ event: "live", data: { links: [], expiresAt: 2_000_000_000 } });
  return { hook, pane, notices, emit };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useShares", () => {
  it("starts a share of the pane's tap with its size and the chosen options", async () => {
    const { hook } = await started();
    expect(api.startShare).toHaveBeenCalledWith(
      expect.objectContaining({ tap: 11, cols: 100, rows: 30, accesses: ["view", "type"], expiry: "oneHour" }),
    );
    expect(hook.result.current.byPane.p1).toMatchObject({ id: 3, phase: "live" });
  });

  it("tells the sharer of a join request and sends their answer", async () => {
    const { hook, notices, emit } = await started();
    await emit({ event: "joinRequest", data: { viewer } });
    expect(notices).toContainEqual({ kind: "joinRequest", tab: "bash", viewer });
    expect(hook.result.current.byPane.p1.pending).toEqual([viewer]);
    act(() => hook.result.current.command("p1", { cmd: "allow", viewer: 4 }));
    expect(api.shareCommand).toHaveBeenCalledWith(3, { cmd: "allow", viewer: 4 });
    expect(hook.result.current.byPane.p1.pending).toEqual([]);
    await emit({ event: "viewerJoined", data: { viewer, rejoined: false } });
    expect(hook.result.current.viewersOf(["p1"])).toBe(1);
  });

  it("types viewer input, and holds it at a password prompt with a notice", async () => {
    let password = false;
    const pane = fakePane({ atPassword: () => password });
    const { hook, notices, emit } = await started(pane);
    await emit({ event: "input", data: { viewer: 4, data: "ls\r" } });
    expect(pane.injected).toEqual(["ls\r"]);
    password = true;
    await emit({ event: "input", data: { viewer: 4, data: "hunter2" } });
    expect(pane.injected).toEqual(["ls\r"]);
    expect(notices).toContainEqual({ kind: "password", tab: "bash" });
    expect(hook.result.current.byPane.p1.passwordWait).toBe(true);
  });

  it("holds viewer input while paused and types it on resume", async () => {
    const { hook, pane, emit } = await started();
    act(() => hook.result.current.command("p1", { cmd: "pause", on: true }));
    await emit({ event: "input", data: { viewer: 4, data: "a" } });
    expect(pane.injected).toEqual([]);
    vi.useFakeTimers();
    act(() => hook.result.current.command("p1", { cmd: "pause", on: false }));
    await act(async () => vi.advanceTimersByTime(1));
    expect(pane.injected).toEqual(["a"]);
  });

  it("answers a snapshot request with the pane's serialization", async () => {
    const { emit } = await started();
    await emit({ event: "snapshotRequest", data: { viewer: 4 } });
    await act(async () => {});
    expect(api.shareCommand).toHaveBeenCalledWith(3, { cmd: "snapshot", viewer: 4, coversSeq: 5, screen: "S", full: "F" });
  });

  it("types sudo -k once the share is live when asked, only on an empty command line", async () => {
    const { pane } = await started(fakePane(), true);
    expect(pane.injected).toEqual([" sudo -k\r"]);
    const busy = await started(fakePane({ lineEmpty: () => false }), true);
    expect(busy.pane.injected).toEqual([]);
    expect(busy.notices).toContainEqual({ kind: "sudoSkipped", tab: "bash" });
  });

  it("drops the keys a viewer queued once the share is View only or the viewer is disconnected", async () => {
    const { hook, pane, emit } = await started();
    act(() => hook.result.current.command("p1", { cmd: "pause", on: true }));
    await emit({ event: "input", data: { viewer: 4, data: "rm -rf" } });
    await emit({ event: "input", data: { viewer: 5, data: "ls" } });
    act(() => hook.result.current.command("p1", { cmd: "disconnect", viewer: 5 }));
    act(() => hook.result.current.command("p1", { cmd: "viewOnly" }));
    vi.useFakeTimers();
    act(() => hook.result.current.command("p1", { cmd: "pause", on: false }));
    await act(async () => vi.advanceTimersByTime(500));
    expect(pane.injected).toEqual([]);
  });

  it("forgets the share when it ends and tells why", async () => {
    const { hook, notices, emit } = await started();
    await emit({ event: "ended", data: { kind: "idle", code: null } });
    expect(hook.result.current.byPane.p1).toBeUndefined();
    expect(notices).toContainEqual({ kind: "ended", tab: "bash", end: "idle", code: null });
  });

  it("reports a share a crash ended in an earlier run", async () => {
    api.crashedShares.mockResolvedValueOnce([{ tab: "claude", at: 100 }]);
    const notices: ShareNotice[] = [];
    renderHook(() => useShares((n) => notices.push(n)));
    await act(async () => {});
    expect(notices).toEqual([{ kind: "crashed", tab: "claude", at: 100_000 }]);
  });
});
