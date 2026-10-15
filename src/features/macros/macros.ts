/**
 * Macros (S16): named lists of steps played into the focused terminal pane.
 * Send and waitFor texts are stored with escapes (see `parseEscapes`), so the file stays readable.
 * Macros are plain text: nothing is masked or filtered, passwords included (S16.5).
 */

export type Step =
  | { kind: "send"; text: string }
  | { kind: "wait"; ms: number }
  /** Waits until the pane's output contains `text`, failing after `timeoutSec` seconds. */
  | { kind: "waitFor"; text: string; timeoutSec: number };

export type StepKind = Step["kind"];

export interface Macro {
  id: string;
  name: string;
  /** Ctrl+Alt+`hotkey` plays the macro; unique among macros. */
  hotkey?: number;
  steps: Step[];
}

export interface MacroList {
  version: 1;
  macros: Macro[];
}

export const emptyMacros: MacroList = { version: 1, macros: [] };

export const HOTKEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const MAX_WAIT_MS = 3_600_000;
export const MAX_TIMEOUT_SEC = 3600;
export const DEFAULT_TIMEOUT_SEC = 10;

export const hotkeyLabel = (hotkey: number) => `Ctrl+Alt+${hotkey}`;

const ESCAPES: Record<string, string> = { r: "\r", n: "\n", t: "\t", e: "\x1b", "\\": "\\" };
const HEX = /^[0-9a-fA-F]{2}$/;

/**
 * Text with escapes as typed in a step: \r \n \t \e \\ \xHH, and ^A..^Z, ^[ (ESC), ^? (DEL).
 * Anything else, e.g. \q or ^a, is left as written.
 */
export function parseEscapes(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "\\" && next !== undefined) {
      if (next in ESCAPES) {
        out += ESCAPES[next];
        i++;
        continue;
      }
      const hex = text.slice(i + 2, i + 4);
      if (next === "x" && HEX.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 3;
        continue;
      }
    } else if (c === "^" && next !== undefined) {
      const control = caretControl(next);
      if (control !== null) {
        out += control;
        i++;
        continue;
      }
    }
    out += c;
  }
  return out;
}

/** The control character for `^next`, or null when `^next` is literal text. */
function caretControl(next: string): string | null {
  if (next >= "A" && next <= "Z") return String.fromCharCode(next.charCodeAt(0) - 64);
  if (next === "[") return "\x1b";
  if (next === "?") return "\x7f";
  return null;
}

const hex2 = (code: number) => `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;

/** The inverse of `parseEscapes`, for showing raw text (e.g. recorded keystrokes) in a step. */
export function formatEscapes(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    if (c === "\r") out += "\\r";
    else if (c === "\n") out += "\\n";
    else if (c === "\t") out += "\\t";
    else if (c === "\x1b") out += "\\e";
    else if (c === "\\") out += "\\\\";
    else if (c === "\x7f") out += "^?";
    else if (code >= 1 && code <= 26) out += `^${String.fromCharCode(code + 64)}`;
    else if (code < 0x20) out += hex2(code);
    // A caret that would read as a control character is written as its code.
    else if (c === "^" && i + 1 < raw.length && caretControl(raw[i + 1]) !== null) out += hex2(code);
    else out += c;
  }
  return out;
}

export type MacroAction =
  | { type: "save"; macro: Macro }
  | { type: "delete"; id: string }
  /** `newId` keeps the reducer pure. */
  | { type: "duplicate"; id: string; newId: string };

/** Gives `hotkey` to `id` only: any other macro that used it loses it (S16.4). */
const withHotkeyMovedTo = (macros: Macro[], id: string, hotkey: number | undefined) =>
  hotkey === undefined ? macros : macros.map((m) => (m.id !== id && m.hotkey === hotkey ? pick({ ...m, hotkey: undefined }) : m));

export function macrosReducer(list: MacroList, action: MacroAction): MacroList {
  switch (action.type) {
    case "save": {
      const macro = pick(action.macro);
      const others = withHotkeyMovedTo(list.macros, macro.id, macro.hotkey);
      const exists = others.some((m) => m.id === macro.id);
      return { ...list, macros: exists ? others.map((m) => (m.id === macro.id ? macro : m)) : [...others, macro] };
    }
    case "delete":
      return { ...list, macros: list.macros.filter((m) => m.id !== action.id) };
    case "duplicate": {
      const index = list.macros.findIndex((m) => m.id === action.id);
      if (index === -1) return list;
      const original = list.macros[index];
      const copy = pick({ id: action.newId, name: `${original.name} (copy)`, steps: original.steps });
      return { ...list, macros: [...list.macros.slice(0, index + 1), copy, ...list.macros.slice(index + 1)] };
    }
  }
}

function pickStep(s: Step): Step {
  switch (s.kind) {
    case "send":
      return { kind: "send", text: s.text };
    case "wait":
      return { kind: "wait", ms: s.ms };
    case "waitFor":
      return { kind: "waitFor", text: s.text, timeoutSec: s.timeoutSec };
  }
}

/** Keeps only the saved fields, so nothing else is ever written. */
function pick(m: Macro): Macro {
  const macro: Macro = { id: m.id, name: m.name, steps: m.steps.map(pickStep) };
  if (m.hotkey !== undefined) macro.hotkey = m.hotkey;
  return macro;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isIntIn = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

function isStep(v: unknown): v is Step {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  switch (s.kind) {
    case "send":
      return isString(s.text);
    case "wait":
      return isIntIn(s.ms, 0, MAX_WAIT_MS);
    case "waitFor":
      return isString(s.text) && s.text !== "" && isIntIn(s.timeoutSec, 1, MAX_TIMEOUT_SEC);
    default:
      return false;
  }
}

function isMacro(v: unknown): v is Macro {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    isString(m.id) &&
    isString(m.name) &&
    (m.hotkey === undefined || isIntIn(m.hotkey, 1, 9)) &&
    Array.isArray(m.steps) &&
    m.steps.every(isStep)
  );
}

export type ParseResult = { ok: true; list: MacroList } | { ok: false; error: string };

/** A missing file is an empty list; anything unreadable is an error, never silently emptied. */
export function parseMacros(json: string | null): ParseResult {
  if (json === null) return { ok: true, list: emptyMacros };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { ok: false, error: `macros file is not valid JSON: ${String(err)}` };
  }
  const list = data as Partial<MacroList>;
  if (list?.version !== 1) return { ok: false, error: "unsupported macros file version" };
  if (!Array.isArray(list.macros) || !list.macros.every(isMacro)) {
    return { ok: false, error: "macros file has invalid macros" };
  }
  const used = new Set<number>();
  for (const m of list.macros) {
    if (m.hotkey === undefined) continue;
    if (used.has(m.hotkey)) return { ok: false, error: `macros file has two macros on ${hotkeyLabel(m.hotkey)}` };
    used.add(m.hotkey);
  }
  return { ok: true, list: { version: 1, macros: list.macros.map(pick) } };
}

export function serializeMacros(list: MacroList): string {
  return JSON.stringify({ version: 1, macros: list.macros.map(pick) }, null, 2);
}

/**
 * Recording (S16.2): raw input chunks (keystrokes or a paste) merged into one text per line;
 * a chunk ending with Enter closes its step.
 */
export function recorderReduce(raw: string[], data: string): string[] {
  if (data === "") return raw;
  const last = raw[raw.length - 1];
  if (last === undefined || last.endsWith("\r") || last.endsWith("\n")) return [...raw, data];
  return [...raw.slice(0, -1), last + data];
}

/** The recorded chunks as send steps, written with escapes. */
export const recordedSteps = (raw: string[]): Step[] => raw.map((text) => ({ kind: "send", text: formatEscapes(text) }));
