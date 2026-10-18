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
  chats: {},
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


  it("marks the tabs that need attention", () => {
    render(
      <TabBar
        tabs={[tab("t1", "one"), tab("t2", "two")]}
        activeKey="t1"
        attention={new Set(["t2"])}
        onActivate={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );
    const marks = screen.getAllByRole("img", { name: "Needs attention" });
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[role=tab]")?.textContent).toContain("two");
    expect(marks[0].closest("[role=tab]")?.className).toContain("tab--attention");
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

  it("copies the host address of SSH, Telnet and Mosh tabs, and offers nothing to copy for others", () => {
    const onCopyHost = vi.fn();
    const ssh = { ...tab("t1", "web"), target: { type: "ssh" as const, host: "10.244.208.224", port: 22, username: "u", auth: { method: "agent" as const } } };
    const telnet = { ...tab("t2", "router"), target: { type: "telnet" as const, host: "192.168.1.1", port: 23 } };
    render(
      <TabBar tabs={[ssh, telnet, tab("t3", "local")]} activeKey="t1" onActivate={() => {}} onClose={() => {}} onNew={() => {}} onCopyHost={onCopyHost} />,
    );
    fireEvent.contextMenu(screen.getByTitle("web"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy host address (10.244.208.224)" }));
    expect(onCopyHost).toHaveBeenCalledWith("10.244.208.224");
    fireEvent.contextMenu(screen.getByTitle("router"), { clientX: 5, clientY: 5 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy host address (192.168.1.1)" }));
    expect(onCopyHost).toHaveBeenLastCalledWith("192.168.1.1");
    fireEvent.contextMenu(screen.getByTitle("local"), { clientX: 5, clientY: 5 });
    expect(screen.queryByRole("menuitem", { name: /Copy host address/ })).toBeNull();
  });
});

