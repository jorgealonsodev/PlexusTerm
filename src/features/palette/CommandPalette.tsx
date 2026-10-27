import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/i18n";
import { filterPalette, type PaletteItem } from "./paletteItems";

interface CommandPaletteProps {
  items: readonly PaletteItem[];
  /** Closes the palette; `run` is the item chosen, run once the palette is gone (focus goes back first). */
  onClose: (run?: () => void) => void;
}

/**
 * One box to reach everything: type to narrow the actions, sessions, macros, tabs and Settings
 * sections; ↑/↓ choose, Enter or a click runs, Esc closes.
 */
export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterPalette(items, query), [items, query]);
  const current = Math.min(selected, Math.max(0, shown.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSelected((current + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[current];
      if (item) onClose(item.run);
    }
  };

  return (
    <div className="overlay overlay--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label={t("app.palette.title")}>
        <input
          className="palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[current] ? `palette-item-${current}` : undefined}
          autoFocus
          spellCheck={false}
          placeholder={t("app.palette.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {shown.map((item, index) => (
            <li
              key={`${item.group}:${item.id}`}
              id={`palette-item-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === current}
              className={index === current ? "palette__item palette__item--selected" : "palette__item"}
              onMouseMove={() => index !== current && setSelected(index)}
              onClick={() => onClose(item.run)}
            >
              <span className="palette__label" dir="auto">
                {item.label}
                {item.detail && <span className="palette__detail"> {item.detail}</span>}
              </span>
              {item.shortcut && <kbd className="palette__shortcut">{item.shortcut}</kbd>}
              <span className="palette__group">{t(`app.palette.groups.${item.group}`)}</span>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="palette__empty muted">{t("app.palette.noResults")}</p>}
      </div>
    </div>
  );
}
