// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalContextMenu, type MenuAction } from "./TerminalContextMenu";

afterEach(cleanup);

const setup = (logging = false, recording = false) => {
  const onAction = vi.fn<(action: MenuAction) => void>();
  const onClose = vi.fn();
  render(
    <TerminalContextMenu x={40} y={60} logging={logging} recording={recording} onAction={onAction} onClose={onClose} />,
  );
  return { onAction, onClose };
};

describe("TerminalContextMenu", () => {
  it("lists the terminal actions at the pointer position", () => {
    setup();
    const labels = screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label") ?? item.textContent);
    expect(labels).toEqual([
      "Copy",
      "Paste",
      "Select all",
      "Clear scrollback",
      "Find…",
      "Save output to file…",
      "Log to file…",
      "Record session…",
    ]);
    const menu = screen.getByRole("menu");
    expect(menu.style.left).toBe("40px");
    expect(menu.style.top).toBe("60px");
  });

  it("runs the chosen action and closes", () => {
    const { onAction, onClose } = setup();
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear scrollback" }));
    expect(onAction).toHaveBeenCalledWith("clear");
    expect(onClose).toHaveBeenCalled();
  });

  it("offers to stop logging while the pane is logged", () => {
    const { onAction } = setup(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop logging" }));
    expect(onAction).toHaveBeenCalledWith("log");
  });

  it("offers to stop recording while the pane is recorded (S6)", () => {
    const { onAction } = setup(false, true);
    expect(screen.getByRole("menuitem", { name: "Log to file…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop recording" }));
    expect(onAction).toHaveBeenCalledWith("record");
  });

  it("closes on Escape and on a click outside", () => {
    const { onClose, onAction } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows each action's shortcut beside it, apart from its name (S6)", () => {
    render(
      <TerminalContextMenu x={0} y={0} logging={false} selection="ls" commandOutput onAction={vi.fn()} onClose={vi.fn()} />,
    );
    const copy = screen.getByRole("menuitem", { name: "Copy" });
    expect(copy.textContent).toBe("CopyCtrl+Shift+C");
    expect(copy.getAttribute("aria-keyshortcuts")).toBe("Ctrl+Shift+C");
    expect(screen.getByRole("menuitem", { name: "Paste" }).textContent).toBe("PasteCtrl+Shift+V");
    expect(screen.getByRole("menuitem", { name: "Find…" }).textContent).toBe("Find…Ctrl+Shift+F");
  });

  it("shows the user's own shortcuts and nothing for an unbound action (S6)", () => {
    render(
      <TerminalContextMenu
        x={0}
        y={0}
        logging={false}
        shortcuts={{ paste: "Alt+V", find: "", clear: "Ctrl+Shift+K", toggleLogging: "Ctrl+Shift+L" }}
        onAction={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "Paste" }).textContent).toBe("PasteAlt+V");
    expect(screen.getByRole("menuitem", { name: "Clear scrollback" }).textContent).toBe("Clear scrollbackCtrl+Shift+K");
    expect(screen.getByRole("menuitem", { name: "Log to file…" }).textContent).toBe("Log to file…Ctrl+Shift+L");
    const find = screen.getByRole("menuitem", { name: "Find…" });
    expect(find.textContent).toBe("Find…");
    expect(find.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(screen.getByRole("menuitem", { name: "Select all" }).textContent).toBe("Select all");
  });
});
