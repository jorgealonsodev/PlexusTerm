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
 * write; rows in the scrollback can no longer change.
 */
export function attachErrorHighlight(
  term: HighlightTerminal,
  options: { enabled: () => boolean; color: () => string },
): ErrorHighlight {
  let coloured: Coloured[] = [];
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

    // Rows that left the scrollback took their marker and decoration with them.
    coloured = coloured.filter((c) => !c.marker.isDisposed);
    // A screen row that no longer reads as an error (cleared, overwritten) loses its colour.
    coloured = coloured.filter((c) => {
      if (c.marker.line < buffer.baseY || isErrorLine(lineAt(c.marker.line, Math.max(end, c.marker.line + 1)).text)) return true;
      c.decoration.dispose();
      c.marker.dispose();
      return false;
    });

    // Without a marker (it left the scrollback) everything is read again; when the cursor went
    // back above it, the screen was rewritten and is read again from its top.
    let start = next && !next.isDisposed ? next.line : 0;
    if (start > end) start = Math.min(buffer.baseY, end);
    if (start < end) {
      const decorated = new Set(coloured.map((c) => c.marker.line));
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
            if (decoration) coloured.push({ marker, decoration });
            else marker.dispose();
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
    coloured.forEach((c) => (c.decoration.dispose(), c.marker.dispose()));
    coloured = [];
    next?.dispose();
    next = null;
  };

  const subscription = term.onWriteParsed(safeScan);
  safeScan();

  return {
    refresh() {
      clear();
      safeScan();
    },
    dispose() {
      subscription.dispose();
      clear();
    },
  };
}
