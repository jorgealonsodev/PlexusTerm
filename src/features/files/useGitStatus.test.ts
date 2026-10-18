// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIT_STATUS_MIN_INTERVAL_MS, useGitStatus, type GitStatusOptions } from "./useGitStatus";
import type { GitStatusEntry } from "./gitStatus";

const flush = () => act(async () => {});

function setup(initial: Partial<GitStatusOptions> & { root?: string | null } = {}) {
  const listeners = new Set<(text: string) => void>();
  const read = vi.fn(async (path: string): Promise<GitStatusEntry[]> => [{ path: `${path}.txt`, status: "modified" }]);
  const subscribeOutput = vi.fn((listener: (text: string) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const base: GitStatusOptions = { enabled: true, visible: true, prompt: 0, loads: 0, subscribeOutput, ...initial };
  const hook = renderHook(({ root, options }) => useGitStatus(read, root, options), {
    initialProps: { root: initial.root === undefined ? "/repo" : initial.root, options: base },
  });
  const output = (text = "x") => act(() => listeners.forEach((l) => l(text)));
  return { read, hook, output, base, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useGitStatus", () => {
  it("reads the folder when it loads and when it changes", async () => {
    const { read, hook, base } = setup();
    await flush();
    expect(read).toHaveBeenCalledWith("/repo");
    expect(hook.result.current).toEqual([{ path: "/repo.txt", status: "modified" }]);
    hook.rerender({ root: "/other", options: base });
    await flush();
    expect(read).toHaveBeenLastCalledWith("/other");
    expect(hook.result.current).toEqual([{ path: "/other.txt", status: "modified" }]);
  });

  it("reads at most once every 2 s while the terminal prints, and never when idle", async () => {
    const { read, output } = setup();
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      output();
      await act(async () => vi.advanceTimersByTime(100));
    }
    // 2 s of output: one more read at the 2 s mark.
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(GIT_STATUS_MIN_INTERVAL_MS));
    expect(read).toHaveBeenCalledTimes(2);
    // Idle: nothing more, ever.
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again when the prompt comes back or the list is loaded again", async () => {
    const { read, hook, base } = setup();
    await flush();
    await act(async () => vi.advanceTimersByTime(GIT_STATUS_MIN_INTERVAL_MS));
    hook.rerender({ root: "/repo", options: { ...base, prompt: 1 } });
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTime(GIT_STATUS_MIN_INTERVAL_MS));
    hook.rerender({ root: "/repo", options: { ...base, prompt: 1, loads: 1 } });
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("reads nothing while hidden or turned off, and nothing outside a folder", async () => {
    const hidden = setup({ visible: false });
    await flush();
    hidden.output();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(hidden.read).not.toHaveBeenCalled();
    // Shown again: one read.
    hidden.hook.rerender({ root: "/repo", options: { ...hidden.base, visible: true } });
    await flush();
    expect(hidden.read).toHaveBeenCalledTimes(1);

    const off = setup({ enabled: false });
    await flush();
    off.output();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(off.read).not.toHaveBeenCalled();
    expect(off.hook.result.current).toEqual([]);
    expect(off.listeners.size).toBe(0);

    const none = setup({ root: null });
    await flush();
    expect(none.read).not.toHaveBeenCalled();
  });

  it("a failed read clears the decorations instead of showing an error", async () => {
    const { read, hook, base } = setup();
    await flush();
    read.mockRejectedValueOnce(new Error("no git"));
    await act(async () => vi.advanceTimersByTime(GIT_STATUS_MIN_INTERVAL_MS));
    hook.rerender({ root: "/repo", options: { ...base, prompt: 5 } });
    await flush();
    expect(hook.result.current).toEqual([]);
  });

  it("stops listening to the terminal when unmounted", async () => {
    const { hook, listeners } = setup();
    await flush();
    expect(listeners.size).toBe(1);
    hook.unmount();
    expect(listeners.size).toBe(0);
  });
});
