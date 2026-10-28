import { describe, expect, it } from "vitest";
import { emptyLibrary, type SavedSession, type SessionLibrary } from "./library";
import { planImport } from "./iniImport";
import { parseSshConfig, SSH_CONFIG_FOLDER } from "./sshConfigImport";

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe("parseSshConfig", () => {
  it("reads each concrete Host with its HostName, User, Port and IdentityFile", () => {
    const parsed = parseSshConfig(
      [
        "# my servers",
        "Host web",
        "  HostName 10.0.0.5",
        "  User deploy",
        "  Port 2222",
        "  IdentityFile ~/.ssh/id_web",
        "",
        "Host db",
        "  HostName=db.internal",
      ].join("\n"),
    );
    expect(parsed.sessions).toEqual([
      {
        kind: "ssh",
        name: "web",
        folder: SSH_CONFIG_FOLDER,
        host: "10.0.0.5",
        port: 2222,
        username: "deploy",
        auth: { method: "key", path: "~/.ssh/id_web" },
      },
      { kind: "ssh", name: "db", folder: SSH_CONFIG_FOLDER, host: "db.internal", port: 22, username: "" },
    ]);
    expect(parsed.skipped).toEqual({});
  });

  it("uses the alias as the host when there is no HostName, and expands %h", () => {
    const parsed = parseSshConfig("Host box\nHost *.lan\n  HostName %h.example.org\nHost nas.lan");
    expect(parsed.sessions.map((s) => [s.name, s.host])).toEqual([
      ["box", "box"],
      ["nas.lan", "nas.lan.example.org"],
    ]);
  });

  it("applies wildcard blocks and global options, keeping the first value of each option like ssh", () => {
    const parsed = parseSshConfig(
      ["User everyone", "Host app", "  Port 2200", "Host *", "  User fallback", "  Port 22", "  IdentityFile ~/.ssh/default"].join(
        "\n",
      ),
    );
    expect(parsed.sessions).toMatchObject([
      { name: "app", username: "everyone", port: 2200, auth: { method: "key", path: "~/.ssh/default" } },
    ]);
  });

  it("imports every alias of a multi-pattern Host but skips wildcard and negated patterns", () => {
    const parsed = parseSshConfig("Host a b !c d?\n  HostName shared.example\nHost * !b\n  User u");
    expect(parsed.sessions.map((s) => [s.name, s.kind === "ssh" ? s.username : ""])).toEqual([
      ["a", "u"],
      ["b", ""],
    ]);
  });

  it("keeps a quoted value with spaces and is case-insensitive about keywords", () => {
    const parsed = parseSshConfig('HOST win\n  hostname 10.1.1.1\n  identityfile "C:/Users/Me/My Keys/id"');
    expect(parsed.sessions[0]).toMatchObject({ host: "10.1.1.1", auth: { method: "key", path: "C:/Users/Me/My Keys/id" } });
  });

  it("replaces %d in IdentityFile with the home folder", () => {
    const parsed = parseSshConfig("Host h\n  IdentityFile %d/.ssh/id_h");
    expect(parsed.sessions[0]).toMatchObject({ auth: { method: "key", path: "~/.ssh/id_h" } });
  });

  it("falls back to port 22 for an invalid Port", () => {
    expect(parseSshConfig("Host h\n  Port 99999").sessions[0].port).toBe(22);
  });

  it("links ProxyJump hops to the imported hosts with those names", () => {
    const parsed = parseSshConfig("Host bastion\n  HostName 1.2.3.4\nHost inner\n  ProxyJump bastion");
    expect(parsed.sessions[1]).toMatchObject({ name: "inner", jumps: ["bastion"] });
    expect(parsed.skipped).toEqual({});
  });

  it("imports a ProxyJump hop with a user and a port as a jump host session with that port", () => {
    const parsed = parseSshConfig("Host inner\n  ProxyJump admin@gw.example.com:2222");
    expect(parsed.sessions).toEqual([
      {
        kind: "ssh",
        name: "inner",
        folder: SSH_CONFIG_FOLDER,
        host: "inner",
        port: 22,
        username: "",
        jumps: ["admin@gw.example.com:2222"],
      },
      {
        kind: "ssh",
        name: "admin@gw.example.com:2222",
        folder: SSH_CONFIG_FOLDER,
        host: "gw.example.com",
        port: 2222,
        username: "admin",
      },
    ]);
    expect(parsed.skipped).toEqual({});
  });

  it("reads host:port, user@host, [IPv6]:port and ssh:// hops, sharing one session per hop", () => {
    const parsed = parseSshConfig(
      ["Host a", "  ProxyJump gw:2200,ops@10.0.0.1", "Host b", "  ProxyJump ssh://[fd00::1]:2022,gw:2200"].join("\n"),
    );
    expect(parsed.sessions.map((s) => [s.name, s.host, s.port, s.kind === "ssh" ? s.username : ""])).toEqual([
      ["a", "a", 22, ""],
      ["b", "b", 22, ""],
      ["gw:2200", "gw", 2200, ""],
      ["ops@10.0.0.1", "10.0.0.1", 22, "ops"],
      ["ssh://[fd00::1]:2022", "fd00::1", 2022, ""],
    ]);
    expect(parsed.sessions[0]).toMatchObject({ jumps: ["gw:2200", "ops@10.0.0.1"] });
    expect(parsed.sessions[1]).toMatchObject({ jumps: ["ssh://[fd00::1]:2022", "gw:2200"] });
  });

  it("gives a hop through a host of the file that host's settings, with the user and port of the hop", () => {
    const parsed = parseSshConfig(
      ["Host gw", "  HostName 1.2.3.4", "  User me", "  IdentityFile ~/.ssh/gw", "Host app", "  ProxyJump root@gw:2222", "Host db", "  ProxyJump me@gw:22"].join(
        "\n",
      ),
    );
    // Same user and port as the host itself: the host is the jump.
    expect(parsed.sessions.find((s) => s.name === "db")).toMatchObject({ jumps: ["gw"] });
    expect(parsed.sessions.find((s) => s.name === "app")).toMatchObject({ jumps: ["root@gw:2222"] });
    expect(parsed.sessions.find((s) => s.name === "root@gw:2222")).toMatchObject({
      host: "1.2.3.4",
      port: 2222,
      username: "root",
      auth: { method: "key", path: "~/.ssh/gw" },
    });
  });

  it("counts a ProxyJump with more than 3 hops or a hop it cannot read, and imports the host without it", () => {
    const parsed = parseSshConfig("Host a\n  ProxyJump h1,h2,h3,h4\nHost b\n  ProxyJump gw:99999");
    expect(parsed.sessions.map((s) => s.name)).toEqual(["a", "b"]);
    expect(parsed.skipped).toEqual({ jump: 2 });
  });

  it("ignores ProxyJump none", () => {
    const parsed = parseSshConfig("Host h\n  ProxyJump none");
    expect(parsed.skipped).toEqual({});
  });

  it("counts Include and Match lines, which are not followed", () => {
    const parsed = parseSshConfig(
      ["Include ~/.orbstack/ssh/config", "Host h", "Match host x", "  User nobody"].join("\n"),
    );
    expect(parsed.sessions.map((s) => s.name)).toEqual(["h"]);
    expect(parsed.skipped).toEqual({ include: 1, match: 1 });
  });

  it("imports the whole ProxyCommand line as the session's proxy command", () => {
    const parsed = parseSshConfig(
      ['Host h', '  ProxyCommand cloudflared access ssh --hostname "%h" --id x', "Host *", "  ProxyCommand ignored %h"].join("\n"),
    );
    expect(parsed.sessions[0]).toMatchObject({ proxyCommand: 'cloudflared access ssh --hostname "%h" --id x' });
    expect(parsed.skipped).toEqual({});
  });

  it("imports no proxy command for ProxyCommand none, which also overrides later blocks", () => {
    const parsed = parseSshConfig("Host h\n  ProxyCommand none\nHost *\n  ProxyCommand nc %h %p");
    expect(parsed.sessions[0]).not.toHaveProperty("proxyCommand");
    expect(parsed.skipped).toEqual({});
  });

  it("uses whichever of ProxyJump and ProxyCommand comes first, like ssh", () => {
    const first = parseSshConfig("Host j\nHost h\n  ProxyJump j\n  ProxyCommand nc %h %p");
    expect(first.sessions[1]).toMatchObject({ jumps: ["j"] });
    expect(first.sessions[1]).not.toHaveProperty("proxyCommand");
    const second = parseSshConfig("Host j\nHost h\n  ProxyCommand nc %h %p\nHost *\n  ProxyJump j");
    expect(second.sessions[1]).toMatchObject({ proxyCommand: "nc %h %p" });
    expect(second.sessions[1]).not.toHaveProperty("jumps");
  });

  it("counts a ProxyCommand longer than 2000 characters and imports the host without it", () => {
    const parsed = parseSshConfig(`Host h\n  ProxyCommand ${"x".repeat(2001)}`);
    expect(parsed.sessions[0]).not.toHaveProperty("proxyCommand");
    expect(parsed.skipped).toEqual({ proxyCommand: 1 });
  });

  it("returns nothing for an empty file", () => {
    expect(parseSshConfig("")).toEqual({ sessions: [], skipped: {} });
  });
});

describe("planImport with an ssh config", () => {
  it("keeps the key auth and turns ProxyJump names into the ids of the saved sessions", () => {
    const parsed = parseSshConfig("Host bastion\n  IdentityFile ~/.ssh/b\nHost inner\n  ProxyJump bastion");
    const plan = planImport(emptyLibrary, parsed, ids());
    expect(plan.toAdd).toEqual([
      {
        kind: "ssh",
        id: "id1",
        name: "bastion",
        folder: SSH_CONFIG_FOLDER,
        host: "bastion",
        port: 22,
        username: "",
        auth: { method: "key", path: "~/.ssh/b" },
      },
      {
        kind: "ssh",
        id: "id2",
        name: "inner",
        folder: SSH_CONFIG_FOLDER,
        host: "inner",
        port: 22,
        username: "",
        auth: { method: "password" },
        jumpIds: ["id1"],
      },
    ]);
  });

  it("links a jump to the session saved by an earlier import when that host is a duplicate", () => {
    const saved: SavedSession = {
      kind: "ssh",
      id: "old",
      name: "bastion",
      folder: SSH_CONFIG_FOLDER,
      host: "bastion",
      port: 22,
      username: "",
      auth: { method: "password" },
    };
    const library: SessionLibrary = { ...emptyLibrary, sessions: [saved] };
    const plan = planImport(library, parseSshConfig("Host bastion\nHost inner\n  ProxyJump bastion"), ids());
    expect(plan.duplicates).toBe(1);
    expect(plan.toAdd).toMatchObject([{ name: "inner", jumpIds: ["old"] }]);
  });
});

describe("planImport of proxy commands and jump hosts with a port", () => {
  it("keeps the proxy command and links the new jump host session", () => {
    const parsed = parseSshConfig("Host p\n  ProxyCommand nc %h %p\nHost inner\n  ProxyJump admin@gw:2222");
    const plan = planImport(emptyLibrary, parsed, ids());
    expect(plan.toAdd.map((s) => s.name)).toEqual(["p", "inner", "admin@gw:2222"]);
    expect(plan.toAdd[0]).toMatchObject({ proxyCommand: "nc %h %p" });
    expect(plan.toAdd[1]).toMatchObject({ jumpIds: ["id3"] });
    expect(plan.toAdd[2]).toMatchObject({ id: "id3", host: "gw", port: 2222, username: "admin" });
  });
});
