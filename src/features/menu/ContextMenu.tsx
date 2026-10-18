import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type ContextMenuItem =
  /**
   * `swatch`: a colour shown before the label. `keepOpen`: choosing it does not close the menu's
   * owner (it shows something in the menu's place, such as a dialog).
   */
  | { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean; swatch?: string; keepOpen?: boolean }
  | { separator: true };

interface ContextMenuProps {
  /** Pointer position, in viewport coordinates. */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Keeps the focus where it was on mouse down (the terminal keeps its selection for Copy). */
  keepFocus?: boolean;
  /** Shown under the items (a colour picker, ...). */
  children?: ReactNode;
}

/** Gap kept between the menu and the window edges. */
const EDGE = 4;

/** A right-click menu at the pointer, kept inside the window; Escape or a click outside closes it. */
export function ContextMenu({ x, y, items, onClose, keepFocus = false, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    const width = el?.offsetWidth ?? 0;
    const height = el?.offsetHeight ?? 0;
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    // Focus the menu so Escape and arrow keys do not reach the shell.
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) =>
        "separator" in item ? (
          <div key={`sep-${index}`} role="separator" className="context-menu__separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`context-menu__item${item.danger ? " context-menu__item--danger" : ""}`}
            disabled={item.disabled}
            onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
            onClick={() => {
              if (!item.keepOpen) onClose();
              item.onSelect();
            }}
          >
            {item.swatch && <span className="context-menu__swatch" style={{ background: item.swatch }} aria-hidden="true" />}
            {item.label}
          </button>
        ),
      )}
      {children}
    </div>
  );
}
