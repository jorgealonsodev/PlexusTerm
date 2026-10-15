// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SerialDialog } from "./SerialDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
});

describe("SerialDialog", () => {
  it("lists detected ports and connects with 115200 8N1 by default", async () => {
    vi.mocked(invoke).mockResolvedValue(["/dev/ttyACM0", "/dev/ttyUSB0"]);
    const onConnect = vi.fn();
    render(<SerialDialog onConnect={onConnect} onCancel={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "/dev/ttyUSB0" }));
    expect((screen.getByLabelText("Serial port") as HTMLInputElement).value).toBe("/dev/ttyUSB0");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith({
      type: "serial",
      path: "/dev/ttyUSB0",
      baud: 115200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flow: "none",
    });
  });

  it("accepts a typed path and a custom baud rate", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const onConnect = vi.fn();
    render(<SerialDialog onConnect={onConnect} onCancel={vi.fn()} />);
    await screen.findByText("No serial ports detected.");

    fireEvent.change(screen.getByLabelText("Serial port"), { target: { value: "/dev/ttyS4" } });
    fireEvent.change(screen.getByLabelText("Baud rate"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom baud rate"), { target: { value: "250000" } });
    fireEvent.change(screen.getByLabelText("Parity"), { target: { value: "odd" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/dev/ttyS4", baud: 250000, parity: "odd" }),
    );
  });

  it("refreshes the port list and shows validation errors", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]).mockResolvedValueOnce(["/dev/ttyUSB1"]);
    const onConnect = vi.fn();
    render(<SerialDialog onConnect={onConnect} onCancel={vi.fn()} />);
    await screen.findByText("No serial ports detected.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "/dev/ttyUSB1" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("alert").textContent).toBe("Serial port is required");
    expect(onConnect).not.toHaveBeenCalled();
  });
});
