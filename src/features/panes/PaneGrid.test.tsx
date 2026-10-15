// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
