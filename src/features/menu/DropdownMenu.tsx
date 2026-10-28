import { useEffect, useRef, useState, type ReactNode } from "react";

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** An on/off item: shown ticked while on. */
  checked?: boolean;
  /** The keys that do the same, shown at the right. */
  shortcut?: string;
}

interface DropdownMenuProps {
  /** Button content (icon and label); `title` names the button when its label is hidden. */
  button: ReactNode;
  title: string;
  items: DropdownItem[];
}

/** A toolbar button that opens a list of actions; a click outside or Escape closes it. */
export function DropdownMenu({ button, title, items }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        className="btn btn--icon"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div className="menu__list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={`menu__item${item.checked ? " menu__item--checked" : ""}`}
              disabled={item.disabled}
              // Named by its label; its keys are announced apart.
              aria-label={item.shortcut ? item.label : undefined}
              aria-keyshortcuts={item.shortcut}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
              {item.shortcut && <kbd className="menu__shortcut">{item.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
