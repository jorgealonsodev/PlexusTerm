// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "./DropdownMenu";

afterEach(cleanup);

const open = (items: Parameters<typeof DropdownMenu>[0]["items"]) => {
  render(<DropdownMenu button="More" title="More" items={items} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
};

describe("DropdownMenu", () => {
  it("runs the chosen item and closes", () => {
    const onSelect = vi.fn();
    open([{ label: "Serial…", onSelect }]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Serial…" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows an item's shortcut at its side, announced apart from its name", () => {
    open([{ label: "Split right", shortcut: "Ctrl+Shift+D", onSelect: vi.fn() }]);
    const item = screen.getByRole("menuitem", { name: "Split right" });
    expect(item.querySelector(".menu__shortcut")?.textContent).toBe("Ctrl+Shift+D");
    expect(item.getAttribute("aria-keyshortcuts")).toBe("Ctrl+Shift+D");
  });

  it("shows no shortcut for an item without one, ticked items included", () => {
    open([{ label: "Multi-exec", checked: true, onSelect: vi.fn() }]);
    const item = screen.getByRole("menuitemcheckbox", { name: "Multi-exec" });
    expect(item.querySelector(".menu__shortcut")).toBeNull();
    expect(item.hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});
