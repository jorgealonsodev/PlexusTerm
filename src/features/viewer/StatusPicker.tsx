import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/i18n";

export interface PickerOption {
  id: string;
  label: string;
}

interface StatusPickerProps {
  /** Names the list (its accessible name). */
  label: string;
  options: PickerOption[];
  /** The option marked as the current one. */
  selected?: string;
  /** Shows a field that narrows the options to those whose label contains its text. */
  filter?: boolean;
  /** The button the list opens from: the list sits above it, aligned to its right edge. */
  anchor: HTMLElement;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/** Gap kept between the list and its button, and the window edges. */
const GAP = 4;

/**
 * The drop-down list of a status bar item, like VS Code's: options to click, an optional filter
 * (Enter chooses the first match); Escape or a click outside closes it.
 */
export function StatusPicker({ label, options, selected, filter = false, anchor, onChoose, onClose }: StatusPickerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [text, setText] = useState("");
  const [position, setPosition] = useState({ right: 0, bottom: 0 });
  const needle = text.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    setPosition({
      right: Math.max(GAP, window.innerWidth - rect.right),
      bottom: Math.max(GAP, window.innerHeight - rect.top + GAP),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The button closes the list itself (it toggles it).
      if (!ref.current?.contains(target) && !anchor.contains(target)) close.current();
    };
    const box = ref.current;
    (box?.querySelector<HTMLElement>("input") ?? box?.querySelector<HTMLElement>('[aria-selected="true"]'))?.focus();
    box?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor]);

  const choose = (id: string) => {
    onClose();
    onChoose(id);
  };

  return (
    <div
      ref={ref}
      className="status-picker"
      style={{ right: `${position.right}px`, bottom: `${position.bottom}px` }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
        anchor.focus();
      }}
    >
      {filter && (
        <input
          className="status-picker__filter"
          aria-label={t("app.viewer.filter")}
          placeholder={t("app.viewer.filter")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown.length > 0) choose(shown[0].id);
          }}
        />
      )}
      <div className="status-picker__list" role="listbox" aria-label={label}>
        {shown.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === selected}
            className={`status-picker__option${option.id === selected ? " status-picker__option--on" : ""}`}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
