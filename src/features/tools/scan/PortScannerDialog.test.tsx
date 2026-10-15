// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScanEvent } from "./scanBackend";
import { DEFAULT_PORTS, PortScannerDialog } from "./PortScannerDialog";

const { invoke, channels } = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: ((event: ScanEvent) => void) | null }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage = null;
    constructor() {
      channels.push(this);
    }
  },
}));

afterEach(() => {
  cleanup();
  invoke.mockReset();
  channels.length = 0;
});

const emit = (event: ScanEvent) => act(() => channels[channels.length - 1].onmessage!(event));

async function startScan(targets: string, ports?: string) {
  fireEvent.change(screen.getByLabelText("Hosts"), { target: { value: targets } });
  if (ports !== undefined) fireEvent.change(screen.getByLabelText("Ports"), { target: { value: ports } });
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start" })));
}

const cells = () => screen.getAllByRole("row").slice(1).map((row) => [...row.querySelectorAll("td")].map((td) => td.textContent));

describe("PortScannerDialog", () => {
  it("scans the entered hosts and ports and fills the table as open ports arrive", async () => {
    invoke.mockResolvedValue(4);
    render(<PortScannerDialog onClose={() => {}} />);
    expect((screen.getByLabelText("Ports") as HTMLInputElement).value).toBe(DEFAULT_PORTS);
    await startScan("192.168.1.1-20", "22,80");
    expect(invoke).toHaveBeenCalledWith("scan_ports", { targets: "192.168.1.1-20", ports: "22,80", onEvent: channels[0] });
    emit({ event: "started", data: { total: 40 } });
    emit({ event: "open", data: { host: "192.168.1.10", port: 80, service: "http" } });
    emit({ event: "open", data: { host: "192.168.1.2", port: 22, service: "ssh" } });
    emit({ event: "progress", data: { done: 32, total: 40 } });
    expect(screen.getByRole("status").textContent).toBe("Scanning: 32 / 40 probes");
    expect(cells()).toEqual([
      ["192.168.1.2", "22", "open", "ssh"],
      ["192.168.1.10", "80", "open", "http"],
    ]);
    emit({ event: "done", data: { done: 40, total: 40, cancelled: false } });
    expect(screen.getByRole("status").textContent).toBe("Done: 40 probes, 2 open ports.");
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("scans the common ports when the Ports field is left empty, and says so", async () => {
    invoke.mockResolvedValue(1);
    render(<PortScannerDialog onClose={() => {}} />);
    expect((screen.getByLabelText("Ports") as HTMLInputElement).placeholder).toBe("Empty: common ports");
    await startScan("192.168.1.1", "   ");
    expect(invoke).toHaveBeenCalledWith("scan_ports", { targets: "192.168.1.1", ports: DEFAULT_PORTS, onEvent: channels[0] });
  });

  it("shows invalid input errors from the backend", async () => {
    invoke.mockRejectedValueOnce("Invalid port: 70000 (use numbers from 1 to 65535)");
    render(<PortScannerDialog onClose={() => {}} />);
    await startScan("10.0.0.1", "70000");
    expect(screen.getByRole("alert").textContent).toBe("Invalid port: 70000 (use numbers from 1 to 65535)");
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
  });

  it("Stop cancels the running scan", async () => {
    invoke.mockResolvedValueOnce(9);
    render(<PortScannerDialog onClose={() => {}} />);
    await startScan("10.0.0.1");
    emit({ event: "started", data: { total: 15 } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(invoke).toHaveBeenLastCalledWith("scan_stop", { id: 9 });
    emit({ event: "done", data: { done: 3, total: 15, cancelled: true } });
    expect(screen.getByRole("status").textContent).toBe("Stopped after 3 / 15 probes, 0 open ports.");
  });

  it("closes on Close and Escape, stopping a running scan", async () => {
    invoke.mockResolvedValueOnce(5);
    const onClose = vi.fn();
    const { unmount } = render(<PortScannerDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByLabelText("Hosts"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    await startScan("10.0.0.1");
    unmount();
    expect(invoke).toHaveBeenLastCalledWith("scan_stop", { id: 5 });
  });
});
