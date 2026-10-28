// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolbarEditor, dropIndex } from "./ToolbarEditor";
import { DEFAULT_TOOLBAR_LAYOUT, whereIs, type ToolbarLayout } from "./toolbarLayout";

afterEach(cleanup);

function setup(layout: ToolbarLayout | null = null) {
  const onChange = vi.fn();
  render(<ToolbarEditor layout={layout} onChange={onChange} />);
  const last = (): ToolbarLayout | null => onChange.mock.calls.slice(-1)[0][0];
  return { onChange, last };
}

const chip = (name: string) => screen.getByRole("button", { name: `${name}: options` });

describe("ToolbarEditor", () => {
  it("shows the bar with its groups and an empty hidden area", () => {
    setup();
    const bar = screen.getByRole("group", { name: "Toolbar" });
    expect(within(bar).getByRole("button", { name: "SSH: options" })).toBeTruthy();
    const more = screen.getByRole("group", { name: "More" });
    expect(within(more).getAllByRole("button", { name: /: options$/ }).map((b) => b.textContent)).toEqual([
      "Telnet…",
      "Mosh…",
      "Open shared link…",
      "Play recording…",
      "Tab sets…",
    ]);
    expect(within(screen.getByRole("group", { name: "Hidden" })).queryAllByRole("button")).toEqual([]);
  });

  it("moves a button into a group, back to the bar and to hidden from its menu", () => {
    const { last } = setup();
    fireEvent.click(chip("SSH"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to “More”" }));
    expect(whereIs(last()!, "ssh")).toEqual({ zone: "more", index: 5 });

    cleanup();
    const second = setup(last());
    fireEvent.click(chip("SSH"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to the toolbar" }));
    expect(second.last()!.bar.slice(-1)[0]).toEqual({ kind: "action", id: "ssh" });

    cleanup();
    const third = setup();
    fireEvent.click(chip("Record macro"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide" }));
    expect(third.last()!.hidden).toEqual(["recordMacro"]);
  });

  it("moves a button left and right", () => {
    const { last } = setup();
    fireEvent.click(chip("SSH"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move left" }));
    expect(whereIs(last()!, "ssh")).toEqual({ zone: "bar", index: 1 });
    fireEvent.click(chip("Serial"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move right" }));
    expect(last()!.bar[4]).toEqual({ kind: "action", id: "serial" });
  });

  it("adds, renames and deletes groups, and resets the layout", () => {
    const { last, onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    const added = last()!.bar.slice(-1)[0];
    expect(added).toMatchObject({ kind: "group", name: "Group 3", items: [] });

    cleanup();
    const second = setup(last());
    fireEvent.change(screen.getAllByRole("textbox", { name: "Group name" }).slice(-1)[0], { target: { value: "Remote" } });
    expect(second.last()!.bar.slice(-1)[0]).toMatchObject({ name: "Remote" });
    fireEvent.click(screen.getByRole("button", { name: "Delete the group “More”" }));
    expect(second.last()!.bar.map((e) => (e.kind === "action" ? e.id : e.id)).slice(3, 7)).toEqual([
      "serial",
      "telnet",
      "mosh",
      "openShared",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(second.last()).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps the default layout when nothing changes", () => {
    const { onChange } = setup(DEFAULT_TOOLBAR_LAYOUT);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("dropIndex", () => {
  const box = (left: number, top: number) => ({ left, right: left + 40, top, bottom: top + 20 });
  // Two rows: three items, then one.
  const boxes = [box(0, 0), box(50, 0), box(100, 0), box(0, 30)];

  it("counts the items before the pointer, row by row", () => {
    expect(dropIndex(boxes, 5, 10, false)).toBe(0);
    expect(dropIndex(boxes, 30, 10, false)).toBe(1);
    expect(dropIndex(boxes, 200, 10, false)).toBe(3);
    expect(dropIndex(boxes, 30, 40, false)).toBe(4);
    expect(dropIndex(boxes, 5, 40, false)).toBe(3);
    expect(dropIndex([], 5, 5, false)).toBe(0);
  });

  it("reads right to left in RTL", () => {
    expect(dropIndex(boxes, 135, 10, true)).toBe(0);
    expect(dropIndex(boxes, 5, 10, true)).toBe(3);
  });
});
