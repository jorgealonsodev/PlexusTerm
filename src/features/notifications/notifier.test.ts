import { describe, expect, it, vi } from "vitest";
import { createNotifier, NOTIFY_PER_SOURCE_MS, NOTIFY_WINDOW_MAX, NOTIFY_WINDOW_MS } from "./notifier";

const setup = () => {
  let now = 0;
  const send = vi.fn();
  const notifier = createNotifier({ send, now: () => now });
  return { send, notifier, advance: (ms: number) => (now += ms) };
};

describe("createNotifier", () => {
  it("sends the first notification of a source", () => {
    const { send, notifier } = setup();
    expect(notifier.notify("pane-1", "build", "done")).toBe(true);
    expect(send).toHaveBeenCalledWith("build", "done");
  });

  it("lets one notification per source through every few seconds: a flood of bells is one notification", () => {
    const { send, notifier, advance } = setup();
    for (let i = 0; i < 50; i++) notifier.notify("pane-1", "tab", "bell");
    expect(send).toHaveBeenCalledTimes(1);
    advance(NOTIFY_PER_SOURCE_MS - 1);
    expect(notifier.notify("pane-1", "tab", "bell")).toBe(false);
    advance(1);
    expect(notifier.notify("pane-1", "tab", "bell")).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("caps notifications from every source together", () => {
    const { send, notifier, advance } = setup();
    for (let i = 0; i < 20; i++) notifier.notify(`pane-${i}`, "tab", "bell");
    expect(send).toHaveBeenCalledTimes(NOTIFY_WINDOW_MAX);
    advance(NOTIFY_WINDOW_MS);
    expect(notifier.notify("pane-99", "tab", "bell")).toBe(true);
  });
});
