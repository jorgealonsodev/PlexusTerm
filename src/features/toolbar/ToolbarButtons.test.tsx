// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Columns2, Usb } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolbarButtons, type ToolbarSpecs } from "./ToolbarButtons";

afterEach(cleanup);

describe("ToolbarButtons", () => {
  it("shows a drop-down item's shortcut beside it (S6)", () => {
    const specs = {
      splitRight: { label: "Split right", shortcut: "Ctrl+Shift+D", icon: Columns2, onSelect: vi.fn() },
      serial: { label: "Serial…", icon: Usb, onSelect: vi.fn() },
    } as Partial<ToolbarSpecs> as ToolbarSpecs;
    render(
      <ToolbarButtons layout={{ bar: [{ kind: "group", id: "g", name: "Group", items: ["splitRight", "serial"] }], hidden: [] }} specs={specs} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    expect(screen.getByRole("menuitem", { name: "Split right" }).getAttribute("aria-keyshortcuts")).toBe("Ctrl+Shift+D");
    expect(screen.getByRole("menuitem", { name: "Split right" }).textContent).toBe("Split rightCtrl+Shift+D");
    expect(screen.getByRole("menuitem", { name: "Serial…" }).hasAttribute("aria-keyshortcuts")).toBe(false);
  });
});
