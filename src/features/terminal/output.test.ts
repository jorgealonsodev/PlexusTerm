import { describe, expect, it } from "vitest";
import { bufferText, splitIncompleteEscape, stripAnsi } from "./output";

const ESC = "\x1b";

describe("stripAnsi", () => {
  it("removes CSI sequences (colors, cursor moves, private modes)", () => {
    expect(stripAnsi(`${ESC}[1;31mred${ESC}[0m ${ESC}[2K${ESC}[10;5Hx${ESC}[?2004h`)).toBe("red x");
    expect(stripAnsi(`${ESC}[38;2;255;0;0mrgb${ESC}[m`)).toBe("rgb");
  });

  it("removes OSC sequences ended by BEL or ST", () => {
    expect(stripAnsi(`${ESC}]0;user@host: ~\x07$ ls`)).toBe("$ ls");
    expect(stripAnsi(`${ESC}]7;file://host/tmp${ESC}\\ok`)).toBe("ok");
  });

  it("removes charset designations and other bare ESC sequences", () => {
    expect(stripAnsi(`${ESC}(B${ESC})0a${ESC}=b${ESC}>c${ESC}7d${ESC}8e${ESC}Mf`)).toBe("abcdef");
  });

  it("removes DCS strings and bells, and turns CRLF into LF", () => {
    expect(stripAnsi(`${ESC}Pq#0;2;0;0;0${ESC}\\one\x07\r\ntwo\r\n`)).toBe("one\ntwo\n");
  });

  it("keeps plain text, tabs and UTF-8 as they are", () => {
    expect(stripAnsi("año\tüber ✓\n")).toBe("año\tüber ✓\n");
  });
});

describe("splitIncompleteEscape", () => {
  it("holds back an escape sequence cut at the end of a chunk", () => {
    expect(splitIncompleteEscape(`text${ESC}[1;3`)).toEqual(["text", `${ESC}[1;3`]);
    expect(splitIncompleteEscape(`text${ESC}`)).toEqual(["text", ESC]);
    expect(splitIncompleteEscape(`a${ESC}]0;title`)).toEqual(["a", `${ESC}]0;title`]);
    expect(splitIncompleteEscape("a\r")).toEqual(["a", "\r"]);
  });

  it("keeps complete text whole", () => {
    expect(splitIncompleteEscape(`a${ESC}[0mb`)).toEqual([`a${ESC}[0mb`, ""]);
    expect(splitIncompleteEscape(`a${ESC}]0;t\x07b`)).toEqual([`a${ESC}]0;t\x07b`, ""]);
    expect(splitIncompleteEscape("plain")).toEqual(["plain", ""]);
  });
});

describe("bufferText", () => {
  it("trims each line on the right, joins wrapped lines and drops trailing empty lines", () => {
    const lines = [
      { text: "$ echo hello   ", isWrapped: false },
      { text: "hello", isWrapped: false },
      { text: "a very long li", isWrapped: false },
      { text: "ne that wrapped  ", isWrapped: true },
      { text: "   ", isWrapped: false },
      { text: "", isWrapped: false },
    ];
    expect(bufferText(lines)).toBe("$ echo hello\nhello\na very long line that wrapped\n");
  });

  it("returns an empty string for an empty buffer", () => {
    expect(bufferText([{ text: "  ", isWrapped: false }])).toBe("");
  });
});
