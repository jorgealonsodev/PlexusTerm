/**
 * Colours the terminal lines that look like errors. A terminal cannot tell errors apart (the PTY
 * merges stdout and stderr into one stream), so lines are matched against the messages of common
 * tools. The colour is an xterm decoration drawn over the text: the output itself is never changed,
 * so escape sequences and full-screen programs are unaffected.
 */
import { SYSTEM_ERROR_PHRASES } from "./errorPhrases.generated";

/** Words followed by a colon, as compilers, git, Node and Go print them (`error:`, `error[E0308]:`, `file.c:3: error:`). */
const LABEL = /(^|[\s:])(error|fatal|panic|critical)(\[[^\]]*\])?:(\s|$)/i;
/** Exception names that open a line, as Python and the JVM print them. */
const EXCEPTION = /^\s*[A-Z]\w*(Error|Exception): |^Exception in thread /;
/** Tags that only error lines carry (npm, apt, Maven, and an ERROR log level followed by a space or colon). */
const TAG = /\bERR!|^E: |\[ERROR\]|(^|\s)ERROR(:|\s)/;
/**
 * Phrases of shells and system tools, on Linux and Windows (cmd and PowerShell), plus the messages
 * of the C library, coreutils and bash in every language they are translated to.
 */
const PHRASES = [
  ...SYSTEM_ERROR_PHRASES,
  "cannot access",
  "traceback (most recent call last)",
  "fatal error",
  " failed because ",
  "is not recognized as an internal or external command",
  "is not recognized as a name of a cmdlet",
  "is not recognized as the name of a cmdlet",
  "access is denied.",
  "the system cannot find the path specified",
  "the system cannot find the file specified",
];
const POWERSHELL = /^\s*\+\s*(CategoryInfo|FullyQualifiedErrorId)\s+:/;

/** Whether a line of terminal output looks like an error message. */
export function isErrorLine(text: string): boolean {
  if (!text.trim()) return false;
  if (LABEL.test(text) || EXCEPTION.test(text) || TAG.test(text) || POWERSHELL.test(text)) return true;
  const lower = text.toLowerCase();
  return PHRASES.some((phrase) => lower.includes(phrase));
}

const DEFAULT_RED = "#cd3131";

/** The colour scheme's red; decorations only take `#RRGGBB`. */
export function errorColor(theme: { red?: string }): string {
  return theme.red && /^#[0-9a-f]{6}$/i.test(theme.red) ? theme.red : DEFAULT_RED;
}

interface Disposable {
  dispose(): void;
}
interface Marker extends Disposable {
  readonly line: number;
  readonly isDisposed: boolean;
  /** Fires when the marker goes, also when its row leaves the scrollback. */
  onDispose(listener: () => void): Disposable;
}
interface Row {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

/** The part of xterm's Terminal this module uses. */
export interface HighlightTerminal {
  readonly cols: number;
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      readonly length: number;
      readonly baseY: number;
      readonly cursorY: number;
      getLine(y: number): Row | undefined;
    };
  };
  registerMarker(cursorYOffset?: number): Marker;
  registerDecoration(options: { marker: Marker; foregroundColor?: string; width?: number; layer?: "bottom" | "top" }): Disposable | undefined;
  onWriteParsed(listener: () => void): Disposable;
}

export interface ErrorHighlight {
  /** Clears every colour and, when on, colours the whole buffer again (colour scheme, setting or size changed). */
  refresh(): void;
  dispose(): void;
}

interface Coloured {
  marker: Marker;
  decoration: Disposable;
}

/**
 * Colours error lines as output arrives. Only finished lines are read (the cursor's line may still
 * grow); a line wrapped over several rows is read whole and every row is coloured. Rows on the
 * screen can be rewritten (`clear`, progress bars), so their colours are checked again on every
 * write; rows in the scrollback can no longer change, so a scan never looks at them again and its
 * cost follows the screen, not the number of colours kept.
 */
/** The next frame, or a timer where there are no frames (tests, hidden pages). */
const nextFrame = (callback: () => void) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(callback);
  else setTimeout(callback, 16);
};

/**
 * Most error rows kept coloured: older ones lose their colour. xterm gives every marker a listener
 * it calls for each line that leaves a full scrollback, so thousands of them slow output down.
 */
export const MAX_COLOURED = 1000;

export function attachErrorHighlight(
  term: HighlightTerminal,
  options: {
    enabled: () => boolean;
    color: () => string;
    /** Runs a scan later; once per frame by default, as writes come many per frame. */
    schedule?: (scan: () => void) => void;
    /** Most rows kept coloured (MAX_COLOURED by default). */
    maxColoured?: number;
  },
): ErrorHighlight {
  const maxColoured = options.maxColoured ?? MAX_COLOURED;
  /** Every colour kept; each leaves when its marker goes (left the scrollback, rewritten, cleared). */
  const coloured = new Set<Coloured>();
  /** The colours that were on the screen at the last scan: the only ones whose rows can still change. */
  let onScreen: Coloured[] = [];
  /** The scrollback's length at the last scan: when it shrinks (the pane grew), rows come back. */
  let lastBaseY = 0;
  /** The first row not read yet; a marker follows it when old rows leave the scrollback. */
  let next: Marker | null = null;

  /** The rows of the line that `row` belongs to, and its text. */
  const lineAt = (row: number, end: number) => {
    const buffer = term.buffer.active;
    let first = row;
    while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
    let last = row;
    while (last + 1 < end && buffer.getLine(last + 1)?.isWrapped) last++;
    let text = "";
    for (let r = first; r <= last; r++) text += buffer.getLine(r)?.translateToString(true) ?? "";
    return { first, last, text };
  };

  const scan = () => {
    const buffer = term.buffer.active;
    if (!options.enabled() || buffer.type !== "normal") return;
    const cursor = buffer.baseY + buffer.cursorY;
    // The cursor's line starts where its wrapped rows begin.
    let end = cursor;
    while (end > 0 && buffer.getLine(end)?.isWrapped) end--;

    // Rows the scrollback gave back to the screen (a taller or wider pane) can be rewritten
    // again: their colours are looked at like the screen's.
    if (buffer.baseY < lastBaseY) {
      const back = [...coloured].filter((c) => !c.marker.isDisposed && c.marker.line >= buffer.baseY);
      onScreen = [...new Set([...onScreen, ...back])];
    }
    lastBaseY = buffer.baseY;
    // A screen row that no longer reads as an error (cleared, overwritten) loses its colour. Rows
    // that scrolled above the screen keep theirs and are not looked at again; rows that left the
    // scrollback took their marker and decoration with them.
    const kept: Coloured[] = [];
    const still: Coloured[] = [];
    /** The last line read, so the rows of a wrapped line read it once. */
    let line: { first: number; last: number; error: boolean } | null = null;
    for (const c of onScreen.filter((c) => !c.marker.isDisposed).sort((a, b) => a.marker.line - b.marker.line)) {
      const row = c.marker.line;
      if (row < buffer.baseY) {
        kept.push(c);
        continue;
      }
      let error: boolean;
      if (row >= end) {
        error = isErrorLine(lineAt(row, row + 1).text);
      } else {
        if (!line || row < line.first || row > line.last) {
          const { first, last, text } = lineAt(row, end);
          line = { first, last, error: isErrorLine(text) };
        }
        error = line.error;
      }
      if (error) {
        kept.push(c);
        still.push(c);
      } else {
        c.decoration.dispose();
        c.marker.dispose();
      }
    }
    onScreen = still;

    // Without a marker (it left the scrollback) everything is read again; when the cursor went
    // back above it, the screen was rewritten and is read again from its top.
    const known = next && !next.isDisposed;
    let start = known ? next!.line : 0;
    if (start > end) start = Math.min(buffer.baseY, end);
    if (start < end) {
      // Rows already coloured: the read starts at the last scan's end or on the screen, where only
      // the last screen's colours can be, unless everything is read again.
      const decorated = new Set([...(known ? kept : coloured)].map((c) => c.marker.line));
      const color = options.color();
      for (let row = start; row < end; ) {
        const { last, text } = lineAt(row, end);
        if (isErrorLine(text)) {
          for (let r = row; r <= last; r++) {
            if (decorated.has(r)) continue;
            const marker = term.registerMarker(r - cursor);
            let decoration: Disposable | undefined;
            try {
              decoration = term.registerDecoration({ marker, foregroundColor: color, width: term.cols, layer: "top" });
            } catch {
              // Left uncoloured; the marker must not outlive it.
            }
            if (decoration) {
              const c = { marker, decoration };
              coloured.add(c);
              marker.onDispose(() => coloured.delete(c));
              if (r >= buffer.baseY) onScreen.push(c);
              // Over the limit, the oldest colour goes (a Set keeps insertion order).
              if (coloured.size > maxColoured) {
                const oldest = coloured.values().next().value!;
                oldest.decoration.dispose();
                oldest.marker.dispose();
              }
            } else marker.dispose();
          }
        }
        row = last + 1;
      }
    }
    next?.dispose();
    next = term.registerMarker(end - cursor);
  };

  /** Colouring is cosmetic: a failure must never get in the way of the output. */
  const safeScan = () => {
    try {
      scan();
    } catch {
      // Left uncoloured.
    }
  };

  const clear = () => {
    [...coloured].forEach((c) => (c.decoration.dispose(), c.marker.dispose()));
    coloured.clear();
    onScreen = [];
    lastBaseY = 0;
    next?.dispose();
    next = null;
  };

  const schedule = options.schedule ?? nextFrame;
  let pending = false;
  const scanSoon = () => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (!disposed) safeScan();
    });
  };
  let disposed = false;

  const subscription = term.onWriteParsed(scanSoon);
  safeScan();

  return {
    refresh() {
      clear();
      safeScan();
    },
    dispose() {
      disposed = true;
      subscription.dispose();
      clear();
    },
  };
}
