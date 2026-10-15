import { ContextMenu } from "../menu/ContextMenu";

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
  const items: [MenuAction, string][] = [
    ["copy", "Copy"],
    ["paste", "Paste"],
    ["selectAll", "Select all"],
    ["clear", "Clear scrollback"],
    ["find", "Find…"],
    ["save", "Save output to file…"],
    ["log", logging ? "Stop logging" : "Log to file…"],
  ];
  // keepFocus: the terminal keeps its selection (and focus) for Copy.
  return (
    <ContextMenu
      x={x}
      y={y}
      keepFocus
      items={items.map(([action, label]) => ({ label, onSelect: () => onAction(action) }))}
      onClose={onClose}
    />
  );
}
