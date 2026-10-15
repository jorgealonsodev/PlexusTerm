import { useState } from "react";
import { useT } from "../../i18n/i18n";
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
  const t = useT();
  const { list, status, saveError, canPlay } = props;
  const [query, setQuery] = useState("");
  const editable = status.state === "ready";
  const needle = query.trim().toLowerCase();
  const shown = list.macros.filter((m) => m.name.toLowerCase().includes(needle));

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>{t("macros.panel.title")}</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={props.onNew}>
              {t("macros.panel.new")}
            </button>
          </span>
        )}
      </div>
      {list.macros.length > 0 && (
        <input
          className="sidebar__search"
          placeholder={t("macros.panel.search")}
          aria-label={t("macros.panel.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {status.state === "loading" && <p className="sidebar__note">{t("common.loading")}</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">{t("macros.panel.readError", { message: status.message })}</p>
      )}
      {saveError && <p className="sidebar__note form-error">{t("macros.panel.saveError", { error: saveError })}</p>}
      {editable && list.macros.length === 0 && (
        <p className="sidebar__note">{t("macros.panel.empty")}</p>
      )}
      {list.macros.length > 0 && shown.length === 0 && <p className="sidebar__note">{t("macros.panel.noMatch")}</p>}
      <ul className="tree">
        {shown.map((macro) => (
          <li key={macro.id}>
            <div className="tree-row" title={t("macros.panel.steps", { count: macro.steps.length })}>
              <span className="tree-row__label">{macro.name}</span>
              {macro.hotkey !== undefined && <span className="macro__hotkey">{hotkeyLabel(macro.hotkey)}</span>}
              {editable && (
                <span className="tree-row__actions">
                  <button title={t("common.edit")} aria-label={t("macros.panel.editNamed", { name: macro.name })} onClick={() => props.onEdit(macro)}>
                    ✎
                  </button>
                  <button
                    title={t("macros.panel.duplicate")}
                    aria-label={t("macros.panel.duplicateNamed", { name: macro.name })}
                    onClick={() => props.onDuplicate(macro)}
                  >
                    ⧉
                  </button>
                  <button
                    title={t("common.delete")}
                    aria-label={t("macros.panel.deleteNamed", { name: macro.name })}
                     onClick={() => props.onDelete(macro)}
                  >
                    🗑
                  </button>
                </span>
              )}
              <button
                className="btn btn--small"
                aria-label={t("macros.panel.playNamed", { name: macro.name })}
                title={t("macros.panel.play")}
                disabled={!canPlay}
                onClick={() => props.onPlay(macro)}
              >
                ▶
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="sidebar__hint">{t("macros.panel.hint")}</p>
    </div>
  );
}
