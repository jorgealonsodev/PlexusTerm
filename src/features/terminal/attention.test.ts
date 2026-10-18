import { describe, expect, it } from "vitest";
import { createOsc99Reader, parseOsc777, parseOsc9 } from "./attention";

describe("parseOsc9 (iTerm2 notifications)", () => {
  it("reads the message, as Codex and Claude Code send it", () => {
    expect(parseOsc9("Agent turn complete")).toEqual({ title: null, body: "Agent turn complete" });
    // Claude Code's iTerm2 channel puts two line breaks before the message.
    expect(parseOsc9("\n\nClaude needs your permission to use Bash")).toEqual({
      title: null,
      body: "Claude needs your permission to use Bash",
    });
  });

  it("ignores ConEmu / Windows Terminal progress and other numbered OSC 9 commands", () => {
    expect(parseOsc9("4;1;50")).toBeNull();
    expect(parseOsc9("4;0;")).toBeNull();
    expect(parseOsc9("9;C:\\Users")).toBeNull();
    expect(parseOsc9("1")).toBeNull();
  });

  it("still counts an empty message as a request for attention", () => {
    expect(parseOsc9("")).toEqual({ title: null, body: null });
  });
});

describe("parseOsc777 (notify;title;body)", () => {
  it("reads the title and the body, which may contain semicolons", () => {
    expect(parseOsc777("notify;Claude Code;Task done; 3 files changed")).toEqual({
      title: "Claude Code",
      body: "Task done; 3 files changed",
    });
    expect(parseOsc777("notify;Only a title")).toEqual({ title: "Only a title", body: null });
  });

  it("ignores other OSC 777 commands", () => {
    expect(parseOsc777("preexec")).toBeNull();
    expect(parseOsc777("precmd;x")).toBeNull();
  });
});

describe("createOsc99Reader (kitty desktop notifications)", () => {
  it("reads a one-part notification: the payload is the title by default", () => {
    const read = createOsc99Reader();
    expect(read(";Hello world")).toEqual({ title: "Hello world", body: null });
  });

  it("joins the parts of one notification until d=1, as Claude Code's kitty channel sends them", () => {
    const read = createOsc99Reader();
    expect(read("i=7:d=0:p=title;Claude Code")).toBeNull();
    expect(read("i=7:d=0:p=body;Waiting for your input")).toBeNull();
    expect(read("i=7:d=1:a=focus;")).toEqual({ title: "Claude Code", body: "Waiting for your input" });
  });

  it("decodes base64 payloads (e=1), UTF-8 included", () => {
    const read = createOsc99Reader();
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode("Listo ✓")));
    expect(read(`e=1:p=body;${b64}`)).toEqual({ title: null, body: "Listo ✓" });
  });

  it("ignores queries, icons, buttons and close requests", () => {
    const read = createOsc99Reader();
    expect(read("i=1:p=?;")).toBeNull();
    expect(read("i=1:p=close;")).toBeNull();
    expect(read("i=1:p=icon;AAAA")).toBeNull();
    expect(read("i=1:d=0:p=title;Build")).toBeNull();
    expect(read("i=1:d=0:p=buttons;Yes\u2028No")).toBeNull();
    expect(read("i=1:p=body;finished")).toEqual({ title: "Build", body: "finished" });
  });

  it("keeps a bounded number of unfinished notifications and bounded text", () => {
    const read = createOsc99Reader();
    for (let i = 0; i < 100; i++) read(`i=${i}:d=0;x`);
    expect(read("i=99:d=1;")).toEqual({ title: "x", body: null });
    expect(read("i=0:d=1;y")).toEqual({ title: "y", body: null });
    const long = read(`;${"a".repeat(10_000)}`);
    expect(long?.title?.length).toBeLessThanOrEqual(1000);
  });
});
