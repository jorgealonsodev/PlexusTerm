import { describe, expect, it } from "vitest";
import {
  compileRules,
  EXAMPLE_RULE,
  DEFAULT_RULE_COLOR,
  MAX_ACTION_TEXT,
  MAX_RULES,
  actionInput,
  parseHighlightRules,
  ruleError,
  ruleMatches,
  type HighlightRule,
} from "./highlightRules";

const rule = (pattern: string, extra: Partial<HighlightRule> = {}): HighlightRule => ({
  pattern,
  color: "#ff0000",
  matchCase: false,
  notify: false,
  ...extra,
});

describe("parseHighlightRules", () => {
  it("keeps well-formed rules and fills what is missing or wrong", () => {
    expect(
      parseHighlightRules([
        { pattern: "ERROR", color: "#FF8800", matchCase: true, notify: true },
        { pattern: "\\d+\\.\\d+\\.\\d+\\.\\d+", color: "red", matchCase: "yes" },
      ]),
    ).toEqual([
      { pattern: "ERROR", color: "#ff8800", matchCase: true, notify: true },
      { pattern: "\\d+\\.\\d+\\.\\d+\\.\\d+", color: DEFAULT_RULE_COLOR, matchCase: false, notify: false },
    ]);
  });

  it("drops rules without a pattern, anything that is not a list, and keeps at most MAX_RULES", () => {
    expect(parseHighlightRules([{ pattern: "  " }, { color: "#ffffff" }, "ERROR", null])).toEqual([]);
    expect(parseHighlightRules("ERROR")).toEqual([]);
    expect(parseHighlightRules(Array.from({ length: MAX_RULES + 5 }, (_, i) => ({ pattern: `p${i}` })))).toHaveLength(MAX_RULES);
  });
});

describe("rule actions", () => {
  it("keeps old rules without an action unchanged", () => {
    const [old] = parseHighlightRules([{ pattern: "ERROR", color: "#ff8800", matchCase: true, notify: true }]);
    expect(old).toStrictEqual({ pattern: "ERROR", color: "#ff8800", matchCase: true, notify: true });
  });

  it("keeps send-text and play-macro actions, bounds the text and drops unknown or empty ones", () => {
    const parsed = parseHighlightRules([
      { pattern: "\\[y/N\\]", action: { kind: "send", text: "y\\n" } },
      { pattern: "deploy done", action: { kind: "macro", macroId: "m1" } },
      { pattern: "long", action: { kind: "send", text: "x".repeat(MAX_ACTION_TEXT + 10) } },
      { pattern: "unknown", action: { kind: "run", command: "rm" } },
      { pattern: "empty", action: { kind: "send", text: "" } },
      { pattern: "nomacro", action: { kind: "macro", macroId: 3 } },
    ]);
    expect(parsed.map((r) => r.action)).toEqual([
      { kind: "send", text: "y\\n" },
      { kind: "macro", macroId: "m1" },
      { kind: "send", text: "x".repeat(MAX_ACTION_TEXT) },
      undefined,
      undefined,
      undefined,
    ]);
    expect("action" in parsed[3]).toBe(false);
  });

  it("types \\n as Enter and keeps the other escapes of macros", () => {
    expect(actionInput("y\\n")).toBe("y\r");
    expect(actionInput("a\\r\\nb\\tc")).toBe("a\rb\tc");
    expect(actionInput("plain")).toBe("plain");
  });

  it("hands each rule's action to the compiled rule", () => {
    const [none, send] = compileRules([rule("a"), rule("b", { action: { kind: "send", text: "y" } })]);
    expect(none.action).toBeNull();
    expect(send.action).toEqual({ kind: "send", text: "y" });
  });
});

describe("ruleError", () => {
  it("explains a regular expression that cannot be used, and accepts the others", () => {
    expect(ruleError(rule("ERROR|WARN"))).toBeNull();
    expect(ruleError(rule("(unclosed"))).toMatch(/.+/);
  });
});

describe("the example rule", () => {
  it("finds IPv4 addresses, not version numbers", () => {
    const rules = compileRules([EXAMPLE_RULE]);
    const found = (text: string) => ruleMatches(text, rules).map((m) => text.slice(m.start, m.end));
    expect(found("ping 192.168.1.20 from 10.0.0.1")).toEqual(["192.168.1.20", "10.0.0.1"]);
    expect(found("node v20.11.1 and 1.2.3")).toEqual([]);
  });
});

describe("ruleMatches", () => {
  it("finds every match of every rule with its colour, ignoring case unless asked", () => {
    const rules = compileRules([rule("error"), rule("10\\.0\\.\\d+\\.\\d+", { color: "#00ff00" })]);
    expect(ruleMatches("ERROR: 10.0.0.1 and error on 10.0.3.4", rules)).toEqual([
      { start: 0, end: 5, color: "#ff0000", rule: 0 },
      { start: 20, end: 25, color: "#ff0000", rule: 0 },
      { start: 7, end: 15, color: "#00ff00", rule: 1 },
      { start: 29, end: 37, color: "#00ff00", rule: 1 },
    ]);
    const exact = compileRules([rule("ERROR", { matchCase: true })]);
    expect(ruleMatches("error ERROR", exact)).toEqual([{ start: 6, end: 11, color: "#ff0000", rule: 0 }]);
  });

  it("skips invalid rules and matches of nothing, and never loops on them", () => {
    const rules = compileRules([rule("(bad"), rule("x*"), rule("ok")]);
    expect(ruleMatches("xx ok", rules)).toEqual([
      { start: 0, end: 2, color: "#ff0000", rule: 1 },
      { start: 3, end: 5, color: "#ff0000", rule: 2 },
    ]);
  });
});
