// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { SettingsDialog } from "./SettingsDialog";
import { DEFAULT_SETTINGS } from "./settings";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

afterEach(cleanup);

const setup = () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
};

describe("SettingsDialog", () => {
  it("shows one section at a time from the side menu, starting with Appearance", () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} />);
    const sections = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(sections).toEqual(["Appearance", "Terminal", "SSH", "Files", "About"]);
    const visible = () => screen.getAllByRole("tabpanel").filter((p) => !p.hidden).map((p) => p.getAttribute("aria-label"));
    expect(visible()).toEqual(["Appearance"]);
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(visible()).toEqual(["Files"]);
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the edits of every section when saving", () => {
    const onSave = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "18" } });
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    fireEvent.click(screen.getByLabelText("Copy on select"));
    fireEvent.click(screen.getByRole("tab", { name: "SSH" }));
    fireEvent.click(screen.getByLabelText("Remote monitor bar (SSH tabs)"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 18, copyOnSelect: false, remoteMonitor: false }));
  });

  it("shows the logo, the version and the project in About, light for light schemes", async () => {
    const { unmount } = render(<SettingsDialog settings={DEFAULT_SETTINGS} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).not.toContain("light");
    expect(await screen.findByText("Version 0.1.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "github.com/jorgealonsodev/PlexusTerm" })).toBeTruthy();
    unmount();
    render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, theme: "solarized-light" }} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByAltText("PlexusTerm") as HTMLImageElement).src).toContain("light");
  });

  it("shows the current settings", () => {
    setup();
    expect((screen.getByLabelText("Font size") as HTMLInputElement).value).toBe("14");
    expect((screen.getByLabelText("Copy on select") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Right click pastes") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Confirm multi-line paste") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Colour scheme") as HTMLSelectElement).value).toBe("catppuccin-mocha");
    expect((screen.getByLabelText("Font family") as HTMLInputElement).value).toBe(DEFAULT_SETTINGS.fontFamily);
    expect((screen.getByLabelText("Remote monitor bar (SSH tabs)") as HTMLInputElement).checked).toBe(true);
    const editor = screen.getByLabelText("Text editor") as HTMLInputElement;
    expect(editor.value).toBe("");
    expect(editor.placeholder).toBe("System default");
  });

  it("chooses the text editor with Browse…, resets it to the system default and saves it", async () => {
    vi.mocked(open).mockResolvedValueOnce("/opt/My Editor/editor").mockResolvedValueOnce(null);
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("/opt/My Editor/editor"));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false, defaultPath: "/usr/bin" }));
    // Cancelling the file picker keeps the program.
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("/opt/My Editor/editor");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "/opt/My Editor/editor" });

    fireEvent.click(screen.getByRole("button", { name: "Use system default" }));
    expect((screen.getByLabelText("Text editor") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Text editor"), { target: { value: "  code --wait " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, textEditor: "code --wait" });
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
    fireEvent.click(screen.getByLabelText("Remote monitor bar (SSH tabs)"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      fontSize: 32,
      copyOnSelect: false,
      rightClickPastes: false,
      confirmMultilinePaste: false,
      theme: "solarized-light",
      fontFamily: "Hack Nerd Font",
      remoteMonitor: false,
      textEditor: "",
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
