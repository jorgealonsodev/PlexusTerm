// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog";
import { DEFAULT_SETTINGS } from "./settings";

afterEach(cleanup);

const setup = () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
};

describe("SettingsDialog", () => {
  it("shows the current settings", () => {
    setup();
    expect((screen.getByLabelText("Font size") as HTMLInputElement).value).toBe("14");
    expect((screen.getByLabelText("Copy on select") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Right click pastes") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Confirm multi-line paste") as HTMLInputElement).checked).toBe(true);
  });

  it("saves the edited settings, clamping the font size", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByLabelText("Right click pastes"));
    fireEvent.click(screen.getByLabelText("Confirm multi-line paste"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      fontSize: 32,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
    });
  });

  it("keeps the font size when the field is not a number", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it("cancels without saving, also on Escape", () => {
    const { onSave, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByLabelText("Font size"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
