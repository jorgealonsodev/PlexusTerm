// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SavedSession } from "../sessions/library";
import type { Tunnel, TunnelStatus } from "./tunnels";
import { TunnelsPanel } from "./TunnelsPanel";

const session: SavedSession = {
  id: "s1",
  name: "bastion",
  folder: "",
  host: "10.0.0.1",
  port: 22,
  username: "u",
  auth: { method: "agent" },
};
const db: Tunnel = {
  id: "t1",
  name: "db",
  type: "local",
  sessionId: "s1",
  listenHost: "127.0.0.1",
  listenPort: 5433,
  destHost: "db",
  destPort: 5432,
};

function renderPanel(status: TunnelStatus, overrides: Partial<Parameters<typeof TunnelsPanel>[0]> = {}) {
  const props = {
    list: { version: 1 as const, tunnels: [db] },
    status: { state: "ready" as const },
    saveError: null,
    sessions: [session],
    statusOf: () => status,
    onToggle: vi.fn(),
    onNew: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onStartAll: vi.fn(),
    onStopAll: vi.fn(),
    ...overrides,
  };
  render(<TunnelsPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("TunnelsPanel", () => {
  it("shows each tunnel with its route, session and a Start toggle while stopped", () => {
    const props = renderPanel({ state: "stopped" });
    expect(screen.getByText("L 127.0.0.1:5433 → db:5432 · bastion")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Stopped" })).toBeTruthy();
    fireEvent.click(screen.getByText("Start"));
    expect(props.onToggle).toHaveBeenCalledWith(db);
  });

  it("shows the warning of a running tunnel", () => {
    renderPanel({ state: "running", warning: "The password could not be saved in the system keyring: locked" });
    expect(screen.getByText("Stop")).toBeTruthy();
    expect(screen.getByText("The password could not be saved in the system keyring: locked")).toBeTruthy();
  });

  it("offers Stop while running and shows error messages", () => {
    renderPanel({ state: "running" });
    expect(screen.getByText("Stop")).toBeTruthy();
    cleanup();
    renderPanel({ state: "error", message: "cannot listen on 127.0.0.1:5433: the port is already in use" });
    expect(screen.getByRole("alert").textContent).toContain("already in use");
    expect(screen.getByText("Start")).toBeTruthy();
  });

  it("disables editing when the file could not be read", () => {
    renderPanel({ state: "stopped" }, { status: { state: "error", message: "bad json" } });
    expect(screen.getByText(/Editing is disabled/)).toBeTruthy();
    expect(screen.queryByText("New")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });
});
