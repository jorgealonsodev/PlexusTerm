import { useLayoutEffect, useState, type RefObject } from "react";

/** Narrowest visible part of a cut label worth showing, in pixels (about four letters). */
export const MIN_LABEL_WIDTH = 32;

export interface CompactState {
  /** Labels hidden: the toolbar shows icons only. */
  compact: boolean;
  /** Toolbar width at which the labels stopped fitting. */
  enteredAt: number | null;
}

/**
 * Labels shrink with an ellipsis first (CSS); when even the shortest labels overflow, the
 * toolbar shows icons only until it is wider than where that happened, so it never flips
 * back and forth at one width.
 */
export function nextCompact(state: CompactState, { width, overflowing }: { width: number; overflowing: boolean }) {
  if (!state.compact) return overflowing ? { compact: true, enteredAt: width } : state;
  return state.enteredAt !== null && width > state.enteredAt ? { compact: false, enteredAt: null } : state;
}

/** Whether the toolbar in `ref` must show icons only, following its width. */
export function useCompactToolbar(ref: RefObject<HTMLElement | null>): boolean {
  const [state, setState] = useState<CompactState>({ compact: false, enteredAt: null });
  // Measured after every render too: leaving icon-only mode may overflow again.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Each button may shrink to its icon plus the start of its label (all of a short one).
      if (!el.classList.contains("toolbar--compact")) {
        for (const label of el.querySelectorAll<HTMLElement>(".btn__label")) {
          const button = label.closest<HTMLElement>(".btn")!;
          const chrome = button.offsetWidth - label.clientWidth;
          // +1: scrollWidth rounds the text width down, and a fraction of a pixel short shows "…".
          button.style.setProperty("--btn-min", `${chrome + Math.min(label.scrollWidth + 1, MIN_LABEL_WIDTH)}px`);
        }
      }
      setState((s) => nextCompact(s, { width: el.clientWidth, overflowing: el.scrollWidth > el.clientWidth + 1 }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, state.compact]);
  return state.compact;
}
