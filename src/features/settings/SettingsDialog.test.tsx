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
    expect((screen.getByLabelText("Colour scheme") as HTMLSelectElement).value).toBe("catppuccin-mocha");
    expect((screen.getByLabelText("Font family") as HTMLInputElement).value).toBe(DEFAULT_SETTINGS.fontFamily);
  });

  it("lists dark and light schemes separately and previews the selected one", () => {
    setup();
    const groups = [...document.querySelectorAll("optgroup")].map((g) => g.label);
    expect(groups).toEqual(["Dark", "Light"]);
    expect(screen.getByRole("option", { name: "Catppuccin Latte" }).parentElement?.getAttribute("label")).toBe("Light");
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "nord" } });
    const preview = screen.getByLabelText("Preview of Nord");
    expect(preview.style.background).toBe("rgb(46, 52, 64)");
  });

  it("saves the edited settings, clamping the font size", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "40" } });
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByLabelText("Right click pastes"));
    fireEvent.click(screen.getByLabelText("Confirm multi-line paste"));
    fireEvent.change(screen.getByLabelText("Colour scheme"), { target: { value: "solarized-light" } });
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: " Hack Nerd Font " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      fontSize: 32,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      theme: "solarized-light",
      fontFamily: "Hack Nerd Font",
    });
  });

  it("restores the default font when the font family is left empty", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Font family"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
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
