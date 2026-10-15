import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  hostKeyOf,
  MAX_HOSTS,
  MAX_PER_HOST,
  parseHistory,
  recentCommands,
  recordCommand,
  serializeHistory,
  suggest,
  type HistoryData,
} from "./history";

const DAY = 24 * 60 * 60 * 1000;

const withCommands = (host: string, commands: [string, number][], data: HistoryData = EMPTY_HISTORY) =>
  commands.reduce((d, [command, at]) => recordCommand(d, host, command, at), data);

describe("hostKeyOf", () => {
  it("names each kind of session", () => {
    expect(hostKeyOf({ type: "local" })).toBe("local");
    const ssh = { type: "ssh" as const, host: "10.0.0.1", port: 22, username: "u", auth: { method: "agent" as const } };
    expect(hostKeyOf(ssh)).toBe("u@10.0.0.1:22");
    expect(hostKeyOf({ type: "mosh", ssh })).toBe("u@10.0.0.1:22");
    expect(hostKeyOf({ type: "telnet", host: "switch.lan", port: 23 })).toBe("telnet:switch.lan:23");
    expect(
      hostKeyOf({ type: "serial", path: "/dev/ttyUSB0", baud: 9600, dataBits: 8, parity: "none", stopBits: 1, flow: "none" }),
    ).toBe("serial:/dev/ttyUSB0");
  });
});

describe("recordCommand", () => {
  it("records a command once per host, counting repeats and keeping the latest time", () => {
    const data = withCommands("local", [
      ["ls -la", 1],
      ["git status", 2],
      ["ls -la", 3],
    ]);
    expect(data.hosts.local).toEqual([
      { command: "git status", count: 1, last: 2 },
      { command: "ls -la", count: 2, last: 3 },
    ]);
  });

  it("ignores empty lines and trims trailing whitespace", () => {
    const data = withCommands("local", [
      ["   ", 1],
      ["", 2],
      ["make test  ", 3],
    ]);
    expect(data.hosts.local).toEqual([{ command: "make test", count: 1, last: 3 }]);
  });

  it("keeps at most MAX_PER_HOST commands per host, dropping the oldest", () => {
    let data = EMPTY_HISTORY;
    for (let i = 0; i <= MAX_PER_HOST; i++) data = recordCommand(data, "local", `cmd ${i}`, i + 1);
    expect(data.hosts.local).toHaveLength(MAX_PER_HOST);
    expect(data.hosts.local.some((e) => e.command === "cmd 0")).toBe(false);
  });

  it("keeps at most MAX_HOSTS hosts, dropping the one used longest ago", () => {
    let data = EMPTY_HISTORY;
    for (let i = 0; i <= MAX_HOSTS; i++) data = recordCommand(data, `host${i}`, "ls", i + 1);
    expect(Object.keys(data.hosts)).toHaveLength(MAX_HOSTS);
    expect(data.hosts.host0).toBeUndefined();
    expect(data.hosts[`host${MAX_HOSTS}`]).toBeDefined();
  });
});

describe("suggest", () => {
  it("completes a prefix with the most recent matching command of the host", () => {
    const data = withCommands("local", [
      ["git status", 1],
      ["git stash", 2],
    ]);
    expect(suggest(data, "local", "git st")).toBe("git stash");
  });

  it("prefers a command used much more often over a slightly more recent one", () => {
    const data = withCommands("local", [
      ["git status", 1],
      ["git status", 2],
      ["git status", 3],
      ["git status", 4],
      ["git stash", 5],
    ]);
    expect(suggest(data, "local", "git st")).toBe("git status");
    // ...but not over one used days later.
    expect(suggest(recordCommand(data, "local", "git stash", 5 * DAY), "local", "git st")).toBe("git stash");
  });

  it("uses the host's own commands first, then every host's", () => {
    const data = withCommands("other", [["docker compose up -d", 10]], withCommands("local", [["docker ps", 1]]));
    expect(suggest(data, "local", "docker")).toBe("docker ps");
    expect(suggest(data, "local", "docker c")).toBe("docker compose up -d");
    expect(suggest(data, "fresh", "docker")).toBe("docker compose up -d");
  });

  it("suggests nothing for an empty prefix, an exact match or no match", () => {
    const data = withCommands("local", [["ls", 1]]);
    expect(suggest(data, "local", "")).toBeNull();
    expect(suggest(data, "local", "ls")).toBeNull();
    expect(suggest(data, "local", "cd")).toBeNull();
  });
});

describe("recentCommands", () => {
  it("lists the host's last commands, oldest first", () => {
    const data = withCommands("local", [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(recentCommands(data, "local", 2)).toEqual(["b", "c"]);
    expect(recentCommands(data, "local", 0)).toEqual([]);
    expect(recentCommands(data, "nowhere", 5)).toEqual([]);
  });
});

describe("parseHistory / serializeHistory", () => {
  it("round-trips with a version", () => {
    const data = withCommands("local", [["ls", 1]]);
    const json = serializeHistory(data);
    expect(JSON.parse(json)).toEqual({ version: 1, hosts: { local: [{ command: "ls", count: 1, last: 1 }] } });
    expect(parseHistory(json)).toEqual(data);
  });

  it("gives an empty history for missing or invalid files and drops invalid entries", () => {
    expect(parseHistory(null)).toEqual(EMPTY_HISTORY);
    expect(parseHistory("{nope")).toEqual(EMPTY_HISTORY);
    expect(parseHistory(true)).toEqual(EMPTY_HISTORY);
    const json = JSON.stringify({
      version: 1,
      hosts: { local: [{ command: "ls", count: 2, last: 5 }, { command: 7 }, { command: "x", count: -1, last: 1 }], bad: 3 },
    });
    expect(parseHistory(json)).toEqual({ hosts: { local: [{ command: "ls", count: 2, last: 5 }] } });
  });
});
