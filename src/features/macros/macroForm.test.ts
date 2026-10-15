import { describe, expect, it } from "vitest";
import { formFromMacro, moveRow, newRow, parseMacroForm } from "./macroForm";
import type { Macro } from "./macros";

const macro: Macro = {
  id: "m1",
  name: "login",
  hotkey: 2,
  steps: [
    { kind: "send", text: "ssh h\\r" },
    { kind: "wait", ms: 250 },
    { kind: "waitFor", text: "password:", timeoutSec: 5 },
  ],
};

describe("macro form (S16.4)", () => {
  it("round-trips a macro", () => {
    expect(parseMacroForm(formFromMacro(macro), "m1")).toEqual({ ok: true, macro });
  });

  it("new rows are empty sends, and a new waitFor defaults to 10 seconds", () => {
    const row = newRow();
    expect(row).toMatchObject({ kind: "send", text: "" });
    const form = { name: "x", hotkey: "", rows: [{ ...row, kind: "waitFor" as const, text: "$" }] };
    expect(parseMacroForm(form, "id")).toEqual({
      ok: true,
      macro: { id: "id", name: "x", steps: [{ kind: "waitFor", text: "$", timeoutSec: 10 }] },
    });
  });

  it("requires a name and valid numbers", () => {
    const form = formFromMacro(macro);
    expect(parseMacroForm({ ...form, name: " " }, "m1")).toEqual({ ok: false, error: "Enter a name." });
    const badWait = { ...form, rows: form.rows.map((r, i) => (i === 1 ? { ...r, ms: "-5" } : r)) };
    expect(parseMacroForm(badWait, "m1")).toEqual({
      ok: false,
      error: "Step 2: the wait must be a whole number of milliseconds from 0 to 3600000.",
    });
    const badTimeout = { ...form, rows: form.rows.map((r, i) => (i === 2 ? { ...r, timeoutSec: "0" } : r)) };
    expect(parseMacroForm(badTimeout, "m1")).toEqual({
      ok: false,
      error: "Step 3: the timeout must be a whole number of seconds from 1 to 3600.",
    });
    const emptyWaitFor = { ...form, rows: form.rows.map((r, i) => (i === 2 ? { ...r, text: "" } : r)) };
    expect(parseMacroForm(emptyWaitFor, "m1")).toEqual({ ok: false, error: "Step 3: enter the text to wait for." });
  });

  it("moves rows up and down, ignoring moves past the ends", () => {
    expect(moveRow(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveRow(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveRow(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveRow(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
