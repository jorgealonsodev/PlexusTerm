/**
 * Highlight rules: regular expressions of the user's whose matches are coloured in every terminal,
 * like the error colours, and that can ask for attention when they show up (log lines, an IP, a
 * word you are waiting for).
 */

export interface HighlightRule {
  pattern: string;
  /** `#rrggbb`. */
  color: string;
  matchCase: boolean;
  /** Ask for attention (tab mark, desktop notification) when new output matches. */
  notify: boolean;
}

export const MAX_RULES = 50;
const MAX_PATTERN = 500;
export const DEFAULT_RULE_COLOR = "#e5c07b";
/** Only the start of a very long line is searched, so a costly expression cannot freeze a terminal. */
export const MAX_LINE = 4096;

const hexColor = (value: unknown) =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : DEFAULT_RULE_COLOR;

/** The rule a new install starts with, as an example to copy: IPv4 addresses in cyan. */
export const EXAMPLE_RULE: HighlightRule = {
  pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
  color: "#56b6c2",
  matchCase: false,
  notify: false,
};

/** The rules kept in settings.json; ones without a pattern are dropped. */
export function parseHighlightRules(value: unknown): HighlightRule[] {
  if (!Array.isArray(value)) return [];
  const rules: HighlightRule[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const pattern = typeof raw.pattern === "string" ? raw.pattern.slice(0, MAX_PATTERN) : "";
    if (!pattern.trim()) continue;
    rules.push({ pattern, color: hexColor(raw.color), matchCase: raw.matchCase === true, notify: raw.notify === true });
    if (rules.length === MAX_RULES) break;
  }
  return rules;
}

const regexOf = (rule: HighlightRule) => new RegExp(rule.pattern, rule.matchCase ? "gu" : "giu");

/** Why a rule's expression cannot be used, or null when it can. */
export function ruleError(rule: HighlightRule): string | null {
  try {
    regexOf(rule);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** A rule ready to search: null where its expression is invalid (it is skipped). */
export interface CompiledRule {
  regex: RegExp | null;
  color: string;
  notify: boolean;
}

export const compileRules = (rules: readonly HighlightRule[]): CompiledRule[] =>
  rules.map((rule) => ({
    regex: ruleError(rule) === null ? regexOf(rule) : null,
    color: rule.color,
    notify: rule.notify,
  }));

/** One match: columns `start`..`end` of the line text, the colour, and the index of its rule. */
export interface RuleMatch {
  start: number;
  end: number;
  color: string;
  rule: number;
}

/** Every non-empty match of every rule in `text`, rule after rule. */
export function ruleMatches(text: string, rules: readonly CompiledRule[]): RuleMatch[] {
  const line = text.slice(0, MAX_LINE);
  const found: RuleMatch[] = [];
  rules.forEach(({ regex, color }, rule) => {
    if (!regex) return;
    regex.lastIndex = 0;
    for (const match of line.matchAll(regex)) {
      if (match[0].length === 0) continue;
      found.push({ start: match.index, end: match.index + match[0].length, color, rule });
    }
  });
  return found;
}
