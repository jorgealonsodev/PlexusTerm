// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacroProgress, NameMacroDialog, RecordingIndicator } from "./MacroBars";

afterEach(cleanup);

describe("RecordingIndicator (S16.2, S16.5)", () => {
  it("warns that everything typed is saved and stops recording", () => {
    const onStop = vi.fn();
    render(<RecordingIndicator onStop={onStop} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Recording");
    expect(banner.textContent).toContain("Everything you type is saved, including passwords");
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStop).toHaveBeenCalled();
  });
});

describe("NameMacroDialog (S16.2)", () => {
  it("saves the recording under a name, or discards it", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<NameMacroDialog stepCount={3} onSave={onSave} onDiscard={onDiscard} />);
    expect(screen.getByText(/3 steps recorded/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a name.");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Backup " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("Backup");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalled();
  });
});

describe("MacroProgress (S16.3)", () => {
  it("shows the running step and stops the macro", () => {
    const onStop = vi.fn();
    render(<MacroProgress name="Deploy" step={1} total={4} onStop={onStop} />);
    expect(screen.getByText(/Running "Deploy": step 2 of 4/)).toBeTruthy();
    const bar = screen.getByRole("progressbar") as HTMLProgressElement;
    expect(bar.value).toBe(2);
    expect(bar.max).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
  });
});
