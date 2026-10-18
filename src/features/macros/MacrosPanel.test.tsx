// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Macro } from "./macros";
import { MacrosPanel } from "./MacrosPanel";

const deploy: Macro = { id: "m1", name: "Deploy", hotkey: 3, steps: [{ kind: "send", text: "make\\r" }] };
const login: Macro = { id: "m2", name: "Login", steps: [] };

function renderPanel(overrides: Partial<Parameters<typeof MacrosPanel>[0]> = {}) {
  const props = {
    list: { version: 1 as const, macros: [deploy, login] },
    status: { state: "ready" as const },
    saveError: null,
    canPlay: true,
    onPlay: vi.fn(),
    onNew: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<MacrosPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("MacrosPanel (S16.3)", () => {
  it("lists macros with their hotkey and filters them by name", () => {
    renderPanel();
    expect(screen.getByText("Deploy")).toBeTruthy();
    expect(screen.getByText("Ctrl+Alt+3")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search macros"), { target: { value: "log" } });
    expect(screen.queryByText("Deploy")).toBeNull();
    expect(screen.getByText("Login")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search macros"), { target: { value: "zzz" } });
    expect(screen.getByText("No macros match.")).toBeTruthy();
  });

  it("plays, edits, duplicates and deletes a macro", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Play Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Deploy" }));
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(props.onPlay).toHaveBeenCalledWith(deploy);
    expect(props.onEdit).toHaveBeenCalledWith(deploy);
    expect(props.onDuplicate).toHaveBeenCalledWith(deploy);
    expect(props.onDelete).toHaveBeenCalledWith(deploy);
    expect(props.onNew).toHaveBeenCalled();
  });

  it("disables playing without a terminal to play into", () => {
    renderPanel({ canPlay: false });
    expect((screen.getByRole("button", { name: "Play Deploy" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables editing when the file could not be read", () => {
    renderPanel({ status: { state: "error", message: "bad json" } });
    expect(screen.getByText(/Could not read saved macros: bad json/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Deploy" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Deploy" })).toBeNull();
  });
});

describe("MacrosPanel empty text", () => {
  const empty = { version: 1 as const, macros: [] };
  it("names the default recording shortcut", () => {
    renderPanel({ list: empty });
    expect(screen.getByText("No macros yet. Record one with Ctrl+Shift+R or create one with New.")).toBeTruthy();
  });

  it("names the user's recording shortcut, or the button when there is none", () => {
    renderPanel({ list: empty, recordShortcut: "Alt+R" });
    expect(screen.getByText("No macros yet. Record one with Alt+R or create one with New.")).toBeTruthy();
    cleanup();
    renderPanel({ list: empty, recordShortcut: "" });
    expect(screen.getByText("No macros yet. Record one with the Record macro button or create one with New.")).toBeTruthy();
  });
});
