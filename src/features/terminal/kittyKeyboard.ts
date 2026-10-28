/**
 * A minimal kitty keyboard protocol (https://sw.kovidgoyal.net/kitty/keyboard-protocol/) until
 * xterm.js ships its own: AI command-line tools (Claude Code, Codex…) turn it on to tell
 * Ctrl+Enter and Shift+Enter from Enter. Only flag 1 (disambiguate escape codes) is supported,
 * and only for Escape and modified Enter, Tab and Backspace; every other key stays xterm's.
 * Shells never turn it on, so their keys are exactly as without it.
 */

/** The flags this terminal understands: 1, disambiguate escape codes. */
export const KITTY_SUPPORTED_FLAGS = 1;
/** Pushes beyond this evict the oldest entry (the spec asks for a limit against floods). */
export const KITTY_STACK_MAX = 16;

/** Which screen's stack: the spec keeps one for the main and one for the alternate screen. */
export type KittyScreen = "normal" | "alternate";

export interface KittyKeyboard {
  /** The current flags of a screen, masked to the supported ones. */
  flags(screen: KittyScreen): number;
  /** The reply to `CSI ? u`. */
  query(screen: KittyScreen): string;
  /** `CSI > flags u`. */
  push(screen: KittyScreen, flags: number): void;
  /** `CSI < n u`: n entries, 1 by default; an emptied stack means no flags. */
  pop(screen: KittyScreen, count?: number): void;
  /** `CSI = flags ; mode u`: mode 1 sets, 2 adds the set bits, 3 removes them. */
  set(screen: KittyScreen, flags: number, mode?: number): void;
  /** Both stacks emptied (RIS, a new session). */
  reset(): void;
  /** One screen's stack emptied (entering the alternate screen). */
  clear(screen: KittyScreen): void;
}

export const createKittyKeyboard = (): KittyKeyboard => {
  const stacks: Record<KittyScreen, number[]> = { normal: [], alternate: [] };
  const flags = (screen: KittyScreen) => {
    const stack = stacks[screen];
    return stack.length > 0 ? stack[stack.length - 1] : 0;
  };
  return {
    flags,
    query: (screen) => `\x1b[?${flags(screen)}u`,
    push(screen, value) {
      const stack = stacks[screen];
      stack.push(value & KITTY_SUPPORTED_FLAGS);
      if (stack.length > KITTY_STACK_MAX) stack.shift();
    },
    pop(screen, count = 1) {
      const stack = stacks[screen];
      stack.splice(Math.max(0, stack.length - Math.max(1, count)));
    },
    set(screen, value, mode = 1) {
      const current = flags(screen);
      const masked = value & KITTY_SUPPORTED_FLAGS;
      const next = mode === 1 ? masked : mode === 2 ? current | masked : mode === 3 ? current & ~masked : current;
      const stack = stacks[screen];
      // With nothing pushed the flags are the screen's base entry, which a set creates.
      if (stack.length === 0) stack.push(next);
      else stack[stack.length - 1] = next;
    },
    reset() {
      stacks.normal = [];
      stacks.alternate = [];
    },
    clear(screen) {
      stacks[screen] = [];
    },
  };
};

/** The parts of a KeyboardEvent the encoding reads. */
export interface KittyKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

/** Key codes of the keys this terminal encodes. */
const CODES: Record<string, number> = { Escape: 27, Enter: 13, Tab: 9, Backspace: 127 };

/**
 * The `CSI code ; mods u` sequence a key sends under `flags`, or null when xterm's own bytes
 * stand (protocol off, another key, plain Enter/Tab/Backspace, or an input method composing).
 */
export const encodeKittyKey = (e: KittyKey, flags: number): string | null => {
  if ((flags & KITTY_SUPPORTED_FLAGS) === 0) return null;
  if (e.isComposing || e.keyCode === 229) return null;
  const code = CODES[e.key];
  if (code === undefined) return null;
  const mods = 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0) + (e.metaKey ? 8 : 0);
  if (mods === 1) return code === 27 ? "\x1b[27u" : null;
  return `\x1b[${code};${mods}u`;
};
