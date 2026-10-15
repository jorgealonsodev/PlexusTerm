// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { WakeOnLanDialog } from "./WakeOnLanDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

describe("WakeOnLanDialog", () => {
  it("sends the magic packet and confirms it", async () => {
    render(<WakeOnLanDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("MAC address"), { target: { value: "aa-bb-cc-dd-ee-01" } });
    fireEvent.change(screen.getByLabelText("Broadcast address"), { target: { value: "192.168.1.255" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Wake" })));
    expect(invoke).toHaveBeenCalledWith("wol_send", { mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255", port: 9 });
    expect(screen.getByRole("status").textContent).toBe("Magic packet sent to aa:bb:cc:dd:ee:01.");
  });

  it("shows form errors without sending, and backend errors after sending", async () => {
    render(<WakeOnLanDialog onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Wake" }));
    expect(screen.getByRole("alert").textContent).toBe("MAC address must look like aa:bb:cc:dd:ee:ff");
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(invoke).mockRejectedValueOnce("Could not send the packet: Network is unreachable");
    fireEvent.change(screen.getByLabelText("MAC address"), { target: { value: "aa:bb:cc:dd:ee:01" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Wake" })));
    expect(screen.getByRole("alert").textContent).toBe("Could not send the packet: Network is unreachable");
  });

  it("closes on Close and on Escape", () => {
    const onClose = vi.fn();
    render(<WakeOnLanDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByLabelText("MAC address"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
