// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

const setup = (x = 10, y = 20) => {
  const onClose = vi.fn();
  const connect = vi.fn();
  const remove = vi.fn();
  render(
    <ContextMenu
      x={x}
      y={y}
      items={[
        { label: "Connect", onSelect: connect },
        { label: "Edit…", onSelect: vi.fn(), disabled: true },
        { separator: true },
        { label: "Delete", onSelect: remove, danger: true },
      ]}
      onClose={onClose}
    />,
  );
  return { onClose, connect, remove };
};

describe("ContextMenu", () => {
  it("runs the chosen item and closes", () => {
    const { onClose, connect } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Connect" }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows disabled items and separators without running them", () => {
    const { connect } = setup();
    expect((screen.getByRole("menuitem", { name: "Edit…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("focuses the first item and closes on Escape or a click outside", () => {
    const { onClose } = setup();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Connect" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens at the pointer and stays inside the window", () => {
    setup(30, 40);
    expect(screen.getByRole("menu").style.left).toBe("30px");
    expect(screen.getByRole("menu").style.top).toBe("40px");
    cleanup();
    setup(5000, 5000);
    expect(screen.getByRole("menu").style.left).toBe(`${window.innerWidth - 4}px`);
    expect(screen.getByRole("menu").style.top).toBe(`${window.innerHeight - 4}px`);
  });

  it("shows an item's shortcut at its side, announced apart from its name", () => {
    render(<ContextMenu x={0} y={0} items={[{ label: "Copy", shortcut: "Ctrl+Shift+C", onSelect: vi.fn() }]} onClose={vi.fn()} />);
    const item = screen.getByRole("menuitem", { name: "Copy" });
    expect(item.querySelector(".context-menu__shortcut")?.textContent).toBe("Ctrl+Shift+C");
    expect(item.getAttribute("aria-keyshortcuts")).toBe("Ctrl+Shift+C");
  });

  it("shows no shortcut for an item without one", () => {
    setup();
    expect(screen.getByRole("menuitem", { name: "Connect" }).querySelector(".context-menu__shortcut")).toBeNull();
  });
});
