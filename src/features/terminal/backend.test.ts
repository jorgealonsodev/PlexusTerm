import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SshTarget } from "../sessions/types";
import { backendFor } from "./backend";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(7);
});

const target: SshTarget = { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "agent" } };

/** The arguments of every `ssh_connect` call, without the event channel. */
const connects = () =>
  invoke.mock.calls.map(([command, args]) => {
    expect(command).toBe("ssh_connect");
    const { onEvent, ...rest } = args;
    expect(onEvent).toBeDefined();
    return rest;
  });

describe("SSH backend", () => {
  it("sends no shell options for a target without them", async () => {
    await backendFor(target).start({ cols: 80, rows: 24 }, () => {});
    expect(connects()).toEqual([
      {
        request: {
          host: "h",
          port: 22,
          username: "u",
          auth: { method: "agent" },
          cols: 80,
          rows: 24,
          trustedFingerprint: null,
          jumps: [],
        },
        storage: null,
      },
    ]);
  });

  it("asks for agent forwarding and the tmux session of the target", async () => {
    await backendFor({ ...target, forwardAgent: true, tmuxSession: "work" }).start({ cols: 80, rows: 24 }, () => {});
    expect(connects()[0].options).toEqual({ forwardAgent: true, tmuxSession: "work" });
  });

  it("sends the proxy command of the target, and nothing else changes", async () => {
    await backendFor({ ...target, proxyCommand: "nc %h %p" }).start({ cols: 80, rows: 24 }, () => {});
    expect(connects()[0].options).toEqual({ forwardAgent: false, tmuxSession: null, proxyCommand: "nc %h %p" });
    expect(connects()[0].request).toMatchObject({ host: "h", port: 22, jumps: [] });
  });

  it("asks for the same tmux session on every start, so a reconnection resumes it", async () => {
    const backend = backendFor({ ...target, tmuxSession: "work" });
    await backend.start({ cols: 80, rows: 24 }, () => {});
    await backend.start({ cols: 100, rows: 30, trustedFingerprint: "SHA256:x" }, () => {});
    expect(connects().map((args) => args.options)).toEqual([
      { forwardAgent: false, tmuxSession: "work" },
      { forwardAgent: false, tmuxSession: "work" },
    ]);
  });
});
