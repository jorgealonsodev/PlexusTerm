import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { useT } from "../../i18n/i18n";

export type MenuAction =
  | "copy"
  | "copyOutput"
  | "askAi"
  | "typeSelection"
  | "findSelection"
  | "openLink"
  | "paste"
  | "selectAll"
  | "clear"
  | "find"
  | "save"
  | "log";

interface TerminalContextMenuProps {
  /** Pointer position, in viewport coordinates. */
  x: number;
  y: number;
  /** Whether this pane is being logged to a file. */
  logging: boolean;
  /** The text selected when the menu opened; "" when nothing is selected. */
  selection?: string;
  /** The AI chat can be opened from this pane. */
  canAskAi?: boolean;
  /** The shell marked the command under the click, so its output can be copied. */
  commandOutput?: boolean;
  onAction: (action: MenuAction) => void;
  onClose: () => void;
}

/** One http(s) URL, the only selection "Open link" offers to open. */
export const linkOf = (selection: string): string | null => {
  const text = selection.trim();
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null;
};

/** Right-click menu of a terminal pane (S15.4), with the selection's own actions first (S7). */
export function TerminalContextMenu({
  x,
  y,
  logging,
  selection = "",
  canAskAi = false,
  commandOutput = false,
  onAction,
  onClose,
}: TerminalContextMenuProps) {
  const t = useT();
  const item = (action: MenuAction, label: string): ContextMenuItem => ({ label, onSelect: () => onAction(action) });
  const selectionItems: ContextMenuItem[] = selection
    ? [
        item("copy", t("common.copy")),
        ...(canAskAi ? [item("askAi", t("terminal.menu.askAi"))] : []),
        item("typeSelection", t("terminal.menu.typeSelection")),
        item("findSelection", t("terminal.menu.findSelection")),
        ...(linkOf(selection) ? [item("openLink", t("terminal.menu.openLink"))] : []),
        { separator: true },
      ]
    : [item("copy", t("common.copy"))];
  const items: ContextMenuItem[] = [
    ...selectionItems,
    ...(commandOutput ? [item("copyOutput", t("terminal.menu.copyOutput"))] : []),
    item("paste", t("terminal.menu.paste")),
    item("selectAll", t("terminal.menu.selectAll")),
    item("clear", t("terminal.menu.clear")),
    item("find", t("terminal.menu.find")),
    item("save", t("terminal.menu.save")),
    item("log", logging ? t("terminal.menu.stopLogging") : t("terminal.menu.log")),
  ];
  // keepFocus: the terminal keeps its selection (and focus) for Copy.
  return <ContextMenu x={x} y={y} keepFocus items={items} onClose={onClose} />;
}
