// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "./TabBar";
import { leaf } from "../panes/paneLayout";

afterEach(cleanup);

const tab = (key: string, title: string) => ({
  key,
  title,
  target: { type: "local" as const },
  layout: leaf(`${key}-p1`),
  focusedPane: `${key}-p1`,
});

describe("TabBar", () => {
  it("marks the tabs whose output is logged to a file", () => {
    render(
      <TabBar
        tabs={[tab("t1", "one"), tab("t2", "two")]}
        activeKey="t1"
        logging={new Set(["t2"])}
        onActivate={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );
    const marks = screen.getAllByLabelText("Logging to file");
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[role=tab]")?.textContent).toContain("two");
  });

  it("offers duplicate, close, close others, close to the right and duplicate on right click", () => {
    const handlers = {
      onClose: vi.fn(),
      onCloseOthers: vi.fn(),
      onCloseRight: vi.fn(),
      onCloseAll: vi.fn(),
      onDuplicate: vi.fn(),
    };
    render(
      <TabBar
        tabs={[tab("t1", "one"), tab("t2", "two"), tab("t3", "three")]}
        activeKey="t1"
        onActivate={() => {}}
        onNew={() => {}}
        {...handlers}
      />,
    );
    const menuOn = (title: string) => fireEvent.contextMenu(screen.getByTitle(title), { clientX: 5, clientY: 5 });
    menuOn("two");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Duplicate tab",
      "Close tab",
      "Close other tabs",
      "Close tabs to the right",
      "Close all tabs",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close other tabs" }));
    expect(handlers.onCloseOthers).toHaveBeenCalledWith("t2");
    menuOn("three");
    expect((screen.getByRole("menuitem", { name: "Close tabs to the right" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate tab" }));
    expect(handlers.onDuplicate).toHaveBeenCalledWith("t3");
    menuOn("one");
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
    expect(handlers.onClose).toHaveBeenCalledWith("t1");
    menuOn("one");
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tabs to the right" }));
    expect(handlers.onCloseRight).toHaveBeenCalledWith("t1");
    menuOn("one");
    fireEvent.click(screen.getByRole("menuitem", { name: "Close all tabs" }));
    expect(handlers.onCloseAll).toHaveBeenCalledTimes(1);
  });
});
