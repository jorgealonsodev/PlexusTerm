import type { FocusDirection, SplitDirection } from "./paneLayout";

/** The subset of KeyboardEvent the shortcut table needs. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export type Shortcut =
  | { type: "newTerminal" }
  | { type: "quickConnect" }
  | { type: "closePane" }
  | { type: "split"; direction: SplitDirection }
  | { type: "toggleMultiExec" }
  | { type: "focus"; direction: FocusDirection };

const CTRL_SHIFT: Record<string, Shortcut> = {
  T: { type: "newTerminal" },
  S: { type: "quickConnect" },
  W: { type: "closePane" },
  D: { type: "split", direction: "row" },
  E: { type: "split", direction: "column" },
  M: { type: "toggleMultiExec" },
};

const ARROWS: Record<string, FocusDirection> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * The application shortcut for a key event, or null when the key belongs to the terminal.
 * Terminals must not see these keys: xterm would otherwise send e.g. Ctrl+D (EOF) for Ctrl+Shift+D.
 */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.metaKey) return null;
  if (e.ctrlKey && e.shiftKey && !e.altKey) return CTRL_SHIFT[e.key.toUpperCase()] ?? null;
  if (e.altKey && !e.ctrlKey && !e.shiftKey) {
    const direction = ARROWS[e.key];
    return direction ? { type: "focus", direction } : null;
  }
  return null;
}
