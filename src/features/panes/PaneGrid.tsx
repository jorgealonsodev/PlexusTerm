import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { paneIds, paneRects, shownLayout, splitBoxes, type PaneLayout, type Rect, type SplitBox } from "./paneLayout";

interface PaneGridProps {
  layout: PaneLayout;
  focusedPane: string;
  renderPane: (id: string) => ReactNode;
  onFocusPane: (id: string) => void;
  /** Raw ratio from a divider drag; the tabs reducer clamps it. */
  onResize: (splitId: string, ratio: number) => void;
  /**
   * Panes kept mounted (their sessions alive) but out of sight; the others fill the grid as if
   * these were closed. Ignored when it would hide every pane.
   */
  hidden?: readonly string[];
}

/** The grid's size in CSS pixels; null until measured (then positions fall back to percentages). */
type Size = { width: number; height: number } | null;

/**
 * A position along one axis: whole pixels once the grid is measured, so each pane edge sits on a
 * pixel and neighbours meet exactly (a 1px border at a fractional offset may not be drawn at all).
 */
const at = (fraction: number, total: number | undefined) =>
  total ? `${Math.round(fraction * total)}px` : `${fraction * 100}%`;

/** A length from `start` to `end` with the same rounding as `at`, so rounded edges stay shared. */
const span = (start: number, end: number, total: number | undefined) =>
  total ? `${Math.round(end * total) - Math.round(start * total)}px` : `${(end - start) * 100}%`;

const placement = ({ x, y, w, h }: Rect, size: Size): CSSProperties => ({
  left: at(x, size?.width),
  top: at(y, size?.height),
  width: span(x, x + w, size?.width),
  height: span(y, y + h, size?.height),
});

/** Where the divider of a split sits, as a thin bar across the split's rectangle. */
const dividerPlacement = ({ direction, ratio, rect }: SplitBox, size: Size): CSSProperties =>
  direction === "row"
    ? {
        left: at(rect.x + rect.w * ratio, size?.width),
        top: at(rect.y, size?.height),
        height: span(rect.y, rect.y + rect.h, size?.height),
      }
    : {
        top: at(rect.y + rect.h * ratio, size?.height),
        left: at(rect.x, size?.width),
        width: span(rect.x, rect.x + rect.w, size?.width),
      };

/**
 * Lays out the panes of one tab (S11.2).
 *
 * Every pane is a direct, keyed child of the same element and is positioned from its computed
 * rectangle, instead of nesting flex containers that follow the tree. Splitting or closing a pane
 * changes the tree shape, and with nested containers React would remount the other panes, which
 * would kill their terminal sessions; flat keyed siblings are only moved.
 */
export function PaneGrid({ layout, focusedPane, renderPane, onFocusPane, onResize, hidden = [] }: PaneGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<SplitBox | null>(null);
  const [size, setSize] = useState<Size>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = root.getBoundingClientRect();
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : width && height ? { width, height } : null));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, []);
  // The layout on screen: the hidden panes closed, their siblings taking their place.
  const shown = shownLayout(layout, hidden);
  const rects = paneRects(shown);
  const multiple = shown.kind === "split";

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = drag.current;
    const root = rootRef.current;
    if (!box || !root) return;
    const bounds = root.getBoundingClientRect();
    const ratio =
      box.direction === "row"
        ? (e.clientX - bounds.left - box.rect.x * bounds.width) / (box.rect.w * bounds.width)
        : (e.clientY - bounds.top - box.rect.y * bounds.height) / (box.rect.h * bounds.height);
    if (Number.isFinite(ratio)) onResize(box.id, ratio);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="pane-grid" ref={rootRef}>
      {paneIds(layout).map((id) => (
        <div
          key={id}
          className={`pane${multiple ? " pane--split" : ""}${multiple && id === focusedPane ? " pane--focused" : ""}`}
          // Every pane of the tab stays mounted, in the same order, so none restarts.
          hidden={!rects[id]}
          style={rects[id] ? placement(rects[id], size) : undefined}
          data-pane-id={id}
          onMouseDown={() => onFocusPane(id)}
          onFocus={() => onFocusPane(id)}
        >
          {renderPane(id)}
        </div>
      ))}
      {splitBoxes(shown).map((box) => (
        <div
          key={box.id}
          role="separator"
          aria-orientation={box.direction === "row" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(box.ratio * 100)}
          className={`pane-divider pane-divider--${box.direction}`}
          style={dividerPlacement(box, size)}
          onPointerDown={(e) => {
            e.preventDefault();
            drag.current = box;
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ))}
    </div>
  );
}
