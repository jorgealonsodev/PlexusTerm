/**
 * Quick select: labels over the URLs, file paths, IP addresses, git hashes and e-mail addresses on
 * screen; typing a label copies its text (Shift opens it). Pure: the pane gives it the lines on
 * screen and draws the labels.
 */
import type { KeyLike } from "../panes/shortcuts";
import { findPathCandidates, URLS } from "./fileLinks";

export type QuickKind = "url" | "path" | "ip" | "hash" | "email";

/** A match on screen: its text and the buffer row and column it starts at. */
export interface QuickHit {
  kind: QuickKind;
  text: string;
  row: number;
  col: number;
}

export interface QuickMatch extends QuickHit {
  label: string;
}

/** A line of text on screen (wrapped rows joined) and the buffer row it starts on. */
export interface ScreenLine {
  text: string;
  row: number;
}

/**
 * The rows on screen joined into lines: a row xterm wrapped from the one above continues it.
 * Rows followed by a wrapped one must come untrimmed, so that columns stay right.
 */
export function viewportLines(rows: readonly { text: string; wrapped: boolean }[], firstRow: number): ScreenLine[] {
  const lines: ScreenLine[] = [];
  rows.forEach((row, i) => {
    const last = lines[lines.length - 1];
    if (row.wrapped && last) last.text += row.text;
    else lines.push({ text: row.text, row: firstRow + i });
  });
  return lines;
}

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`(?<![\\w.])${OCTET}(?:\\.${OCTET}){3}(?![\\w.]*\\w)`, "g");
/** Full IPv6 (eight groups) or with `::`; times (12:30:45) and C++ names (std::vector) are left out. */
const IPV6 =
  /(?<![\w:.])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4}::(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{0,4})(?![\w:])/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** 7 to 40 hex characters with at least one digit and one letter (`1234567` and `defaced` are words). */
const HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;

/** A URL without what usually ends the sentence around it: a final dot or comma, an unopened bracket. */
function trimUrl(url: string): string {
  let text = url;
  for (;;) {
    const before = text;
    text = text.replace(/[.,;:!?'"]+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["<", ">"],
    ]) {
      if (text.endsWith(close) && text.split(open).length < text.split(close).length) text = text.slice(0, -1);
    }
    if (text === before) return text;
  }
}

const validIpv6 = (text: string) => text.length > 2 && text.split("::").length <= 2;

/**
 * Every match in `lines`, in reading order. URLs win over what is inside them, then e-mail
 * addresses, IP addresses, paths (with a folder in them, as Ctrl+click links them) and hashes.
 * `cols` places a match of a wrapped line on the row it starts on.
 */
export function findQuickMatches(lines: readonly ScreenLine[], cols: number): QuickHit[] {
  const hits: QuickHit[] = [];
  for (const line of lines) {
    const found: { kind: QuickKind; start: number; text: string }[] = [];
    const free = (start: number, end: number) => found.every((f) => end <= f.start || start >= f.start + f.text.length);
    const add = (kind: QuickKind, start: number, text: string) => {
      if (text && free(start, start + text.length)) found.push({ kind, start, text });
    };
    for (const m of line.text.matchAll(URLS)) add("url", m.index, trimUrl(m[0]));
    for (const m of line.text.matchAll(EMAIL)) add("email", m.index, m[0].replace(/\.+$/, ""));
    for (const m of line.text.matchAll(IPV4)) add("ip", m.index, m[0]);
    for (const m of line.text.matchAll(IPV6)) if (validIpv6(m[0])) add("ip", m.index, m[0]);
    for (const p of findPathCandidates(line.text)) if (/[\\/]/.test(p.text)) add("path", p.start, p.text);
    for (const m of line.text.matchAll(HASH)) add("hash", m.index, m[0]);
    found.sort((a, b) => a.start - b.start);
    for (const f of found) {
      hits.push({
        kind: f.kind,
        text: f.text,
        row: line.row + Math.floor(f.start / cols),
        col: f.start % cols,
      });
    }
  }
  return hits;
}

/** Label letters, the home row first. */
const LETTERS = "asdfghjklqwertyuiopzxcvbnm";

/**
 * `count` unique labels: one letter each while they fit, else the first letters alone and the
 * rest as the first letter of two (no label starts another). At most 26 × 26.
 */
export function quickLabels(count: number): string[] {
  const n = LETTERS.length;
  const wanted = Math.min(count, n * n);
  const singles = Math.max(0, Math.min(n, Math.floor((n * n - wanted) / (n - 1))));
  const labels = [...LETTERS.slice(0, singles)];
  for (const first of LETTERS.slice(singles)) {
    for (const second of LETTERS) {
      if (labels.length >= wanted) return labels;
      labels.push(first + second);
    }
  }
  return labels.slice(0, wanted);
}

/** The hits with their labels; hits past the last label are left out. */
export function labelHits(hits: readonly QuickHit[]): QuickMatch[] {
  const labels = quickLabels(hits.length);
  return labels.map((label, i) => ({ ...hits[i], label }));
}

/** The letters typed so far, and the match picked (`open` when typed with Shift) or the wish to leave. */
export interface QuickStep {
  typed: string;
  pick?: { match: QuickMatch; open: boolean };
  exit?: boolean;
}

/** Applies one key to the letters typed so far. Shift on any letter of a label opens it. */
export function quickSelectKey(typed: string, e: KeyLike, matches: readonly QuickMatch[]): QuickStep {
  if (e.key === "Escape") return { typed: "", exit: true };
  if (e.key === "Backspace") return { typed: typed.replace(/.$/, "") };
  if (e.ctrlKey || e.altKey || e.metaKey || !/^[a-z]$/i.test(e.key)) return { typed };
  // Shift on an earlier letter is kept as an upper-case letter in `typed`.
  const next = typed + (e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase());
  const wanted = next.toLowerCase();
  const match = matches.find((m) => m.label === wanted);
  if (match) return { typed: "", pick: { match, open: next !== wanted } };
  return { typed: matches.some((m) => m.label.startsWith(wanted)) ? next : "" };
}
