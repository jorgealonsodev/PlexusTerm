import type { PointerEvent as ReactPointerEvent } from "react";

/** Where dragged paths live: the local disk (Explorer tab, desktop) or one SSH session (SFTP tab). */
export type PathOrigin = { kind: "local" } | { kind: "sftp"; sessionId: number };

export interface DraggedPath {
  path: string;
  isDir: boolean;
}

export interface PathDrag {
  origin: PathOrigin;
  paths: DraggedPath[];
}

/** Called with the drag and the element under the pointer when the button is released. */
export type DropHandler = (drag: PathDrag, target: Element | null) => void;

/** Pixels the pointer moves before a press on a row becomes a drag (clicks stay clicks). */
export const DRAG_THRESHOLD = 5;

let handler: DropHandler | null = null;

/** The app's drop handler; returns the function that removes it. */
export function setDropHandler(next: DropHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Hands a drop to the app's handler, as a released drag does. */
export function deliverDrop(drag: PathDrag, target: Element | null) {
  handler?.(drag, target);
}

/** The element marked as a drop target (`data-drop-pane` or `data-drop-chat`) under a point. */
export function dropTargetAt(x: number, y: number): Element | null {
  const hit = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  return hit?.closest("[data-drop-pane], [data-drop-chat]") ?? null;
}

/**
 * Starts following a press on a file row. Pointer events, not HTML drag and drop: WebView2 hands
 * HTML drops to the window's own file-drop handler, and WebKitGTK may turn them into a selection.
 * A small label follows the pointer; the drop target under it is highlighted.
 */
export function startPathDrag(e: ReactPointerEvent, drag: PathDrag, label: string) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let over: Element | null = null;

  const highlight = (next: Element | null) => {
    if (next === over) return;
    over?.classList.remove("drop-target--over");
    next?.classList.add("drop-target--over");
    over = next;
  };
  const move = (ev: PointerEvent) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      ghost = document.createElement("div");
      ghost.className = "path-drag";
      ghost.textContent = label;
      document.body.appendChild(ghost);
      document.body.classList.add("is-dragging-path");
    }
    ghost.style.left = `${ev.clientX + 12}px`;
    ghost.style.top = `${ev.clientY + 12}px`;
    highlight(dropTargetAt(ev.clientX, ev.clientY));
  };
  const end = (ev: PointerEvent, dropped: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    highlight(null);
    const started = ghost !== null;
    ghost?.remove();
    document.body.classList.remove("is-dragging-path");
    if (started && dropped) deliverDrop(drag, dropTargetAt(ev.clientX, ev.clientY));
  };
  const up = (ev: PointerEvent) => end(ev, true);
  const cancel = (ev: PointerEvent) => end(ev, false);
  const escape = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") end(new PointerEvent("pointercancel"), false);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
}
