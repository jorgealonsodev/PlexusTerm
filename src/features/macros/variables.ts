import { formatEscapes, parseEscapes, type Macro, type Step } from "./macros";

/**
 * Macro variables (S4): `{{name}}` or `{{name:default}}` in a send or wait-for text asks for a value
 * before the macro plays. `{{{{` types a literal `{{`; braces that do not form a variable stay as typed.
 * Values are typed as is: escapes such as \r in a value are not interpreted.
 */

export interface MacroVariable {
  name: string;
  /** From the first `{{name:default}}` of the macro. */
  default?: string;
}

export type Segment = { kind: "text"; text: string } | { kind: "var"; name: string; default?: string };

/** A variable at the start of the text: the name, then an optional default without braces. */
const VARIABLE = /^\{\{([A-Za-z_][A-Za-z0-9_-]*)(?::([^{}]*))?\}\}/;
const ESCAPED_BRACES = "{{{{";

/** Splits a step text into literal text and variables; adjacent literal text is merged. */
export function parseTemplate(text: string): Segment[] {
  const segments: Segment[] = [];
  const literal = (s: string) => {
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += s;
    else segments.push({ kind: "text", text: s });
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(ESCAPED_BRACES, i)) {
      literal("{{");
      i += ESCAPED_BRACES.length;
      continue;
    }
    const match = text[i] === "{" ? VARIABLE.exec(text.slice(i)) : null;
    if (match) {
      segments.push(match[2] === undefined ? { kind: "var", name: match[1] } : { kind: "var", name: match[1], default: match[2] });
      i += match[0].length;
      continue;
    }
    literal(text[i]);
    i++;
  }
  return segments;
}

const stepText = (step: Step) => (step.kind === "wait" ? null : step.text);

/** The distinct variables of the macro's texts, in order of first appearance. */
export function macroVariables(macro: Macro): MacroVariable[] {
  const found = new Map<string, MacroVariable>();
  for (const step of macro.steps) {
    const text = stepText(step);
    if (text === null) continue;
    for (const s of parseTemplate(text)) {
      if (s.kind !== "var") continue;
      const known = found.get(s.name);
      if (!known) found.set(s.name, s.default === undefined ? { name: s.name } : { name: s.name, default: s.default });
      else if (known.default === undefined && s.default !== undefined) known.default = s.default;
    }
  }
  return [...found.values()];
}

/** The text with `values` in place of its variables, still written with escapes for the player. */
function fillText(text: string, values: Record<string, string>): string {
  const segments = parseTemplate(text);
  // Nothing to fill: the text stays exactly as written.
  if (!segments.some((s) => s.kind === "var") && !text.includes(ESCAPED_BRACES)) return text;
  const raw = segments
    .map((s) => (s.kind === "text" ? parseEscapes(s.text) : (values[s.name] ?? s.default ?? "")))
    .join("");
  return formatEscapes(raw);
}

/** The macro with `values` substituted; a macro without variables is returned as is. */
export function fillMacro(macro: Macro, values: Record<string, string>): Macro {
  if (macroVariables(macro).length === 0) return macro;
  return {
    ...macro,
    steps: macro.steps.map((step) => (step.kind === "wait" ? step : { ...step, text: fillText(step.text, values) })),
  };
}
