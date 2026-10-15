import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { paneIds, paneRects, splitBoxes, type PaneLayout, type Rect, type SplitBox } from "./paneLayout";

interface PaneGridProps {
  layout: PaneLayout;
  focusedPane: string;
  renderPane: (id: string) => ReactNode;
  onFocusPane: (id: string) => void;
  /** Raw ratio from a divider drag; the tabs reducer clamps it. */
  onResize: (splitId: string, ratio: number) => void;
}

const pct = (value: number) => `${value * 100}%`;

const placement = ({ x, y, w, h }: Rect): CSSProperties => ({
  left: pct(x),
  top: pct(y),
  width: pct(w),
  height: pct(h),
});

/** Where the divider of a split sits, as a thin bar across the split's rectangle. */
const dividerPlacement = ({ direction, ratio, rect }: SplitBox): CSSProperties =>
  direction === "row"
    ? { left: pct(rect.x + rect.w * ratio), top: pct(rect.y), height: pct(rect.h) }
    : { top: pct(rect.y + rect.h * ratio), left: pct(rect.x), width: pct(rect.w) };

/**
 * Lays out the panes of one tab (S11.2).
 *
 * Every pane is a direct, keyed child of the same element and is positioned from its computed
 * rectangle, instead of nesting flex containers that follow the tree. Splitting or closing a pane
 * changes the tree shape, and with nested containers React would remount the other panes, which
 * would kill their terminal sessions; flat keyed siblings are only moved.
 */
export function PaneGrid({ layout, focusedPane, renderPane, onFocusPane, onResize }: PaneGridProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<SplitBox | null>(null);
  const rects = paneRects(layout);
  const multiple = layout.kind === "split";

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
          style={placement(rects[id])}
          data-pane-id={id}
          onMouseDown={() => onFocusPane(id)}
          onFocus={() => onFocusPane(id)}
        >
          {renderPane(id)}
        </div>
      ))}
      {splitBoxes(layout).map((box) => (
        <div
          key={box.id}
          role="separator"
          aria-orientation={box.direction === "row" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(box.ratio * 100)}
          className={`pane-divider pane-divider--${box.direction}`}
          style={dividerPlacement(box)}
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
