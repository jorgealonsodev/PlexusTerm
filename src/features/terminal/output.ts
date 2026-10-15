/**
 * One complete escape sequence starting at an ESC: OSC (ended by BEL or ST), DCS/SOS/PM/APC
 * strings (ended by ST), CSI, or a short ESC sequence such as a charset designation (ESC ( B)
 * or ESC 7 / ESC = (intermediates 0x20-0x2F, then one final byte 0x30-0x7E).
 */
const SEQUENCE =
  "\\x1b(?:\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|[PX^_][\\s\\S]*?\\x1b\\\\|\\[[0-?]*[ -/]*[@-~]|(?![\\[\\]PX^_])[ -/]*[0-~])";

const STRIP = new RegExp(`${SEQUENCE}|\\x1b|\\x07`, "g");

/** Terminal output as plain text for a log file: escape sequences and bells removed, CRLF as LF. */
export function stripAnsi(text: string): string {
  return text.replace(STRIP, "").replace(/\r\n/g, "\n");
}

/**
 * Splits output into the part that can be stripped now and a tail to keep for the next chunk:
 * an escape sequence cut by the chunk boundary, or a final CR whose LF may follow.
 */
export function splitIncompleteEscape(text: string): [complete: string, rest: string] {
  const sequence = new RegExp(SEQUENCE, "y");
  let at = text.indexOf("\x1b");
  while (at !== -1) {
    sequence.lastIndex = at;
    if (!sequence.test(text)) return [text.slice(0, at), text.slice(at)];
    at = text.indexOf("\x1b", sequence.lastIndex);
  }
  return text.endsWith("\r") ? [text.slice(0, -1), "\r"] : [text, ""];
}

/** One row of the terminal buffer: its text and whether it continues the previous row. */
export interface BufferLine {
  text: string;
  isWrapped: boolean;
}

/** The scrollback as a text file: wrapped rows joined, lines trimmed right, no trailing blank lines. */
export function bufferText(rows: BufferLine[]): string {
  const lines: string[] = [];
  for (const row of rows) {
    if (row.isWrapped && lines.length > 0) lines[lines.length - 1] += row.text;
    else lines.push(row.text);
  }
  const trimmed = lines.map((line) => line.trimEnd());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  return trimmed.length === 0 ? "" : `${trimmed.join("\n")}\n`;
}
