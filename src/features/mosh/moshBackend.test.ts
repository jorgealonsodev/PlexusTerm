import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MoshTarget } from "../sessions/types";
import { backendFor } from "../terminal/backend";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));

beforeEach(() => invoke.mockReset());

const target: MoshTarget = {
  type: "mosh",
  ssh: {
    type: "ssh",
    host: "web.example.com",
    port: 2222,
    username: "deploy",
    auth: { method: "storedPassword", sessionId: "s1" },
    jumps: [{ name: "bastion", host: "b", port: 22, username: "j", auth: { method: "agent" } }],
  },
  serverCommand: "mosh-server new -p 60010",
};

describe("mosh backend", () => {
  it("starts mosh over the SSH login of the target, with the server command", async () => {
    invoke.mockResolvedValue(9);
    expect(await backendFor(target).start({ cols: 80, rows: 24 }, () => {})).toBe(9);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe("mosh_connect");
    expect(args.request).toEqual({
      host: "web.example.com",
      port: 2222,
      username: "deploy",
      auth: { method: "storedPassword", sessionId: "s1" },
      cols: 80,
      rows: 24,
      trustedFingerprint: null,
      jumps: target.ssh.jumps,
      serverCommand: "mosh-server new -p 60010",
    });
    expect(args.storage).toBeNull();
  });

  it("lets a retry replace the login, the jump hosts and the saved-password request", async () => {
    invoke.mockResolvedValue(9);
    const auth = { method: "password" as const, password: "pw" };
    const storage = { action: "remember" as const, sessionId: "s1", label: "PlexusTerm: deploy@web.example.com:2222" };
    await backendFor({ ...target, serverCommand: undefined }).start(
      { cols: 80, rows: 24, trustedFingerprint: "SHA256:x", auth, storage, jumps: [] },
      () => {},
    );
    const args = invoke.mock.calls[0][1];
    expect(args.request).toMatchObject({ auth, trustedFingerprint: "SHA256:x", jumps: [], serverCommand: null });
    expect(args.storage).toEqual(storage);
  });

  it("drives the client through the PTY commands", async () => {
    invoke.mockResolvedValue(undefined);
    const backend = backendFor(target);
    await backend.write(9, "x");
    await backend.resize(9, 100, 30);
    await backend.close(9);
    expect(invoke.mock.calls).toEqual([
      ["pty_write", { id: 9, data: "x" }],
      ["pty_resize", { id: 9, cols: 100, rows: 30 }],
      ["pty_close", { id: 9 }],
    ]);
  });
});
