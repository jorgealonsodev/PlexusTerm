import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendFor } from "./backend";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));

beforeEach(() => invoke.mockReset());

const requestOf = async (target: Parameters<typeof backendFor>[0]) => {
  invoke.mockResolvedValue(7);
  expect(await backendFor(target).start({ cols: 100, rows: 30 }, () => {})).toBe(7);
  const [command, args] = invoke.mock.calls[0];
  expect(command).toBe("pty_spawn");
  expect(args.onEvent).toBeDefined();
  return args.request;
};

describe("local backend", () => {
  it("starts the user's shell in the home directory when the target names neither", async () => {
    expect(await requestOf({ type: "local" })).toEqual({ cols: 100, rows: 30 });
  });

  it("starts the target's shell with its arguments in its starting directory", async () => {
    expect(
      await requestOf({ type: "local", program: "/usr/bin/fish", args: ["--login", "-C", "echo hi"], cwd: "~/src" }),
    ).toEqual({ program: "/usr/bin/fish", args: ["--login", "-C", "echo hi"], cwd: "~/src", cols: 100, rows: 30 });
  });

  it("leaves out a blank program, no arguments and a blank directory", async () => {
    expect(await requestOf({ type: "local", program: "  ", args: [], cwd: "" })).toEqual({ cols: 100, rows: 30 });
  });

  it("writes, resizes and closes through the PTY commands", async () => {
    invoke.mockResolvedValue(undefined);
    const backend = backendFor({ type: "local", program: "cmd.exe" });
    await backend.write(7, "dir\r");
    await backend.resize(7, 120, 40);
    await backend.close(7);
    expect(invoke.mock.calls).toEqual([
      ["pty_write", { id: 7, data: "dir\r" }],
      ["pty_resize", { id: 7, cols: 120, rows: 40 }],
      ["pty_close", { id: 7 }],
    ]);
  });
});
