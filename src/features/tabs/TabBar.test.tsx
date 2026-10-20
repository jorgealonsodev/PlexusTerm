// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it("marks the tabs in DEV mode (S10)", () => {
    render(
      <TabBar
        tabs={[tab("t1", "one"), tab("t2", "two")]}
        activeKey="t1"
        dev={new Set(["t2"])}
        onActivate={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );
    const marks = screen.getAllByRole("img", { name: "DEV mode" });
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[role=tab]")?.textContent).toContain("two");
    // The same icon as the DEV button, not text.
    expect(marks[0].querySelector("svg")).not.toBeNull();
    expect(marks[0].textContent).toBe("");
  });

  it("stays a row of tabs on top unless asked for the column (S13)", () => {
    const { container } = render(
      <TabBar tabs={[tab("t1", "one")]} activeKey="t1" onActivate={() => {}} onClose={() => {}} onNew={() => {}} />,
    );
    expect(container.querySelector(".tabbar")?.classList.contains("tabbar--column")).toBe(false);
    expect(container.querySelector(".cli-icon")).toBeNull();
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBeNull();
  });

  describe("DEV tab column (S13)", () => {
    it("shows a tab that hides terminals as one row per terminal, the one on screen as the tab", () => {
      const onShowPane = vi.fn();
      const onActivate = vi.fn();
      const onClosePane = vi.fn();
      const onClose = vi.fn();
      const { container } = render(
        <TabBar
          tabs={[tab("t1", "one"), tab("t2", "two")]}
          activeKey="t1"
          column
          dev={new Set(["t1"])}
          hiddenPanes={
            new Map([
              [
                "t1",
                [
                  { id: "t1-p1", title: "Terminal 1", folder: null, shown: false },
                  { id: "t1-p2", title: "me@box: ~/api", folder: "api", shown: true },
                  { id: "t1-p3", title: "Terminal 3", folder: null, shown: false },
                ],
              ],
            ])
          }
          onShowPane={onShowPane}
          onClosePane={onClosePane}
          onActivate={onActivate}
          onClose={onClose}
          onNew={() => {}}
        />,
      );
      // Three terminals, three rows (no extra row for the tab), then the other tab.
      const rows = [...container.querySelectorAll<HTMLElement>(".tab--row")];
      expect(rows.map((r) => r.querySelector(".tab__title")?.textContent)).toEqual(["Terminal 1", "me@box: ~/api", "Terminal 3", "two"]);
      expect(rows.map((r) => r.classList.contains("tab--active"))).toEqual([false, true, false, false]);
      expect(screen.getAllByRole("tab").map((r) => r.querySelector(".tab__title")?.textContent)).toEqual(["me@box: ~/api", "two"]);
      expect(rows[1].querySelector(".tab__folder")?.textContent).toBe("api");
      expect(within(rows[1]).getByLabelText("DEV mode")).toBeTruthy();
      expect(within(rows[0]).queryByLabelText("DEV mode")).toBeNull();
      fireEvent.mouseDown(rows[1], { button: 0 });
      expect(onShowPane).not.toHaveBeenCalled();
      fireEvent.mouseDown(rows[2], { button: 0 });
      expect(onShowPane).toHaveBeenCalledWith("t1", "t1-p3");
      expect(onActivate).toHaveBeenCalledWith("t1");
      fireEvent.click(within(rows[0]).getByRole("button", { name: "Close Terminal 1" }));
      fireEvent.click(within(rows[1]).getByRole("button", { name: "Close me@box: ~/api" }));
      expect(onClosePane.mock.calls).toEqual([
        ["t1", "t1-p1"],
        ["t1", "t1-p2"],
      ]);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("lists no hidden terminals outside the column", () => {
      render(
        <TabBar
          tabs={[tab("t1", "one")]}
          activeKey="t1"
          hiddenPanes={new Map([["t1", [{ id: "t1-p2", title: "Terminal 2", folder: null, shown: false }]]])}
          onShowPane={() => {}}
          onActivate={() => {}}
          onClose={() => {}}
          onNew={() => {}}
        />,
      );
      expect(screen.queryByText("Terminal 2")).toBeNull();
    });

    const details = new Map([
      ["t1", { cli: "claude", folder: "plexusterm" }],
      ["t2", { cli: "codex", folder: "api" }],
      ["t3", { cli: null, folder: null }],
    ]);
    const renderColumn = (props: Partial<Parameters<typeof TabBar>[0]> = {}) =>
      render(
        <TabBar
          tabs={[tab("t1", "one"), tab("t2", "two"), tab("t3", "three")]}
          activeKey="t2"
          column
          details={details}
          onActivate={() => {}}
          onClose={() => {}}
          onNew={() => {}}
          {...props}
        />,
      );

    it("lists one row per tab with its CLI's icon, title and project folder", () => {
      const { container } = renderColumn();
      expect(container.querySelector(".tabbar--column")).not.toBeNull();
      expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
      const rows = screen.getAllByRole("tab");
      expect(rows).toHaveLength(3);
      expect(rows[0].querySelector(".cli-icon--claude")).not.toBeNull();
      expect(rows[0].querySelector(".tab__folder")?.textContent).toBe("plexusterm");
      expect(rows[1].querySelector(".cli-icon--codex")).not.toBeNull();
      expect(rows[2].querySelector(".cli-icon--terminal")).not.toBeNull();
      expect(rows[2].querySelector(".tab__folder")).toBeNull();
      expect(rows[0].textContent).toContain("one");
    });

    it("drops the CLI's own mark from the title when its icon is shown", () => {
      render(
        <TabBar
          tabs={[tab("t1", "π - daily-work"), tab("t2", "✳ Claude Code"), tab("t3", "π - notes"), tab("t4", "π"), tab("t5", "π - work")]}
          activeKey="t1"
          column
          details={new Map([
            ["t1", { cli: "pi", folder: "daily-work" }],
            ["t2", { cli: "claude", folder: "app" }],
            ["t3", { cli: null, folder: null }],
            ["t4", { cli: "gentle-shell", folder: "app" }],
            ["t5", { cli: "gentle-shell", folder: "app" }],
          ])}
          onActivate={() => {}}
          onClose={() => {}}
          onNew={() => {}}
        />,
      );
      const rows = screen.getAllByRole("tab");
      const title = (row: HTMLElement) => row.querySelector(".tab__title")?.textContent ?? null;
      // A title that only names the CLI is left out: the icon says it, the folder follows.
      expect(rows.map(title)).toEqual(["daily-work", null, "π - notes", null, "work"]);
      expect(rows[1].querySelector(".cli-icon--claude")).not.toBeNull();
      expect(rows[1].querySelector(".tab__folder")?.textContent).toBe("app");
      // The tooltip and the close button still name the tab.
      expect(within(rows[1]).getByRole("button", { name: /✳ Claude Code/ })).toBeTruthy();
    });

    it("marks the active row and activates a row on click", () => {
      const onActivate = vi.fn();
      renderColumn({ onActivate });
      const rows = screen.getAllByRole("tab");
      expect(rows.map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
      expect(rows[1].classList.contains("tab--active")).toBe(true);
      fireEvent.mouseDown(rows[0], { button: 0 });
      expect(onActivate).toHaveBeenCalledWith("t1");
    });

    it("closes a tab with the button at the end of its row and with a middle click", () => {
      const onClose = vi.fn();
      renderColumn({ onClose });
      const rows = screen.getAllByRole("tab");
      const close = screen.getByRole("button", { name: "Close one" });
      expect(rows[0].lastElementChild).toBe(close);
      fireEvent.click(close);
      expect(onClose).toHaveBeenCalledWith("t1");
      fireEvent.mouseDown(rows[2], { button: 1 });
      expect(onClose).toHaveBeenCalledWith("t3");
    });

    it("keeps the attention and logging marks and the right-click menu", () => {
      renderColumn({ attention: new Set(["t1"]), logging: new Set(["t3"]), onDuplicate: () => {} });
      expect(screen.getByLabelText("Needs attention").closest("[role=tab]")?.textContent).toContain("one");
      expect(screen.getByLabelText("Logging to file").closest("[role=tab]")?.textContent).toContain("three");
      fireEvent.contextMenu(screen.getAllByRole("tab")[1], { clientX: 1, clientY: 1 });
      expect(screen.getByText("Duplicate tab")).toBeTruthy();
    });
  });

  describe("resizable DEV tab column", () => {
    const columnAt = (right: number) =>
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        left: right - 220,
        right,
        top: 0,
        bottom: 300,
        width: 220,
        height: 300,
        x: right - 220,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const renderResizable = (props: Partial<Parameters<typeof TabBar>[0]> = {}) =>
      render(
        <TabBar
          tabs={[tab("t1", "one")]}
          activeKey="t1"
          column
          onActivate={() => {}}
          onClose={() => {}}
          onNew={() => {}}
          {...props}
        />,
      );
    const handle = () => screen.getByRole("separator", { name: "Resize the tab column" });
    const list = () => screen.getByRole("tablist");

    afterEach(() => vi.restoreAllMocks());

    it("drags its left edge to a new width, within 140..480 px, saved when the drag ends", () => {
      columnAt(1000);
      const onColumnWidthChange = vi.fn();
      renderResizable({ onColumnWidthChange });
      expect(list().style.width).toBe("");
      fireEvent.pointerDown(handle(), { pointerId: 1, clientX: 780 });
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 700 });
      expect(list().style.width).toBe("300px");
      expect(onColumnWidthChange).not.toHaveBeenCalled();
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 });
      expect(list().style.width).toBe("480px");
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 990 });
      expect(list().style.width).toBe("140px");
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 990 });
      expect(onColumnWidthChange).toHaveBeenCalledWith(140);
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 500 });
      expect(onColumnWidthChange).toHaveBeenCalledTimes(1);
    });

    it("starts at the remembered width and goes back to the default on a double-click", () => {
      const onColumnWidthChange = vi.fn();
      renderResizable({ columnWidth: 320, onColumnWidthChange });
      expect(list().style.width).toBe("320px");
      fireEvent.doubleClick(handle());
      expect(onColumnWidthChange).toHaveBeenCalledWith(null);
    });

    it("has no handle on the top tab bar", () => {
      render(<TabBar tabs={[tab("t1", "one")]} activeKey="t1" onActivate={() => {}} onClose={() => {}} onNew={() => {}} />);
      expect(screen.queryByRole("separator")).toBeNull();
    });
  });
});

describe("tab colours", () => {
  const coloured = [{ ...tab("t1", "one"), color: "#c0392b" }, tab("t2", "two")];

  it("picks a tab's colour from its menu, and clears it", () => {
    const onColor = vi.fn();
    render(<TabBar tabs={coloured} activeKey="t1" onActivate={() => {}} onClose={() => {}} onNew={() => {}} onColor={onColor} />);
    fireEvent.contextMenu(screen.getAllByRole("tab")[1], { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Tab colour…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Blue" }));
    expect(onColor).toHaveBeenCalledWith("t2", "#2e86de");
    fireEvent.contextMenu(screen.getAllByRole("tab")[0], { clientX: 1, clientY: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Tab colour…" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "No colour" }));
    expect(onColor).toHaveBeenCalledWith("t1", null);
  });

  it("shows the colour on the tab on top and on the DEV row", () => {
    const { unmount } = render(<TabBar tabs={coloured} activeKey="t2" onActivate={() => {}} onClose={() => {}} onNew={() => {}} />);
    const [one, two] = screen.getAllByRole("tab");
    expect(one.style.getPropertyValue("--tab-color")).toBe("#c0392b");
    expect(one.classList.contains("tab--coloured")).toBe(true);
    expect(two.classList.contains("tab--coloured")).toBe(false);
    unmount();
    render(<TabBar tabs={coloured} activeKey="t2" column onActivate={() => {}} onClose={() => {}} onNew={() => {}} />);
    expect(screen.getAllByRole("tab")[0].classList.contains("tab--coloured")).toBe(true);
  });

  it("offers no colour item without a handler", () => {
    render(<TabBar tabs={coloured} activeKey="t1" onActivate={() => {}} onClose={() => {}} onNew={() => {}} />);
    fireEvent.contextMenu(screen.getAllByRole("tab")[0], { clientX: 1, clientY: 1 });
    expect(screen.queryByRole("menuitem", { name: "Tab colour…" })).toBeNull();
  });
});

