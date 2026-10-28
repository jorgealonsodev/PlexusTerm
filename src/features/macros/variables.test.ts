import { describe, expect, it } from "vitest";
import { parseEscapes, type Macro } from "./macros";
import { fillMacro, macroVariables, parseTemplate } from "./variables";

const macro = (steps: Macro["steps"]): Macro => ({ id: "m", name: "M", steps });

describe("macro variables (S4)", () => {
  it("lists the distinct variables of every text step in order of first appearance", () => {
    const m = macro([
      { kind: "send", text: "docker logs -f {{container}} --since {{since}}\\r" },
      { kind: "wait", ms: 100 },
      { kind: "waitFor", text: "{{prompt}}", timeoutSec: 5 },
      { kind: "send", text: "echo {{since}} {{container}}\\r" },
    ]);
    expect(macroVariables(m)).toEqual([{ name: "container" }, { name: "since" }, { name: "prompt" }]);
  });

  it("reads {{name:default}} and keeps the first default given for a name", () => {
    const m = macro([
      { kind: "send", text: "ssh {{user}}@{{host:db1}} -p {{port:22}}" },
      { kind: "send", text: "{{user:root}} {{host:other}} {{empty:}}" },
    ]);
    expect(macroVariables(m)).toEqual([
      { name: "user", default: "root" },
      { name: "host", default: "db1" },
      { name: "port", default: "22" },
      { name: "empty", default: "" },
    ]);
  });

  it("types {{{{ as a literal {{ and leaves malformed braces as typed", () => {
    expect(parseTemplate("a {{{{x}} b")).toEqual([{ kind: "text", text: "a {{x}} b" }]);
    for (const text of ["{{}}", "{{1x}}", "{{a b}}", "{{a", "{a}", "}}", "{{a:b{c}}"]) {
      expect(parseTemplate(text)).toEqual([{ kind: "text", text }]);
    }
    expect(parseTemplate("{{{a}}")).toEqual([
      { kind: "text", text: "{" },
      { kind: "var", name: "a" },
    ]);
    expect(macroVariables(macro([{ kind: "send", text: "{{{{x}} {{a b}}" }]))).toEqual([]);
  });

  it("substitutes the values in send and wait-for steps; values are typed as is", () => {
    const m: Macro = {
      id: "m",
      name: "Logs",
      hotkey: 3,
      steps: [
        { kind: "send", text: "docker logs -f {{container}} {{{{raw}}\\r" },
        { kind: "wait", ms: 10 },
        { kind: "waitFor", text: "{{container}} ready", timeoutSec: 5 },
      ],
    };
    const filled = fillMacro(m, { container: "web\\r^C" });
    expect(filled).toMatchObject({ id: "m", name: "Logs", hotkey: 3 });
    expect(filled.steps[1]).toEqual({ kind: "wait", ms: 10 });
    // The player parses escapes in step texts; the value comes out exactly as typed.
    const send = filled.steps[0];
    const waitFor = filled.steps[2];
    expect(send.kind === "send" && parseEscapes(send.text)).toBe("docker logs -f web\\r^C {{raw}}\r");
    expect(waitFor.kind === "waitFor" && parseEscapes(waitFor.text)).toBe("web\\r^C ready");
  });

  it("leaves a macro without variables untouched", () => {
    const m = macro([{ kind: "send", text: "ls {x} }}\\r" }]);
    expect(macroVariables(m)).toEqual([]);
    expect(fillMacro(m, {})).toBe(m);
  });
});
