import { useEffect, useRef } from "react";

export type MenuAction = "copy" | "paste" | "selectAll" | "clear" | "find" | "save" | "log";

interface TerminalContextMenuProps {
  /** Pointer position, in viewport coordinates. */
  x: number;
  y: number;
  /** Whether this pane is being logged to a file. */
  logging: boolean;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}

/** Right-click menu of a terminal pane (S15.4). */
export function TerminalContextMenu({ x, y, logging, onAction, onClose }: TerminalContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    // Focus the menu so Escape and arrow keys do not reach the shell.
    ref.current?.querySelector("button")?.focus();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const items: [MenuAction, string][] = [
    ["copy", "Copy"],
    ["paste", "Paste"],
    ["selectAll", "Select all"],
    ["clear", "Clear scrollback"],
    ["find", "Find…"],
    ["save", "Save output to file…"],
    ["log", logging ? "Stop logging" : "Log to file…"],
  ];

  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left: `${x}px`, top: `${y}px` }}>
      {items.map(([action, label]) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          className="context-menu__item"
          // Keep the terminal selection (and focus) for Copy.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClose();
            onAction(action);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
