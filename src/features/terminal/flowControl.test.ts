import { describe, expect, it, vi } from "vitest";
import { FLOW_HIGH, FLOW_LOW, FLOW_RENEW_MS, createOutputFlow } from "./flowControl";

describe("createOutputFlow", () => {
  it("never pauses while the output still to parse stays under the high mark", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused);
    const parsed = flow.queued(FLOW_HIGH);
    parsed();
    expect(setPaused).not.toHaveBeenCalled();
  });

  it("pauses once over the high mark and resumes once under the low mark, each only once", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused);
    const chunk = 64 * 1024;
    const callbacks = Array.from({ length: Math.ceil(FLOW_HIGH / chunk) + 4 }, () => flow.queued(chunk));
    expect(setPaused.mock.calls).toEqual([[true]]);
    let pending = callbacks.length * chunk;
    for (const parsed of callbacks) {
      parsed();
      pending -= chunk;
      expect(setPaused).toHaveBeenLastCalledWith(pending < FLOW_LOW ? false : true);
    }
    expect(setPaused.mock.calls).toEqual([[true], [false]]);
  });

  it("resumes a paused session when disposed, and stays quiet afterwards", () => {
    const setPaused = vi.fn();
    const flow = createOutputFlow(setPaused);
    const parsed = flow.queued(FLOW_HIGH + 1);
    flow.dispose();
    expect(setPaused.mock.calls).toEqual([[true], [false]]);
    parsed();
    flow.queued(FLOW_HIGH * 2);
    expect(setPaused).toHaveBeenCalledTimes(2);
  });

  it("tells how much output is still to parse", () => {
    const flow = createOutputFlow(vi.fn());
    const first = flow.queued(100);
    flow.queued(50);
    expect(flow.pending()).toBe(150);
    first();
    expect(flow.pending()).toBe(50);
  });

  it("disposing a session that was never paused asks nothing", () => {
    const setPaused = vi.fn();
    createOutputFlow(setPaused).dispose();
    expect(setPaused).not.toHaveBeenCalled();
  });

  it("asks the pause again while the pane is still catching up, and stops asking once resumed", () => {
    vi.useFakeTimers();
    try {
      const setPaused = vi.fn();
      const flow = createOutputFlow(setPaused);
      const parsed = flow.queued(FLOW_HIGH + 1);
      expect(setPaused.mock.calls).toEqual([[true]]);
      vi.advanceTimersByTime(FLOW_RENEW_MS * 2);
      expect(setPaused.mock.calls).toEqual([[true], [true], [true]]);
      parsed();
      expect(setPaused).toHaveBeenLastCalledWith(false);
      vi.advanceTimersByTime(FLOW_RENEW_MS * 3);
      expect(setPaused.mock.calls).toEqual([[true], [true], [true], [false]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
