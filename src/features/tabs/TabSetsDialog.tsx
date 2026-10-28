import { useT } from "../../i18n/i18n";
import type { TabSet } from "./tabSets";

interface TabSetsDialogProps {
  sets: readonly TabSet[];
  onSave: () => void;
  onOpen: (set: TabSet) => void;
  onRename: (set: TabSet) => void;
  onDelete: (set: TabSet) => void;
  onClose: () => void;
}

/** The saved tab sets (S2): open, rename or delete each one, or save the open tabs as a new one. */
export function TabSetsDialog({ sets, onSave, onOpen, onRename, onDelete, onClose }: TabSetsDialogProps) {
  const t = useT();
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog tab-sets" role="dialog" aria-labelledby="tab-sets-title">
        <h2 id="tab-sets-title">{t("app.tabSets.title")}</h2>
        <p className="muted">{t("app.tabSets.help")}</p>
        {sets.length === 0 ? (
          <p className="muted">{t("app.tabSets.empty")}</p>
        ) : (
          <ul className="tab-sets__list">
            {sets.map((set) => (
              <li key={set.name} className="tab-sets__item">
                <span className="tab-sets__name">{set.name}</span>
                <span className="muted">{t("app.tabSets.tabCount", { count: set.tabs.tabs.length })}</span>
                <button
                  type="button"
                  className="btn btn--primary"
                  aria-label={t("app.tabSets.openSet", { name: set.name })}
                  onClick={() => onOpen(set)}
                >
                  {t("common.open")}
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={t("app.tabSets.renameSet", { name: set.name })}
                  onClick={() => onRename(set)}
                >
                  {t("common.rename")}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  aria-label={t("app.tabSets.deleteSet", { name: set.name })}
                  onClick={() => onDelete(set)}
                >
                  {t("common.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onSave}>
            {t("app.tabSets.saveCurrent")}
          </button>
          <button type="button" className="btn btn--primary" autoFocus onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
