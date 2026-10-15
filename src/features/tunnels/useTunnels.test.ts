// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TunnelStatus } from "./tunnels";
import { useTunnels } from "./useTunnels";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

type Update = { id: string; status: TunnelStatus };

afterEach(cleanup);

describe("useTunnels", () => {
  it("keeps a live status event when an older snapshot arrives after it", async () => {
    let resolveSnapshot!: (all: Update[]) => void;
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "tunnel_statuses") return new Promise((resolve) => (resolveSnapshot = resolve));
      return Promise.resolve(null);
    });
    let emit!: (update: Update) => void;
    vi.mocked(listen).mockImplementation((_event, handler) => {
      emit = (payload) => (handler as (e: { payload: Update }) => void)({ payload });
      return Promise.resolve(() => {});
    });

    const { result } = renderHook(() => useTunnels());
    await waitFor(() => expect(emit).toBeDefined());
    act(() => emit({ id: "t1", status: { state: "running" } }));
    await act(async () =>
      resolveSnapshot([
        { id: "t1", status: { state: "starting" } },
        { id: "t2", status: { state: "running" } },
      ]),
    );

    expect(result.current.statusOf("t1")).toEqual({ state: "running" });
    // Tunnels without a live event yet take the snapshot.
    expect(result.current.statusOf("t2")).toEqual({ state: "running" });
  });
});
