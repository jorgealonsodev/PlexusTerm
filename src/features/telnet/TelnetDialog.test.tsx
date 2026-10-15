// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelnetDialog } from "./TelnetDialog";

afterEach(cleanup);

describe("TelnetDialog", () => {
  it("connects to the host on port 23 by default", () => {
    const onConnect = vi.fn();
    render(<TelnetDialog onConnect={onConnect} onCancel={vi.fn()} />);
    expect(screen.getByText(/Telnet is not encrypted/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: " switch.lan " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith({ type: "telnet", host: "switch.lan", port: 23 });
  });

  it("uses the typed port and reports invalid input", () => {
    const onConnect = vi.fn();
    render(<TelnetDialog onConnect={onConnect} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("alert").textContent).toBe("Host is required");
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "h" } });
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("alert").textContent).toBe("Port must be a number between 1 and 65535");
    fireEvent.change(screen.getByLabelText("Port"), { target: { value: "2323" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledWith({ type: "telnet", host: "h", port: 2323 });
  });

  it("cancels", () => {
    const onCancel = vi.fn();
    render(<TelnetDialog onConnect={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
