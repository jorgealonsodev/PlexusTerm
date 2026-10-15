import type { FontStep } from "../settings/settings";
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
  | { type: "focus"; direction: FocusDirection }
  /** Pane-local: handled by the focused terminal itself (S15.1, S15.3). */
  | { type: "find" }
  | { type: "copy" }
  | { type: "paste" }
  /** Global font size (S15.2). */
  | { type: "fontSize"; step: FontStep }
  /** Macros (S16.2, S16.4): start or stop recording, play the macro bound to Ctrl+Alt+`hotkey`. */
  | { type: "recordMacro" }
  | { type: "playMacro"; hotkey: number }
  /** Folds the sidebar to its tab icons (or hides it) and opens it again. */
  | { type: "toggleSidebar" };

const CTRL_SHIFT: Record<string, Shortcut> = {
  T: { type: "newTerminal" },
  S: { type: "quickConnect" },
  W: { type: "closePane" },
  D: { type: "split", direction: "row" },
  E: { type: "split", direction: "column" },
  M: { type: "toggleMultiExec" },
  F: { type: "find" },
  C: { type: "copy" },
  V: { type: "paste" },
  R: { type: "recordMacro" },
  B: { type: "toggleSidebar" },
};

/** Ctrl+= (or Ctrl++, which needs Shift on most layouts), Ctrl+- and Ctrl+0. */
const FONT_KEYS: Record<string, FontStep> = {
  "=": "increase",
  "+": "increase",
  "-": "decrease",
  "0": "reset",
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
  if (e.ctrlKey && !e.altKey && Object.prototype.hasOwnProperty.call(FONT_KEYS, e.key)) return { type: "fontSize", step: FONT_KEYS[e.key] };
  if (e.ctrlKey && e.shiftKey && !e.altKey) return CTRL_SHIFT[e.key.toUpperCase()] ?? null;
  // Only the digit itself: a character typed with AltGr (Ctrl+Alt on some systems) stays the terminal's.
  if (e.ctrlKey && e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) return { type: "playMacro", hotkey: Number(e.key) };
  if (e.altKey && !e.ctrlKey && !e.shiftKey) {
    const direction = ARROWS[e.key];
    return direction ? { type: "focus", direction } : null;
  }
  return null;
}
