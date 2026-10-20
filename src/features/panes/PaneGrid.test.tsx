// @vitest-environment jsdom
import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePane, leaf, splitPane, type PaneLayout } from "./paneLayout";
import { PaneGrid } from "./PaneGrid";

afterEach(cleanup);

const mounts: Record<string, number> = {};
const unmounts: Record<string, number> = {};

/** Stands in for a terminal: counts how often it is created and destroyed. */
function Probe({ id }: { id: string }) {
  useEffect(() => {
    mounts[id] = (mounts[id] ?? 0) + 1;
    return () => {
      unmounts[id] = (unmounts[id] ?? 0) + 1;
    };
  }, [id]);
  return <span>terminal {id}</span>;
}

const grid = (layout: PaneLayout, focusedPane: string, handlers: Partial<Parameters<typeof PaneGrid>[0]> = {}) => (
  <PaneGrid
    layout={layout}
    focusedPane={focusedPane}
    renderPane={(id) => <Probe id={id} />}
    onFocusPane={() => {}}
    onResize={() => {}}
    {...handlers}
  />
);

describe("PaneGrid", () => {
  it("renders one pane per leaf and highlights the focused one", () => {
    const layout = splitPane(leaf("p1"), "p1", "row", "p2");
    const { container } = render(grid(layout, "p2"));
    expect(screen.getByText("terminal p1")).toBeTruthy();
    expect(screen.getByText("terminal p2")).toBeTruthy();
    const focused = container.querySelectorAll(".pane--focused");
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toBe("terminal p2");
  });

  it("hides panes without unmounting them: the others fill the grid, and they come back as they were", () => {
    const layout = splitPane(splitPane(leaf("h1"), "h1", "row", "h2"), "h2", "column", "h3");
    const { container, rerender } = render(grid(layout, "h2", { hidden: ["h1", "h3"] }));
    const pane = (id: string) => container.querySelector<HTMLElement>(`.pane[data-pane-id="${id}"]`)!;
    const before = { h1: pane("h1"), h2: pane("h2"), h3: pane("h3") };
    expect(pane("h1").hidden).toBe(true);
    expect(pane("h3").hidden).toBe(true);
    expect(pane("h2").hidden).toBe(false);
    expect(pane("h2").style.width).toBe("100%");
    expect(pane("h2").style.height).toBe("100%");
    expect(pane("h2").classList.contains("pane--split")).toBe(false);
    expect(container.querySelectorAll(".pane-divider")).toHaveLength(0);
    rerender(grid(layout, "h2"));
    expect(pane("h1").hidden).toBe(false);
    expect(container.querySelectorAll(".pane-divider")).toHaveLength(2);
    expect({ h1: pane("h1"), h2: pane("h2"), h3: pane("h3") }).toEqual(before);
    expect(unmounts.h1 ?? 0).toBe(0);
    expect(unmounts.h3 ?? 0).toBe(0);
  });

  it("shows every pane when all of them would be hidden", () => {
    const { container } = render(grid(splitPane(leaf("q1"), "q1", "row", "q2"), "q1", { hidden: ["q1", "q2"] }));
    expect(container.querySelectorAll(".pane[hidden]")).toHaveLength(0);
  });

  it("focuses a pane on click", () => {
    const onFocusPane = vi.fn();
    render(grid(splitPane(leaf("p1"), "p1", "row", "p2"), "p2", { onFocusPane }));
    fireEvent.mouseDown(screen.getByText("terminal p1"));
    expect(onFocusPane).toHaveBeenCalledWith("p1");
  });

  it("splitting or closing a sibling never remounts the other panes", () => {
    for (const k of Object.keys(mounts)) delete mounts[k];
    for (const k of Object.keys(unmounts)) delete unmounts[k];
    const one = leaf("p1");
    const { rerender } = render(grid(one, "p1"));
    const two = splitPane(one, "p1", "row", "p2");
    rerender(grid(two, "p2"));
    const three = splitPane(two, "p1", "column", "p3");
    rerender(grid(three, "p3"));
    rerender(grid(closePane(three, "p2")!, "p3"));
    expect(mounts).toEqual({ p1: 1, p2: 1, p3: 1 });
    expect(unmounts).toEqual({ p2: 1 });
  });

  it("dragging a divider reports the new ratio of its split", () => {
    const onResize = vi.fn();
    const layout = splitPane(leaf("p1"), "p1", "row", "p2");
    const { container } = render(grid(layout, "p1", { onResize }));
    const root = container.querySelector(".pane-grid")!;
    root.getBoundingClientRect = () => ({ left: 100, top: 0, width: 400, height: 300 }) as DOMRect;
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 450 });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(layout.id, 0.25);
  });

  it("has no divider for a single pane", () => {
    render(grid(leaf("p1"), "p1"));
    expect(screen.queryByRole("separator")).toBeNull();
  });
});

describe("PaneGrid pixel snapping", () => {
  it("places panes and dividers on whole pixels, edge to edge, so 1px focus borders always show", () => {
    let notify: () => void = () => {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1001,
      height: 601,
      left: 0,
      top: 0,
      right: 1001,
      bottom: 601,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      const layout = splitPane(splitPane(leaf("p1"), "p1", "row", "p2"), "p2", "column", "p3");
      const { container } = render(grid(layout, "p3"));
      act(() => notify());
      const style = (id: string) => (container.querySelector(`[data-pane-id="${id}"]`) as HTMLElement).style;
      for (const id of ["p1", "p2", "p3"]) {
        for (const prop of ["left", "top", "width", "height"] as const) {
          expect(style(id)[prop], `${id} ${prop}`).toMatch(/^\d+px$/);
        }
      }
      const px = (v: string) => Number.parseInt(v, 10);
      expect(px(style("p1").width)).toBe(px(style("p2").left));
      expect(px(style("p2").left) + px(style("p2").width)).toBe(1001);
      expect(px(style("p2").top) + px(style("p2").height)).toBe(px(style("p3").top));
      expect(px(style("p3").top) + px(style("p3").height)).toBe(601);
      const divider = container.querySelector(".pane-divider--row") as HTMLElement;
      expect(divider.style.left).toMatch(/^\d+px$/);
    } finally {
      rect.mockRestore();
      globalThis.ResizeObserver = original;
    }
  });
});
