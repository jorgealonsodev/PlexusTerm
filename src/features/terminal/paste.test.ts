import { describe, expect, it } from "vitest";
import { pastePlan } from "./paste";

const ask = { confirmMultilinePaste: true };
const dontAsk = { confirmMultilinePaste: false };

describe("pastePlan", () => {
  it("pastes a single line directly", () => {
    expect(pastePlan("ls -la", ask)).toEqual({ kind: "direct", text: "ls -la" });
  });

  it("does not count a final line break as another line", () => {
    expect(pastePlan("ls -la\n", ask)).toEqual({ kind: "direct", text: "ls -la\n" });
  });

  it("asks before pasting more than one line, with the line count and the first 5 lines", () => {
    const text = "a\nb\r\nc\rd\ne\nf\ng\n";
    expect(pastePlan(text, ask)).toEqual({
      kind: "confirm",
      text,
      lineCount: 7,
      preview: ["a", "b", "c", "d", "e"],
    });
    expect(pastePlan("one\ntwo", ask)).toEqual({ kind: "confirm", text: "one\ntwo", lineCount: 2, preview: ["one", "two"] });
  });

  it("pastes several lines directly when confirmation is turned off", () => {
    expect(pastePlan("one\ntwo", dontAsk)).toEqual({ kind: "direct", text: "one\ntwo" });
  });

  it("pastes an empty clipboard as an empty paste, so a program can read an image from the clipboard itself", () => {
    expect(pastePlan("", ask)).toEqual({ kind: "direct", text: "" });
  });
});
