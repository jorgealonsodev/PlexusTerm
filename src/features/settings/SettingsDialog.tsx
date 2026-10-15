import { useState, type FormEvent } from "react";
import { clampFontSize, MAX_FONT_SIZE, MIN_FONT_SIZE, type TerminalSettings } from "./settings";

interface SettingsDialogProps {
  settings: TerminalSettings;
  onSave: (settings: TerminalSettings) => void;
  onCancel: () => void;
}

/** Terminal settings shared by every tab (S15.6). */
export function SettingsDialog({ settings, onSave, onCancel }: SettingsDialogProps) {
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const size = Number.parseFloat(fontSize);
    onSave({
      fontSize: Number.isFinite(size) ? clampFontSize(size) : settings.fontSize,
      copyOnSelect,
      rightClickPastes,
      confirmMultilinePaste,
    });
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="settings-title" noValidate>
        <h2 id="settings-title">Settings</h2>
        <label className="field field--port">
          Font size
          <input
            type="number"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            autoFocus
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={copyOnSelect} onChange={(e) => setCopyOnSelect(e.target.checked)} />
          Copy on select
        </label>
        <label className="check">
          <input type="checkbox" checked={rightClickPastes} onChange={(e) => setRightClickPastes(e.target.checked)} />
          Right click pastes
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={confirmMultilinePaste}
            onChange={(e) => setConfirmMultilinePaste(e.target.checked)}
          />
          Confirm multi-line paste
        </label>
        <p className="muted">
          When right click pastes, Ctrl+right click opens the terminal menu. Ctrl+= / Ctrl+- / Ctrl+0 change the font size.
        </p>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
