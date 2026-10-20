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
    // pi titles the terminal with the Greek letter.
    expect(cliOfTitle("π - PlexusTerm", commands)).toBe("pi");
    expect(cliOfTitle("π", commands)).toBe("pi");
  });

  it("ignores shell titles and lookalikes", () => {
    expect(cliOfTitle("jorge@host: ~/claude", commands)).toBeNull();
    expect(cliOfTitle("vim claude.md", commands)).toBeNull();
    expect(cliOfTitle("claudette", commands)).toBeNull();
    expect(cliOfTitle("", commands)).toBeNull();
    expect(cliOfTitle("πr² notes", commands)).toBeNull();
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

  it("knows the default CLIs in a DEV mode already on, even when the list leaves them out", () => {
    const list = ["codex"];
    // Unlisted, Claude Code does not turn DEV mode on by itself.
    expect(devReducer({}, { type: "title", tab: "tab-1", pane: "pane-1", title: "✳ Claude Code", commands: list, id: 2 })).toEqual({});
    expect(devReducer({}, { type: "command", tab: "tab-1", pane: "pane-1", command: "claude", prompt: "$ ", commands: list, id: 2 })).toEqual({});
    const on = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 });
    const byTitle = devReducer(on, { type: "title", tab: "tab-1", pane: "pane-1", title: "✳ Claude Code", commands: list, id: 4 });
    expect(byTitle["tab-1"]).toMatchObject({ manual: true, cli: "claude" });
    const byCommand = devReducer(on, { type: "command", tab: "tab-1", pane: "pane-1", command: "claude", prompt: "$ ", commands: list, id: 4 });
    expect(byCommand["tab-1"]).toMatchObject({ manual: true, cli: "claude" });
    // Its summary titles keep it known.
    expect(devReducer(byTitle, { type: "title", tab: "tab-1", pane: "pane-1", title: "✳ Fix the build", commands: list, id: 5 })).toBe(byTitle);
  });

  it("ends the CLI when the title stops being a CLI's: off when automatic, back to no CLI when by hand", () => {
    const title = (state: DevState, text: string) =>
      devReducer(state, { type: "title", tab: "tab-1", pane: "pane-1", title: text, commands, id: 7 });
    // pi found by its title, then the shell's own title comes back.
    const pi = title({}, "π - daily-work");
    expect(pi["tab-1"]).toMatchObject({ cli: "pi", manual: false });
    expect(title(pi, "daily-work")).toEqual({});
    // Started from the command line; Claude Code's working titles keep it on.
    const claude = title(title(run({}, "claude"), "✳ Claude Code"), "✳ Fix the login bug");
    expect(claude["tab-1"]).toMatchObject({ cli: "claude" });
    expect(title(claude, "me@box: ~/proj")).toEqual({});
    // Shell titles that open with ASCII punctuation (zsh, Fedora's bash) end it too.
    expect(title(claude, "~/proj")).toEqual({});
    expect(title(claude, "[me@box proj]")).toEqual({});
    // A hand-made DEV mode stays on and forgets the CLI, so its icon goes back to the terminal.
    const manual = title(devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 }), "π - daily-work");
    expect(manual["tab-1"]).toMatchObject({ manual: true, cli: "pi" });
    expect(title(manual, "daily-work")["tab-1"]).toMatchObject({ manual: true, cli: null });
    // cmd.exe titles its window with the running command: still the CLI until the shell's title is back.
    const cmd = run({}, "claude", "pane-1", "C:\\Users\\me>");
    const running = title(cmd, "C:\\WINDOWS\\system32\\cmd.exe - claude");
    expect(running["tab-1"]).toMatchObject({ cli: "claude" });
    expect(title(running, "Administrador: C:\\WINDOWS\\system32\\cmd.exe - claude --resume")["tab-1"]).toMatchObject({ cli: "claude" });
    expect(title(running, "C:\\WINDOWS\\system32\\cmd.exe")).toEqual({});
    // A folder that only contains the name in a longer word is the shell's title.
    expect(title(claude, "me@box: ~/claude-project")).toEqual({});
    // Another pane's title does not end the CLI.
    expect(devReducer(pi, { type: "title", tab: "tab-1", pane: "pane-2", title: "bash", commands, id: 8 })).toBe(pi);
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

  it("keeps the panes a hand-made DEV mode hides, and none otherwise", () => {
    const on = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-2", id: 3, hidden: ["pane-1", "pane-3"] });
    expect(on["tab-1"]).toMatchObject({ pane: "pane-2", hidden: ["pane-1", "pane-3"] });
    expect(devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-1", id: 3 })["tab-1"].hidden).toEqual([]);
    expect(run({}, "claude")["tab-1"].hidden).toEqual([]);
  });

  it("shows another of its terminals, hiding the one shown", () => {
    const on = devReducer({}, { type: "toggle", tab: "tab-1", pane: "pane-2", id: 3, hidden: ["pane-1", "pane-3"] });
    const shown = devReducer(on, { type: "show", tab: "tab-1", pane: "pane-1", hidden: ["pane-2", "pane-3"] });
    expect(shown["tab-1"]).toMatchObject({ pane: "pane-1", hidden: ["pane-2", "pane-3"], manual: true });
    expect(devReducer({}, { type: "show", tab: "tab-1", pane: "pane-1", hidden: [] })).toEqual({});
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
