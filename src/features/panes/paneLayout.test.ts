import { describe, expect, it } from "vitest";
import {
  MAX_PANES,
  closePane,
  leaf,
  neighbour,
  paneIds,
  paneRects,
  setRatio,
  splitPane,
  type PaneLayout,
} from "./paneLayout";

/** p1 | (p2 / p3): p1 on the left, p2 above p3 on the right. */
const threePanes = (): PaneLayout =>
  splitPane(splitPane(leaf("p1"), "p1", "row", "p2"), "p2", "column", "p3");

describe("splitPane", () => {
  it("splits a pane in two halves, the new pane after the old one", () => {
    const layout = splitPane(leaf("p1"), "p1", "row", "p2");
    expect(layout).toMatchObject({ kind: "split", direction: "row", ratio: 0.5 });
    expect(paneIds(layout)).toEqual(["p1", "p2"]);
  });

  it("can put the new pane before the old one (left of it, or above)", () => {
    const layout = splitPane(leaf("p1"), "p1", "row", "p2", "before");
    expect(layout).toMatchObject({ kind: "split", direction: "row", ratio: 0.5 });
    expect(paneIds(layout)).toEqual(["p2", "p1"]);
    expect(paneRects(layout).p2.x).toBe(0);
  });

  it("splits a nested pane in place", () => {
    expect(paneIds(threePanes())).toEqual(["p1", "p2", "p3"]);
  });

  it(`refuses to grow a tab beyond ${MAX_PANES} panes`, () => {
    const four = splitPane(threePanes(), "p1", "column", "p4");
    expect(paneIds(four)).toHaveLength(4);
    expect(splitPane(four, "p4", "row", "p5")).toBe(four);
  });

  it("leaves the layout unchanged for an unknown pane", () => {
    const layout = leaf("p1");
    expect(splitPane(layout, "nope", "row", "p2")).toBe(layout);
  });
});

describe("closePane", () => {
  it("returns null when the last pane closes", () => {
    expect(closePane(leaf("p1"), "p1")).toBeNull();
  });

  it("lets the sibling take the parent's place", () => {
    const layout = threePanes();
    const closed = closePane(layout, "p2");
    expect(paneIds(closed!)).toEqual(["p1", "p3"]);
    expect(closed).toMatchObject({ kind: "split", direction: "row", b: { kind: "pane", id: "p3" } });
    expect(closePane(closePane(closed!, "p1")!, "p3")).toBeNull();
  });

  it("leaves the layout unchanged for an unknown pane", () => {
    const layout = threePanes();
    expect(closePane(layout, "nope")).toBe(layout);
  });
});

describe("setRatio", () => {
  it("changes the ratio of one split, clamped to 15%-85%", () => {
    const layout = threePanes();
    const inner = layout.kind === "split" ? layout.b : layout;
    const at = (l: PaneLayout | null) => (l?.kind === "split" && l.b.kind === "split" ? [l.ratio, l.b.ratio] : []);
    expect(at(setRatio(layout, inner.id, 0.3))).toEqual([0.5, 0.3]);
    expect(at(setRatio(layout, layout.id, 0.05))).toEqual([0.15, 0.5]);
    expect(at(setRatio(layout, layout.id, 0.99))).toEqual([0.85, 0.5]);
  });
});

describe("paneRects", () => {
  it("places panes in a unit square following the ratios", () => {
    const layout = setRatio(threePanes(), "split-p2", 0.25);
    expect(paneRects(layout)).toEqual({
      p1: { x: 0, y: 0, w: 0.25, h: 1 },
      p2: { x: 0.25, y: 0, w: 0.75, h: 0.5 },
      p3: { x: 0.25, y: 0.5, w: 0.75, h: 0.5 },
    });
  });
});

describe("neighbour", () => {
  it("moves focus to the closest overlapping pane in the direction", () => {
    const layout = threePanes();
    expect(neighbour(layout, "p1", "right")).toBe("p2");
    expect(neighbour(layout, "p3", "left")).toBe("p1");
    expect(neighbour(layout, "p2", "down")).toBe("p3");
    expect(neighbour(layout, "p3", "up")).toBe("p2");
  });

  it("returns null at the edge or for a single pane", () => {
    expect(neighbour(threePanes(), "p1", "left")).toBeNull();
    expect(neighbour(threePanes(), "p1", "up")).toBeNull();
    expect(neighbour(leaf("p1"), "p1", "right")).toBeNull();
  });

  it("ignores panes that do not overlap on the perpendicular axis", () => {
    // (p1 / p2) | (p3 / p4) with the right column split lower than the left one.
    let layout = splitPane(leaf("p1"), "p1", "row", "p3");
    layout = splitPane(layout, "p1", "column", "p2");
    layout = splitPane(layout, "p3", "column", "p4");
    layout = setRatio(layout, "split-p4", 0.8);
    expect(neighbour(layout, "p2", "right")).toBe("p3");
    expect(neighbour(layout, "p4", "left")).toBe("p2");
  });
});
