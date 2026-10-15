import { useState } from "react";
import type { LibraryStatus } from "../sessions/useSessionLibrary";
import { hotkeyLabel, type Macro, type MacroList } from "./macros";

interface MacrosPanelProps {
  list: MacroList;
  status: LibraryStatus;
  saveError: string | null;
  /** False when there is no terminal pane to play into (or a macro is already running). */
  canPlay: boolean;
  onPlay: (macro: Macro) => void;
  onNew: () => void;
  onEdit: (macro: Macro) => void;
  onDuplicate: (macro: Macro) => void;
  onDelete: (macro: Macro) => void;
}

/** The "Macros" sidebar tab (S16.3). */
export function MacrosPanel(props: MacrosPanelProps) {
  const { list, status, saveError, canPlay } = props;
  const [query, setQuery] = useState("");
  const editable = status.state === "ready";
  const needle = query.trim().toLowerCase();
  const shown = list.macros.filter((m) => m.name.toLowerCase().includes(needle));

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>Macros</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={props.onNew}>
              New
            </button>
          </span>
        )}
      </div>
      {list.macros.length > 0 && (
        <input
          className="sidebar__search"
          placeholder="Search macros"
          aria-label="Search macros"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {status.state === "loading" && <p className="sidebar__note">Loading…</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">
          Could not read saved macros: {status.message}. Editing is disabled to protect the file.
        </p>
      )}
      {saveError && <p className="sidebar__note form-error">Could not save macros: {saveError}</p>}
      {editable && list.macros.length === 0 && (
        <p className="sidebar__note">No macros yet. Record one with Ctrl+Shift+R or create one with New.</p>
      )}
      {list.macros.length > 0 && shown.length === 0 && <p className="sidebar__note">No macros match.</p>}
      <ul className="tree">
        {shown.map((macro) => (
          <li key={macro.id}>
            <div className="tree-row" title={`${macro.steps.length} ${macro.steps.length === 1 ? "step" : "steps"}`}>
              <span className="tree-row__label">{macro.name}</span>
              {macro.hotkey !== undefined && <span className="macro__hotkey">{hotkeyLabel(macro.hotkey)}</span>}
              {editable && (
                <span className="tree-row__actions">
                  <button title="Edit" aria-label={`Edit ${macro.name}`} onClick={() => props.onEdit(macro)}>
                    ✎
                  </button>
                  <button
                    title="Duplicate"
                    aria-label={`Duplicate ${macro.name}`}
                    onClick={() => props.onDuplicate(macro)}
                  >
                    ⧉
                  </button>
                  <button title="Delete" aria-label={`Delete ${macro.name}`} onClick={() => props.onDelete(macro)}>
                    🗑
                  </button>
                </span>
              )}
              <button
                className="btn btn--small"
                aria-label={`Play ${macro.name}`}
                title="Play in the focused terminal"
                disabled={!canPlay}
                onClick={() => props.onPlay(macro)}
              >
                ▶
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="sidebar__hint">
        Macros play in the focused terminal; Ctrl+Alt+1–9 plays the macro bound to that key. Macros are saved as plain
        text.
      </p>
    </div>
  );
}
