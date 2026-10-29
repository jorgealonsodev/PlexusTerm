import type { FontStep } from "./settings";

/** What Ctrl+wheel sizes: the text of the terminals, the AI chat or the Explorer it is over. */
export type WheelZoomTarget = "terminal" | "chat" | "explorer";

/** The scroll of one wheel notch, in pixels: a touchpad's small deltas add up to it for one step. */
const NOTCH_PX = 50;

/**
 * Ctrl+wheel over a terminal, the AI chat or the Explorer (and SFTP browser) makes its text
 * bigger (wheel up) or smaller (wheel down), like Ctrl+= and Ctrl+-, and keeps the wheel from
 * scrolling it. Returns the detach function.
 */
export function attachWheelZoom(
  target: Window | HTMLElement,
  onStep: (where: WheelZoomTarget, step: FontStep) => void,
): () => void {
  let pending = 0;
  const listener = (event: Event) => {
    const e = event as WheelEvent;
    if (!e.ctrlKey || !(e.target instanceof Element)) return;
    const where: WheelZoomTarget | null = e.target.closest(".chat")
      ? "chat"
      : e.target.closest(".terminal-pane")
        ? "terminal"
        : e.target.closest(".sidebar__panel.sftp")
          ? "explorer"
          : null;
    if (!where) return;
    e.preventDefault();
    e.stopPropagation();
    // Lines or pages: each event is a notch. Pixels: a touchpad's small deltas add up to one.
    const px = e.deltaMode === 0 ? e.deltaY : Math.sign(e.deltaY) * NOTCH_PX;
    // A turn the other way starts counting again.
    if (Math.sign(px) !== Math.sign(pending)) pending = 0;
    pending += px;
    if (Math.abs(pending) < NOTCH_PX) return;
    pending = 0;
    onStep(where, px < 0 ? "increase" : "decrease");
  };
  // Capture, before xterm.js scrolls with the wheel; not passive, to cancel it.
  target.addEventListener("wheel", listener, { capture: true, passive: false });
  return () => target.removeEventListener("wheel", listener, { capture: true });
}
