/** Split-pane layout of one tab (S11.1-S11.2): a binary tree whose leaves are terminal panes. */

/** "row" places the two halves side by side, "column" stacks them. */
export type SplitDirection = "row" | "column";
export type FocusDirection = "left" | "right" | "up" | "down";

export type PaneLayout =
  | { kind: "pane"; id: string }
  | { kind: "split"; id: string; direction: SplitDirection; ratio: number; a: PaneLayout; b: PaneLayout };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_PANES = 4;
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

export const leaf = (id: string): PaneLayout => ({ kind: "pane", id });

export const clampRatio = (ratio: number) =>
  Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 0.5;

/** Pane ids in visual order (left to right, top to bottom within each split). */
export function paneIds(layout: PaneLayout): string[] {
  return layout.kind === "pane" ? [layout.id] : [...paneIds(layout.a), ...paneIds(layout.b)];
}

/** Rebuilds only the path to the changed node so untouched subtrees keep their identity. */
function mapNode(layout: PaneLayout, id: string, fn: (node: PaneLayout) => PaneLayout | null): PaneLayout | null {
  if (layout.id === id) return fn(layout);
  if (layout.kind === "pane") return layout;
  const a = mapNode(layout.a, id, fn);
  const b = mapNode(layout.b, id, fn);
  if (a === layout.a && b === layout.b) return layout;
  if (a === null) return b;
  if (b === null) return a;
  return { ...layout, a, b };
}

/**
 * Splits a pane in two halves; the new pane goes right of (row) or below (column) the old one, or
 * left of it or above with `side` "before". Returns the same layout when the pane is unknown or
 * the tab already has MAX_PANES panes. The split node is identified as `split-<newId>`.
 */
export function splitPane(
  layout: PaneLayout,
  paneId: string,
  direction: SplitDirection,
  newId: string,
  side: "before" | "after" = "after",
): PaneLayout {
  const ids = paneIds(layout);
  if (ids.length >= MAX_PANES || !ids.includes(paneId) || ids.includes(newId)) return layout;
  return mapNode(layout, paneId, (node) => ({
    kind: "split",
    id: `split-${newId}`,
    direction,
    ratio: 0.5,
    a: side === "before" ? leaf(newId) : node,
    b: side === "before" ? node : leaf(newId),
  }))!;
}

/** Removes a pane; its sibling takes the parent's place. Returns null when the last pane closes. */
export function closePane(layout: PaneLayout, paneId: string): PaneLayout | null {
  if (!paneIds(layout).includes(paneId)) return layout;
  return mapNode(layout, paneId, () => null);
}

/** The layout on screen with `hidden` panes out of sight: as if closed; the whole layout if all would be. */
export function shownLayout(layout: PaneLayout, hidden: readonly string[]): PaneLayout {
  return hidden.reduce<PaneLayout | null>((l, id) => l && closePane(l, id), layout) ?? layout;
}

/** Sets the ratio of one split, clamped to MIN_RATIO-MAX_RATIO. */
export function setRatio(layout: PaneLayout, splitId: string, ratio: number): PaneLayout {
  const clamped = clampRatio(ratio);
  return mapNode(layout, splitId, (node) =>
    node.kind === "split" && node.ratio !== clamped ? { ...node, ratio: clamped } : node,
  )!;
}

/** Calls `visit` for every node with the rectangle it occupies inside `rect`. */
function walk(layout: PaneLayout, rect: Rect, visit: (node: PaneLayout, rect: Rect) => void) {
  visit(layout, rect);
  if (layout.kind === "pane") return;
  const { x, y, w, h } = rect;
  if (layout.direction === "row") {
    const wa = w * layout.ratio;
    walk(layout.a, { x, y, w: wa, h }, visit);
    walk(layout.b, { x: x + wa, y, w: w - wa, h }, visit);
  } else {
    const ha = h * layout.ratio;
    walk(layout.a, { x, y, w, h: ha }, visit);
    walk(layout.b, { x, y: y + ha, w, h: h - ha }, visit);
  }
}

const UNIT: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Rectangle of every pane inside the unit square. */
export function paneRects(layout: PaneLayout): Record<string, Rect> {
  const rects: Record<string, Rect> = {};
  walk(layout, UNIT, (node, rect) => {
    if (node.kind === "pane") rects[node.id] = rect;
  });
  return rects;
}

export interface SplitBox {
  id: string;
  direction: SplitDirection;
  ratio: number;
  rect: Rect;
}

/** Every split with the rectangle it divides (used to place the draggable dividers). */
export function splitBoxes(layout: PaneLayout): SplitBox[] {
  const boxes: SplitBox[] = [];
  walk(layout, UNIT, (node, rect) => {
    if (node.kind === "split") boxes.push({ id: node.id, direction: node.direction, ratio: node.ratio, rect });
  });
  return boxes;
}

const EPS = 1e-9;

/**
 * The pane Alt+Arrow moves to: the closest pane in that direction that overlaps the current one
 * on the perpendicular axis; ties go to the larger overlap. Null at the edge.
 */
export function neighbour(layout: PaneLayout, paneId: string, direction: FocusDirection): string | null {
  const rects = paneRects(layout);
  const from = rects[paneId];
  if (!from) return null;
  const horizontal = direction === "left" || direction === "right";
  let best: { id: string; distance: number; overlap: number } | null = null;
  for (const [id, r] of Object.entries(rects)) {
    if (id === paneId) continue;
    const distance =
      direction === "right" ? r.x - (from.x + from.w)
      : direction === "left" ? from.x - (r.x + r.w)
      : direction === "down" ? r.y - (from.y + from.h)
      : from.y - (r.y + r.h);
    if (distance < -EPS) continue;
    const overlap = horizontal
      ? Math.min(from.y + from.h, r.y + r.h) - Math.max(from.y, r.y)
      : Math.min(from.x + from.w, r.x + r.w) - Math.max(from.x, r.x);
    if (overlap <= EPS) continue;
    if (
      !best ||
      distance < best.distance - EPS ||
      (Math.abs(distance - best.distance) <= EPS && overlap > best.overlap + EPS)
    ) {
      best = { id, distance, overlap };
    }
  }
  return best?.id ?? null;
}
