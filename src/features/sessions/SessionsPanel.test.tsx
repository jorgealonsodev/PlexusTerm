// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, libraryReducer, type SavedSession } from "./library";
import { SessionsPanel } from "./SessionsPanel";

const web: SavedSession = {
  id: "1",
  name: "web",
  folder: "Prod",
  host: "10.0.0.1",
  port: 22,
  username: "u",
  auth: { method: "agent" },
};
const library = libraryReducer(emptyLibrary, { type: "saveSession", session: web });

function renderPanel(overrides: Partial<Parameters<typeof SessionsPanel>[0]> = {}) {
  const props = {
    library,
    status: { state: "ready" as const },
    saveError: null,
    onOpen: vi.fn(),
    onNewSession: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onNewFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    ...overrides,
  };
  render(<SessionsPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("SessionsPanel", () => {
  it("opens a session on double-click and on Enter", () => {
    const props = renderPanel();
    const row = screen.getByTitle("u@10.0.0.1:22");
    fireEvent.doubleClick(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalledTimes(2);
    expect(props.onOpen).toHaveBeenCalledWith(web);
  });

  it("collapses a folder when its row is clicked", () => {
    renderPanel();
    fireEvent.click(screen.getByText("Prod"));
    expect(screen.queryByText("web")).toBeNull();
  });

  it("filters sessions by host", () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Search sessions"), { target: { value: "nomatch" } });
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("disables editing and explains why when the file could not be read", () => {
    renderPanel({ status: { state: "error", message: "bad json" } });
    expect(screen.getByText(/Editing is disabled/)).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });
});
