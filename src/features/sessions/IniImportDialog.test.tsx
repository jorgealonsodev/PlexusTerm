// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedSession } from "./library";
import { IniImportDialog } from "./IniImportDialog";

const imported: SavedSession = {
  id: "n1",
  name: "web",
  folder: "Imported",
  host: "web.example.com",
  port: 22,
  username: "deploy",
  auth: { method: "password" },
};

afterEach(cleanup);

describe("IniImportDialog", () => {
  it("previews the counts and imports on confirm", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <IniImportDialog
        result={{ ok: true, plan: { toAdd: [imported], duplicates: 2, skipped: { RDP: 3, invalid: 1 } } }}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("1 session to import.")).toBeTruthy();
    expect(screen.getByText("2 duplicates already saved will be skipped.")).toBeTruthy();
    expect(screen.getByText("RDP sessions: 3")).toBeTruthy();
    expect(screen.getByText("Sessions without a host: 1")).toBeTruthy();
    expect(screen.getByText(/Passwords are not imported/)).toBeTruthy();
    fireEvent.click(screen.getByText("Import 1 session"));
    expect(onConfirm).toHaveBeenCalledWith([imported]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("only offers Close when there is nothing to import", () => {
    render(
      <IniImportDialog
        result={{ ok: true, plan: { toAdd: [], duplicates: 0, skipped: {} } }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No sessions to import.")).toBeTruthy();
    expect(screen.getByText("Close")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("shows a read error", () => {
    render(<IniImportDialog result={{ ok: false, error: "boom" }} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("boom");
    expect(screen.getByText("Close")).toBeTruthy();
  });
});
