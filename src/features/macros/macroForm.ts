import { t } from "../../i18n/i18n";
import { DEFAULT_TIMEOUT_SEC, MAX_TIMEOUT_SEC, MAX_WAIT_MS, type Macro, type Step, type StepKind } from "./macros";

/** One step as edited: every field kept, so switching the kind back loses nothing. */
export interface StepRow {
  /** Stable React key. */
  key: string;
  kind: StepKind;
  text: string;
  ms: string;
  timeoutSec: string;
}

export interface MacroForm {
  name: string;
  /** "" for no hotkey, otherwise "1".."9". */
  hotkey: string;
  rows: StepRow[];
}

let nextKey = 0;
const rowKey = () => `row-${nextKey++}`;

export const newRow = (): StepRow => ({
  key: rowKey(),
  kind: "send",
  text: "",
  ms: "1000",
  timeoutSec: String(DEFAULT_TIMEOUT_SEC),
});

function rowFromStep(step: Step): StepRow {
  const row = newRow();
  switch (step.kind) {
    case "send":
      return { ...row, text: step.text };
    case "wait":
      return { ...row, kind: "wait", ms: String(step.ms) };
    case "waitFor":
      return { ...row, kind: "waitFor", text: step.text, timeoutSec: String(step.timeoutSec) };
  }
}

export const formFromMacro = (macro: Macro): MacroForm => ({
  name: macro.name,
  hotkey: macro.hotkey === undefined ? "" : String(macro.hotkey),
  rows: macro.steps.map(rowFromStep),
});

const wholeIn = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
};

export type FormResult = { ok: true; macro: Macro } | { ok: false; error: string };

export function parseMacroForm(form: MacroForm, id: string): FormResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: t("macros.form.nameRequired") };
  const steps: Step[] = [];
  for (const [i, row] of form.rows.entries()) {
    const n = i + 1;
    if (row.kind === "send") steps.push({ kind: "send", text: row.text });
    else if (row.kind === "wait") {
      const ms = wholeIn(row.ms, 0, MAX_WAIT_MS);
      if (ms === null) return { ok: false, error: t("macros.form.invalidWait", { n, max: MAX_WAIT_MS }) };
      steps.push({ kind: "wait", ms });
    } else {
      if (row.text === "") return { ok: false, error: t("macros.form.waitForTextRequired", { n }) };
      const timeoutSec = wholeIn(row.timeoutSec, 1, MAX_TIMEOUT_SEC);
      if (timeoutSec === null) {
        return { ok: false, error: t("macros.form.invalidTimeout", { n, max: MAX_TIMEOUT_SEC }) };
      }
      steps.push({ kind: "waitFor", text: row.text, timeoutSec });
    }
  }
  const macro: Macro = { id, name, steps };
  if (form.hotkey !== "") macro.hotkey = Number(form.hotkey);
  return { ok: true, macro };
}

/** `items` with item `index` moved by `delta` (-1 up, +1 down); unchanged past either end. */
export function moveRow<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}
