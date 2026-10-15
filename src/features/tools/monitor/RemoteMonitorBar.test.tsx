// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { POLL_INTERVAL_MS, RemoteMonitorBar } from "./RemoteMonitorBar";
import type { MonitorSample } from "./monitorStats";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const GiB = 1024 ** 3;
const sample = (patch: Partial<Extract<MonitorSample, { status: "ok" }>> = {}): MonitorSample => ({
  status: "ok",
  cpuTotal: 1000,
  cpuIdle: 800,
  memTotal: 8 * GiB,
  memAvailable: 6 * GiB,
  diskTotal: 100 * GiB,
  diskUsed: 40 * GiB,
  netRx: 0,
  netTx: 0,
  users: 3,
  ...patch,
});

const text = (title: string) => screen.getByTitle(title).textContent;
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(invoke).mockReset();
});

describe("RemoteMonitorBar", () => {
  it("polls the session and shows its stats, with CPU and network rates from the second sample", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce(sample())
      .mockResolvedValueOnce(sample({ cpuTotal: 1200, cpuIdle: 850, netRx: 3 * 1024 * 3, netTx: 1024 * 3 }));
    render(<RemoteMonitorBar sessionId={7} active />);
    await tick(0);
    expect(invoke).toHaveBeenCalledWith("monitor_sample", { sessionId: 7 });
    expect(text("Memory used / total")).toBe("2.0 GB / 8.0 GB");
    expect(text("Root disk used / total")).toBe("40 GB / 100 GB");
    expect(text("Logged-in users")).toBe("3");
    expect(text("CPU usage")).toBe("…");

    await tick(POLL_INTERVAL_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(text("CPU usage")).toBe("75%");
    expect(text("Network received")).toBe("3.0 KB/s");
    expect(text("Network sent")).toBe("1.0 KB/s");
  });

  it("never overlaps requests: the next one waits for the previous answer", async () => {
    let answer: (value: MonitorSample) => void = () => {};
    vi.mocked(invoke).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    render(<RemoteMonitorBar sessionId={1} active />);
    await tick(POLL_INTERVAL_MS * 5);
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => answer(sample()));
    await tick(POLL_INTERVAL_MS);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("shows Monitoring unavailable for a non-Linux server or a failed read", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ status: "unavailable", reason: "not a Linux server (Darwin)" });
    render(<RemoteMonitorBar sessionId={1} active />);
    await tick(0);
    expect(screen.getByText("Monitoring unavailable")).toBeTruthy();
    expect(screen.queryByTitle("CPU usage")).toBeNull();
    cleanup();

    vi.mocked(invoke).mockRejectedValueOnce({ kind: "connection", message: "boom" });
    render(<RemoteMonitorBar sessionId={2} active />);
    await tick(0);
    expect(screen.getByText("Monitoring unavailable")).toBeTruthy();
  });

  it("does not poll without a session or while hidden, and stops when unmounted", async () => {
    vi.mocked(invoke).mockResolvedValue(sample());
    const { rerender, unmount } = render(<RemoteMonitorBar sessionId={null} active />);
    await tick(POLL_INTERVAL_MS * 2);
    rerender(<RemoteMonitorBar sessionId={4} active={false} />);
    await tick(POLL_INTERVAL_MS * 2);
    expect(invoke).not.toHaveBeenCalled();

    rerender(<RemoteMonitorBar sessionId={4} active />);
    await tick(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    unmount();
    await tick(POLL_INTERVAL_MS * 3);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
