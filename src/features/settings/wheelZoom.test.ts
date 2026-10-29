// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachWheelZoom } from "./wheelZoom";

const wheel = (target: Element, deltaY: number, ctrlKey = true, deltaMode = 0) => {
  const event = new WheelEvent("wheel", { deltaY, ctrlKey, deltaMode, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("attachWheelZoom", () => {
  let detach = () => {};
  afterEach(() => {
    detach();
    document.body.innerHTML = "";
  });
  const setup = () => {
    document.body.innerHTML = `<div class="terminal-pane"><canvas></canvas></div><section class="chat"><p></p></section><div class="sidebar__panel sftp"><ul><li></li></ul></div><nav></nav>`;
    const onStep = vi.fn();
    detach = attachWheelZoom(window, onStep);
    return {
      onStep,
      terminal: document.querySelector("canvas")!,
      chat: document.querySelector("p")!,
      explorer: document.querySelector("li")!,
      nav: document.querySelector("nav")!,
    };
  };

  it("sizes the Explorer's text over the Explorer or the SFTP browser", () => {
    const { onStep, explorer } = setup();
    expect(wheel(explorer, 100).defaultPrevented).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith("explorer", "decrease");
  });

  it("makes the text bigger with Ctrl and the wheel up and smaller with the wheel down, over a terminal or the AI chat", () => {
    const { onStep, terminal, chat } = setup();
    const up = wheel(terminal, -100);
    expect(onStep).toHaveBeenLastCalledWith("terminal", "increase");
    expect(up.defaultPrevented).toBe(true);
    wheel(terminal, 3, true, 1);
    expect(onStep).toHaveBeenLastCalledWith("terminal", "decrease");
    wheel(chat, -100);
    expect(onStep).toHaveBeenLastCalledWith("chat", "increase");
    expect(onStep).toHaveBeenCalledTimes(3);
  });

  it("leaves the wheel alone without Ctrl or elsewhere", () => {
    const { onStep, terminal, nav } = setup();
    expect(wheel(terminal, -100, false).defaultPrevented).toBe(false);
    expect(wheel(nav, -100).defaultPrevented).toBe(false);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("takes one step per notch's worth of small touchpad deltas", () => {
    const { onStep, terminal } = setup();
    for (let i = 0; i < 4; i++) wheel(terminal, -10);
    expect(onStep).not.toHaveBeenCalled();
    wheel(terminal, -10);
    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith("terminal", "increase");
  });
});
