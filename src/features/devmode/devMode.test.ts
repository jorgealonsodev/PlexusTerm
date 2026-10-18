import { describe, expect, it } from "vitest";
import {
  cleanDevCommands,
  cliOfCommand,
  cliOfTitle,
  DEFAULT_DEV_COMMANDS,
  devCommandsText,
  devReducer,
  parseDevCommands,
  type DevState,
} from "./devMode";

const commands = DEFAULT_DEV_COMMANDS;

describe("cliOfCommand (S10)", () => {
  it("turns on for each listed command run as the first word", () => {
    for (const cli of ["claude", "codex", "agy", "opencode", "pi", "gentle-shell"]) {
      expect(cliOfCommand(cli, commands), cli).toBe(cli);
      expect(cliOfCommand(`  ${cli} --resume  `, commands), cli).toBe(cli);
    }
  });

  it("accepts a path to the program", () => {
    expect(cliOfCommand("~/.local/bin/claude", commands)).toBe("claude");
    expect(cliOfCommand("C:\\tools\\codex.exe", commands)).toBe("codex");
  });

  it("ignores other commands and the names further in the line", () => {
    expect(cliOfCommand("claude-foo", commands)).toBeNull();
    expect(cliOfCommand("echo claude", commands)).toBeNull();
    expect(cliOfCommand("ls", commands)).toBeNull();
    expect(cliOfCommand("", commands)).toBeNull();
    expect(cliOfCommand("pip install x", commands)).toBeNull();
  });

  it("follows the edited list", () => {
    expect(cliOfCommand("aider", ["aider"])).toBe("aider");
    expect(cliOfCommand("claude", ["aider"])).toBeNull();
    expect(cliOfCommand("claude", [])).toBeNull();
  });
});

describe("cliOfTitle (S10 fallback)", () => {
  it("recognises a CLI's own terminal title", () => {
    expect(cliOfTitle("✳ Claude Code", commands)).toBe("claude");
    expect(cliOfTitle("⠂ Claude Code", commands)).toBe("claude");
    expect(cliOfTitle("Codex", commands)).toBe("codex");
    expect(cliOfTitle("OpenCode", commands)).toBe("opencode");
    expect(cliOfTitle("opencode - my-project", commands)).toBe("opencode");
  });

  it("ignores shell titles and lookalikes", () => {
    expect(cliOfTitle("jorge@host: ~/claude", commands)).toBeNull();
    expect(cliOfTitle("vim claude.md", commands)).toBeNull();
    expect(cliOfTitle("claudette", commands)).toBeNull();
    expect(cliOfTitle("", commands)).toBeNull();
  });
});

describe("the DEV commands setting", () => {
  it("keeps names, drops blanks, duplicates and invalid entries", () => {
    expect(cleanDevCommands(["claude", " codex ", "", "claude", "two words", 3])).toEqual(["claude", "codex"]);
    expect(cleanDevCommands(undefined)).toEqual([...DEFAULT_DEV_COMMANDS]);
    expect(cleanDevCommands([])).toEqual([]);
  });

  it("reads and writes the list as text", () => {
    expect(parseDevCommands("claude, codex  aider")).toEqual(["claude", "codex", "aider"]);
    expect(devCommandsText(["claude", "codex"])).toBe("claude, codex");
  });
});

const run = (state: DevState, command: string, pane = "pane-1", prompt = "me@box:~/proj$ ") =>
  devReducer(state, { type: "command", tab: "tab-1", pane, command, prompt, commands, id: 1 });

describe("devReducer (S10)", () => {
  it("turns a tab on when one of the CLIs runs, not for other commands", () => {
    expect(run({}, "ls")).toEqual({});
    const on = run({}, "claude");
    expect(on["tab-1"]).toMatchObject({ cli: "claude", manual: false, pane: "pane-1" });
  });

  it("turns it off when the shell marks its prompt in the pane that ran the CLI", () => {
    const on = run({}, "claude");
    expect(devReducer(on, { type: "promptMark", tab: "tab-1", pane: "pane-2" })).toBe(on);
    expect(devReducer(on, { type: "promptMark", tab: "tab-1", pane: "pane-1" })).toEqual({});
  });

  it("turns it off when output goes quiet on the same prompt the CLI was started from", () => {
    const on = run({}, "codex");
    // The CLI's own screen is not the shell's prompt.
    expect(devReducer(on, { type: "quiet", tab: "tab-1", pane: "pane-1", row: "│ > " })).toBe(on);
    expect(devReducer(on, { type: "quiet", tab: "tab-1", pane: "pane-1", row: "me@box:~/proj$ " })).toEqual({});
  });

  it("ignores an empty starting prompt for the quiet check", () => {
    const on = run({}, "codex", "pane-1", "  ");
    expect(devReducer(on, { type: "quiet", tab: "tab-1", pane: "pane-1", row: "" })).toBe(on);
  });

  it("ignores commands typed inside the running CLI", () => {
    const on = run({}, "claude");
    expect(run(on, "codex")).toBe(on);
  });

  it("turns on by title when nothing turned it on", () => {
    const on = devReducer({}, { type: "title", tab: "tab-1", pane: "pane-1", title: "✳ Claude Code", commands, id: 2 });
    expect(on["tab-1"]).toMatchObject({ cli: "claude", manual: false, prompt: null });
    expect(devReducer(on, { type: "quiet", tab: "tab-1", pane: "pane-1", row: "" })).toBe(on);
    expect(devReducer(on, { type: "promptMark", tab: "tab-1", pane: "pane-1" })).toEqual({});
  });

  it("learns the CLI from its title in a hand-made DEV mode, keeping it manual", () => {
    const on = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 });
    const codex = devReducer(on, { type: "title", tab: "tab-1", pane: "pane-1", title: "Codex", commands, id: 5 });
    expect(codex["tab-1"]).toMatchObject({ manual: true, cli: "codex", id: 3 });
    // A CLI already known is not replaced by a later title.
    const again = devReducer(codex, { type: "title", tab: "tab-1", pane: "pane-1", title: "✳ Claude Code", commands, id: 6 });
    expect(again).toBe(codex);
  });

  it("toggles by hand, and a hand-made DEV mode survives the prompt coming back", () => {
    const on = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 });
    expect(on["tab-1"]).toMatchObject({ manual: true, cli: null });
    const running = run(on, "claude");
    expect(running["tab-1"]).toMatchObject({ manual: true, cli: "claude" });
    const back = devReducer(running, { type: "promptMark", tab: "tab-1", pane: "pane-1" });
    expect(back["tab-1"]).toMatchObject({ manual: true, cli: null });
    expect(devReducer(back, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 4 })).toEqual({});
  });

  it("turns an automatic DEV mode off by hand", () => {
    expect(devReducer(run({}, "claude"), { type: "toggle", tab: "tab-1", pane: "pane-1", id: 4 })).toEqual({});
  });

  it("records the project folder of the DEV mode it was looked up for only", () => {
    const on = run({}, "claude");
    const anchored = devReducer(on, { type: "anchor", tab: "tab-1", id: 1, folder: "/p/src", root: "/p" });
    expect(anchored["tab-1"]).toMatchObject({ folder: "/p/src", root: "/p" });
    expect(devReducer(on, { type: "anchor", tab: "tab-1", id: 99, folder: "/x", root: "/x" })).toBe(on);
  });

  it("forgets closed tabs and automatic DEV modes whose pane closed", () => {
    const on = run({}, "claude");
    expect(devReducer(on, { type: "forget", panes: new Map([["tab-1", ["pane-1"]]]) })).toBe(on);
    expect(devReducer(on, { type: "forget", panes: new Map() })).toEqual({});
    expect(devReducer(on, { type: "forget", panes: new Map([["tab-1", ["pane-2"]]]) })).toEqual({});
    const manual = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 });
    expect(devReducer(manual, { type: "forget", panes: new Map([["tab-1", ["pane-2"]]]) })).toBe(manual);
  });
});
