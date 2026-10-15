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

interface StartArgs {
  target: { auth: unknown };
  storage: unknown;
}
const startArgs = (i: number) => startCalls()[i][1] as unknown as StartArgs;

const SAVE = "Save password in the system keyring";

/** Answers each command with its handler (undefined when none); a throw rejects. */
function fakeBackend(handlers: Record<string, () => unknown>) {
  mockedInvoke.mockImplementation(async (command: string) => handlers[command]?.());
}

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
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
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
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
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
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "pw" } });
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

  it("starts with the saved password, without prompting, when one exists", async () => {
    fakeBackend({ secret_exists: () => true });
    const { launcher } = setup([passwordSession], [db]);
    await act(() => launcher().start(db));
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(startCalls()).toHaveLength(1);
    expect(startArgs(0).target.auth).toEqual({ method: "storedPassword", sessionId: "s1" });
    expect(startArgs(0).storage).toBeNull();
  });

  it("saves the typed password when the checkbox is ticked", async () => {
    fakeBackend({ secret_exists: () => false, secret_available: () => true });
    const { launcher } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    const box = await screen.findByLabelText<HTMLInputElement>(SAVE);
    expect(box.checked).toBe(false);
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startArgs(0).target.auth).toEqual({ method: "password", password: "pw" });
    expect(startArgs(0).storage).toEqual({ action: "remember", sessionId: "s1", label: "NexusTerm: u@10.0.0.1:22" });
  });

  it("asks again with the checkbox ticked when the saved password is rejected, then replaces it", async () => {
    let attempts = 0;
    fakeBackend({
      secret_exists: () => true,
      secret_available: () => true,
      tunnel_start: () => {
        attempts += 1;
        if (attempts === 1) throw { kind: "authFailed" };
      },
    });
    const { launcher } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    const box = await screen.findByLabelText<HTMLInputElement>(SAVE);
    expect(box.checked).toBe(true);
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(2);
    expect(startArgs(1).target.auth).toEqual({ method: "password", password: "new" });
    expect(startArgs(1).storage).toMatchObject({ action: "remember", sessionId: "s1" });
  });

  it("forgets the saved password when the checkbox is unticked on the retry", async () => {
    let attempts = 0;
    fakeBackend({
      secret_exists: () => true,
      secret_available: () => true,
      tunnel_start: () => {
        attempts += 1;
        if (attempts === 1) throw { kind: "secretMissing" };
      },
    });
    const { launcher } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    const box = await screen.findByLabelText<HTMLInputElement>(SAVE);
    await vi.waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startArgs(1).storage).toEqual({ action: "forget", sessionId: "s1" });
  });

  it("does not ask again when a typed password is rejected", async () => {
    fakeBackend({
      secret_exists: () => false,
      tunnel_start: () => {
        throw { kind: "authFailed" };
      },
    });
    const { launcher } = setup([passwordSession], [db]);
    let started!: Promise<void>;
    act(() => {
      started = launcher().start(db);
    });
    fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "bad" } });
    fireEvent.click(screen.getByText("Connect"));
    await act(() => started);
    expect(startCalls()).toHaveLength(1);
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("leaves failures the backend already shows as the tunnel status alone", async () => {
    mockedInvoke.mockRejectedValueOnce({ kind: "listen", message: "cannot listen on 127.0.0.1:5433" });
    const { launcher, reportError } = setup([agentSession], [db]);
    await act(() => launcher().start(db));
    expect(reportError).not.toHaveBeenCalled();
  });

  describe("through jump hosts", () => {
    const gw: SavedSession = { ...passwordSession, id: "g1", name: "gw", host: "10.0.0.9", username: "j" };
    const target: SavedSession = { ...agentSession, jumpIds: ["g1"] };
    const gwJump = { name: "gw", host: "10.0.0.9", port: 22, username: "j" };
    const jumpsOf = (i: number) => (startArgs(i).target as { jumps?: unknown[] }).jumps;

    it("asks for each jump host password, naming the hop, and starts the tunnel through it", async () => {
      fakeBackend({ secret_exists: () => false });
      const { launcher } = setup([gw, target], [db]);
      let started!: Promise<void>;
      act(() => {
        started = launcher().start(db);
      });
      await screen.findByText("Password for gw — jump host 1 of 1");
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "jpw" } });
      fireEvent.click(screen.getByText("Connect"));
      await act(() => started);
      expect(startCalls()).toHaveLength(1);
      expect(startArgs(0).target.auth).toEqual({ method: "agent" });
      expect(jumpsOf(0)).toEqual([{ ...gwJump, auth: { method: "password", password: "jpw" } }]);
    });

    it("asks to trust an unknown jump host and retries with that hop's fingerprint", async () => {
      let attempts = 0;
      fakeBackend({
        secret_exists: () => true,
        tunnel_start: () => {
          attempts += 1;
          if (attempts === 1) throw { kind: "hop", hop: 1, name: "gw", error: { ...unknownHost, host: "10.0.0.9" } };
        },
      });
      const { launcher } = setup([gw, target], [db]);
      let started!: Promise<void>;
      act(() => {
        started = launcher().start(db);
      });
      await screen.findByText("Unknown jump host");
      fireEvent.click(screen.getByText("Trust and connect"));
      await act(() => started);
      expect(startCalls()).toHaveLength(2);
      expect((startCalls()[1][1] as { trustedFingerprint: unknown }).trustedFingerprint).toBeNull();
      expect(jumpsOf(1)).toEqual([
        { ...gwJump, auth: { method: "storedPassword", sessionId: "g1" }, trustedFingerprint: "SHA256:abc" },
      ]);
    });

    it("asks again for a jump host whose saved password was rejected", async () => {
      let attempts = 0;
      fakeBackend({
        secret_exists: () => true,
        tunnel_start: () => {
          attempts += 1;
          if (attempts === 1) throw { kind: "hop", hop: 1, name: "gw", error: { kind: "authFailed" } };
        },
      });
      const { launcher } = setup([gw, target], [db]);
      let started!: Promise<void>;
      act(() => {
        started = launcher().start(db);
      });
      fireEvent.change(await screen.findByLabelText("Password"), { target: { value: "new" } });
      expect(screen.getByText("Password for gw — jump host 1 of 1")).toBeTruthy();
      fireEvent.click(screen.getByText("Connect"));
      await act(() => started);
      expect(startCalls()).toHaveLength(2);
      expect(jumpsOf(1)).toMatchObject([{ ...gwJump, auth: { method: "password", password: "new" } }]);
      expect(startArgs(1).target.auth).toEqual({ method: "agent" });
    });

    it("reports a broken chain without starting", async () => {
      const { launcher, reportError } = setup([{ ...target, jumpIds: ["gone"] }], [db]);
      await act(() => launcher().start(db));
      expect(reportError).toHaveBeenCalledWith(
        "t1",
        'A jump host of "bastion" no longer exists; edit the session to choose another one.',
      );
      expect(startCalls()).toHaveLength(0);
    });
  });
});
