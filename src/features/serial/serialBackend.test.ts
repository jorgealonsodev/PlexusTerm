import { beforeEach, describe, expect, it, vi } from "vitest";
import { backendFor } from "../terminal/backend";
import { listSerialPorts } from "./serialBackend";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));


const target = {
  type: "serial" as const,
  path: "/dev/ttyUSB0",
  baud: 115200,
  dataBits: 8 as const,
  parity: "none" as const,
  stopBits: 1 as const,
  flow: "none" as const,
};

beforeEach(() => invoke.mockReset());

describe("serial backend", () => {
  it("opens the device with the target settings", async () => {
    invoke.mockResolvedValue(7);
    const id = await backendFor(target).start({ cols: 80, rows: 24 }, () => {});
    expect(id).toBe(7);
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe("serial_open");
    expect(args.request).toEqual({
      path: "/dev/ttyUSB0",
      baud: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flow: "none",
    });
  });

  it("writes and closes through the serial commands; resize is a no-op", async () => {
    const backend = backendFor(target);
    await backend.write(3, "\r");
    await backend.resize(3, 100, 40);
    await backend.close(3);
    expect(invoke.mock.calls).toEqual([
      ["serial_write", { id: 3, data: "\r" }],
      ["serial_close", { id: 3 }],
    ]);
  });

  it("lists the detected ports", async () => {
    invoke.mockResolvedValue(["/dev/ttyUSB0"]);
    expect(await listSerialPorts()).toEqual(["/dev/ttyUSB0"]);
    expect(invoke).toHaveBeenCalledWith("serial_list_ports");
  });
});
