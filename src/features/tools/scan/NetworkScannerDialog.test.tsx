// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScanEvent } from "./scanBackend";
import { NetworkScannerDialog } from "./NetworkScannerDialog";

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

async function startScan(targets: string) {
  fireEvent.change(screen.getByLabelText("Network"), { target: { value: targets } });
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Start" })));
}

describe("NetworkScannerDialog", () => {
  it("lists live hosts with name, MAC and services, offering SSH only where it is open", async () => {
    invoke.mockResolvedValue(2);
    const onNewSshSession = vi.fn();
    render(<NetworkScannerDialog onClose={() => {}} onNewSshSession={onNewSshSession} />);
    await startScan("192.168.1.0/24");
    expect(invoke).toHaveBeenCalledWith("scan_network", { targets: "192.168.1.0/24", onEvent: channels[0] });
    emit({ event: "started", data: { total: 2032 } });
    emit({ event: "host", data: { host: "192.168.1.20", name: null, mac: null, ports: [80, 443] } });
    emit({ event: "host", data: { host: "192.168.1.3", name: "nas.lan", mac: "aa:bb:cc:dd:ee:03", ports: [22, 445] } });
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => [...row.querySelectorAll("td")].slice(0, 4).map((td) => td.textContent));
    expect(rows).toEqual([
      ["192.168.1.3", "nas.lan", "aa:bb:cc:dd:ee:03", "SSHSMB"],
      ["192.168.1.20", "", "", "HTTPHTTPS"],
    ]);
    const ssh = screen.getAllByRole("button", { name: /New SSH session/ });
    expect(ssh.map((b) => b.getAttribute("aria-label"))).toEqual(["New SSH session to 192.168.1.3"]);
    fireEvent.click(ssh[0]);
    expect(onNewSshSession).toHaveBeenCalledWith("192.168.1.3");
    emit({ event: "done", data: { done: 2032, total: 2032, cancelled: false } });
    expect(screen.getByRole("status").textContent).toBe("Done: 2032 probes, 2 live hosts.");
  });

  it("shows invalid input errors from the backend", async () => {
    invoke.mockRejectedValueOnce("CIDR prefix must be between /24 and /32 (at most 256 hosts)");
    render(<NetworkScannerDialog onClose={() => {}} onNewSshSession={() => {}} />);
    await startScan("10.0.0.0/16");
    expect(screen.getByRole("alert").textContent).toBe("CIDR prefix must be between /24 and /32 (at most 256 hosts)");
  });

  it("Stop cancels the running scan", async () => {
    invoke.mockResolvedValueOnce(3);
    render(<NetworkScannerDialog onClose={() => {}} onNewSshSession={() => {}} />);
    await startScan("10.0.0.1-10");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Stop" })));
    expect(invoke).toHaveBeenLastCalledWith("scan_stop", { id: 3 });
    emit({ event: "done", data: { done: 12, total: 80, cancelled: true } });
    expect(screen.getByRole("status").textContent).toBe("Stopped after 12 / 80 probes, 0 live hosts.");
  });
});
