// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { SavedSession } from "../sessions/library";
import type { Tunnel, TunnelStatus } from "./tunnels";
import { useTunnelLauncher } from "./useTunnelLauncher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const passwordSession: SavedSession = {
  id: "s1",
  name: "bastion",
  folder: "",
  host: "10.0.0.1",
  port: 22,
  username: "u",
  auth: { method: "password" },
};
const agentSession: SavedSession = { ...passwordSession, auth: { method: "agent" } };
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

type Launcher = ReturnType<typeof useTunnelLauncher>;

interface HarnessProps {
  sessions: SavedSession[];
  tunnels: Tunnel[];
  reportError: (id: string, message: string) => void;
  onLauncher: (launcher: Launcher) => void;
}

const stopped = (): TunnelStatus => ({ state: "stopped" });

function Harness({ sessions, tunnels, reportError, onLauncher }: HarnessProps) {
  const launcher = useTunnelLauncher(sessions, stopped, reportError, tunnels);
  onLauncher(launcher);
  return <>{launcher.dialog}</>;
}

function setup(sessions: SavedSession[], tunnels: Tunnel[]) {
  let launcher: Launcher | undefined;
  const reportError = vi.fn();
  const props = { sessions, reportError, onLauncher: (l: Launcher) => (launcher = l) };
  const view = render(<Harness {...props} tunnels={tunnels} />);
  return {
    reportError,
    launcher: () => launcher!,
    setTunnels: (next: Tunnel[]) => view.rerender(<Harness {...props} tunnels={next} />),
  };
}

const startCalls = () => mockedInvoke.mock.calls.filter(([command]) => command === "tunnel_start");

const unknownHost = {
  kind: "unknownHost",
  host: "10.0.0.1:22",
  fingerprint: "SHA256:abc",
  otherKnownKeys: [],
};

beforeEach(() => {
  mockedInvoke.mockReset();
});

afterEach(cleanup);

describe("useTunnelLauncher", () => {
  it("does not start a tunnel deleted while its password prompt was open", async () => {
    const { launcher, setTunnels } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    setTunnels([]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(0);
  });

  it("does not start a tunnel edited into another definition while its password prompt was open", async () => {
    const { launcher, setTunnels } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    setTunnels([{ ...db, listenPort: 6000 }]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(0);
  });

  it("starts the tunnel after the password prompt when it is unchanged", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const { launcher, setTunnels } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    setTunnels([{ ...db }]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(1);
  });

  it("does not retry a tunnel deleted while the host key prompt was open", async () => {
    mockedInvoke.mockRejectedValueOnce(unknownHost);
    const { launcher, setTunnels } = setup([agentSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    await screen.findByText("Trust and connect");
    setTunnels([]);
    fireEvent.click(screen.getByText("Trust and connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(1);
  });

  it("reports a start failure that never reached the tunnel manager", async () => {
    mockedInvoke.mockRejectedValueOnce("invalid args `tunnel` for command `tunnel_start`");
    const { launcher, reportError } = setup([agentSession], [db]);
    await act(() => launcher().start(db));
    expect(reportError).toHaveBeenCalledWith("t1", expect.stringContaining("invalid args"));
  });

  it("leaves failures the backend already shows as the tunnel status alone", async () => {
    mockedInvoke.mockRejectedValueOnce({ kind: "listen", message: "cannot listen on 127.0.0.1:5433" });
    const { launcher, reportError } = setup([agentSession], [db]);
    await act(() => launcher().start(db));
    expect(reportError).not.toHaveBeenCalled();
  });
});
