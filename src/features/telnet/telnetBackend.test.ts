import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendFor } from "../terminal/backend";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));

beforeEach(() => invoke.mockReset());

describe("telnet backend", () => {
  const backend = backendFor({ type: "telnet", host: "switch.lan", port: 2323 });

  it("connects to the host and port with the terminal size", async () => {
    invoke.mockResolvedValue(4);
    expect(await backend.start({ cols: 100, rows: 30 }, () => {})).toBe(4);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe("telnet_connect");
    expect(args.request).toEqual({ host: "switch.lan", port: 2323, cols: 100, rows: 30 });
    expect(args.onEvent).toBeDefined();
  });

  it("writes, resizes and closes through the telnet commands", async () => {
    invoke.mockResolvedValue(undefined);
    await backend.write(4, "ls\r");
    await backend.resize(4, 120, 40);
    await backend.close(4);
    expect(invoke.mock.calls).toEqual([
      ["telnet_write", { id: 4, data: "ls\r" }],
      ["telnet_resize", { id: 4, cols: 120, rows: 40 }],
      ["telnet_close", { id: 4 }],
    ]);
  });
});
