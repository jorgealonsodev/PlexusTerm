import { describe, expect, it } from "vitest";
import {
  compileRules,
  EXAMPLE_RULE,
  DEFAULT_RULE_COLOR,
  MAX_RULES,
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
