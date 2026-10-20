import type { HistoryChoice } from "./shareApi";

/** What sharing needs from a terminal pane (registered by `TerminalView`). */
export interface SharePane {
  /** The session's share tap, once the session started. */
  tap: () => number | null;
  size: () => { cols: number; rows: number };
  /**
   * The pane serialized as it is after the output it rendered last (`coversSeq`): the visible screen,
   * then the screen with the chosen history (integration guide §8). "Current screen only" has no
   * separate screen part.
   */
  snapshot: (history: HistoryChoice) => Promise<{ coversSeq: number; screen: string | null; full: string }>;
  /** Types a viewer's keys into the session, never broadcast to other panes nor recorded in a macro. */
  inject: (data: string) => void;
  /** When the sharer last typed into the pane (`performance.now()`), or -Infinity. */
  sharerTypedAt: () => number;
  /** The pane is at a password prompt (best effort). */
  atPassword: () => boolean;
  /** A full-screen program (vim, less, an AI CLI...) is running. */
  fullScreen: () => boolean;
  /** Called with the pane's new size after each resize; returns its unsubscribe function. */
  onResize: (listener: (cols: number, rows: number) => void) => () => void;
}
