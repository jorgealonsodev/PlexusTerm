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

  it("counts ProxyJump hops that are not imported hosts, and imports the host without them", () => {
    const parsed = parseSshConfig("Host inner\n  ProxyJump admin@gw.example.com:2222");
    expect(parsed.sessions[0].kind === "ssh" && parsed.sessions[0].jumps).toBeUndefined();
    expect(parsed.skipped).toEqual({ jump: 1 });
  });

  it("ignores ProxyJump none", () => {
    const parsed = parseSshConfig("Host h\n  ProxyJump none");
    expect(parsed.skipped).toEqual({});
  });

  it("counts Include and Match lines and ProxyCommand hosts, which are not followed", () => {
    const parsed = parseSshConfig(
      ["Include ~/.orbstack/ssh/config", "Host h", "  ProxyCommand nc -X 5 %h %p", "Match host x", "  User nobody"].join("\n"),
    );
    expect(parsed.sessions.map((s) => s.name)).toEqual(["h"]);
    expect(parsed.skipped).toEqual({ include: 1, match: 1, proxyCommand: 1 });
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
