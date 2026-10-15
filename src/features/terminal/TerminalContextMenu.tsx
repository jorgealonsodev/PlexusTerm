import { ContextMenu } from "../menu/ContextMenu";
import { useT } from "../../i18n/i18n";

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
  const t = useT();
  const items: [MenuAction, string][] = [
    ["copy", t("common.copy")],
    ["paste", t("terminal.menu.paste")],
    ["selectAll", t("terminal.menu.selectAll")],
    ["clear", t("terminal.menu.clear")],
    ["find", t("terminal.menu.find")],
    ["save", t("terminal.menu.save")],
    ["log", logging ? t("terminal.menu.stopLogging") : t("terminal.menu.log")],
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
