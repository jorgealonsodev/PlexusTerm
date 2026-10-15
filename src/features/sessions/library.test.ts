import { describe, expect, it } from "vitest";
import {
  buildTree,
  emptyLibrary,
  libraryReducer,
  normalizeFolder,
  parseLibrary,
  serializeLibrary,
  toTarget,
  isSshSession,
  resolveChain,
  type SavedMoshSession,
  type SavedSerialSession,
  type SavedSession,
  type SavedTelnetSession,
  type SessionLibrary,
} from "./library";

const session = (overrides: Partial<SavedSession> = {}): SavedSession => ({
  id: "s1",
  name: "web",
  folder: "",
  host: "web.example.com",
  port: 22,
  username: "deploy",
  auth: { method: "agent" },
  ...overrides,
});

const serial = (overrides: Partial<SavedSerialSession> = {}): SavedSerialSession => ({
  kind: "serial",
  id: "c1",
  name: "switch console",
  folder: "Lab",
  path: "/dev/ttyUSB0",
  baud: 9600,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  flow: "none",
  ...overrides,
});

const telnet = (overrides: Partial<SavedTelnetSession> = {}): SavedTelnetSession => ({
  kind: "telnet",
  id: "t1",
  name: "old switch",
  folder: "Lab",
  host: "switch.lan",
  port: 23,
  ...overrides,
});

const mosh = (overrides: Partial<SavedMoshSession> = {}): SavedMoshSession => ({
  kind: "mosh",
  id: "m1",
  name: "web (mosh)",
  folder: "",
  sshSessionId: "s1",
  ...overrides,
});

const save = (lib: SessionLibrary, s: SavedSession | SavedSerialSession | SavedTelnetSession | SavedMoshSession) =>
  libraryReducer(lib, { type: "saveSession", session: s });

describe("normalizeFolder", () => {
  it("trims segments and drops empty ones", () => {
    expect(normalizeFolder(" Prod / / DB/ ")).toBe("Prod/DB");
    expect(normalizeFolder("   ")).toBe("");
  });
});

describe("libraryReducer", () => {
  it("adds a session and registers its folder and ancestors", () => {
    const lib = save(emptyLibrary, session({ folder: "Prod/DB" }));
    expect(lib.sessions).toHaveLength(1);
    expect(lib.folders).toEqual(["Prod", "Prod/DB"]);
  });

  it("updates an existing session in place by id", () => {
    let lib = save(emptyLibrary, session());
    lib = save(lib, session({ name: "web-1" }));
    expect(lib.sessions.map((s) => s.name)).toEqual(["web-1"]);
  });

  it("saves several sessions in one action, like saving them one by one", () => {
    const batch = [session({ id: "1", folder: "M/A" }), session({ id: "2", folder: "M" })];
    const lib = libraryReducer(save(emptyLibrary, session({ id: "0" })), { type: "saveSessions", sessions: batch });
    expect(lib).toEqual(batch.reduce(save, save(emptyLibrary, session({ id: "0" }))));
    expect(lib.folders).toEqual(["M", "M/A"]);
  });

  it("deletes a session", () => {
    const lib = libraryReducer(save(emptyLibrary, session()), { type: "deleteSession", id: "s1" });
    expect(lib.sessions).toEqual([]);
  });

  it("adds folders without duplicates", () => {
    let lib = libraryReducer(emptyLibrary, { type: "addFolder", path: "A/B" });
    lib = libraryReducer(lib, { type: "addFolder", path: " A " });
    expect(lib.folders).toEqual(["A", "A/B"]);
  });

  it("deleting a folder removes its subfolders and sessions only", () => {
    let lib = save(emptyLibrary, session({ id: "1", folder: "A/B" }));
    lib = save(lib, session({ id: "2", folder: "AB" }));
    lib = save(lib, session({ id: "3", folder: "A" }));
    lib = libraryReducer(lib, { type: "deleteFolder", path: "A" });
    expect(lib.folders).toEqual(["AB"]);
    expect(lib.sessions.map((s) => s.id)).toEqual(["2"]);
  });
});

describe("parseLibrary / serializeLibrary", () => {
  it("treats a missing file as an empty library", () => {
    expect(parseLibrary(null)).toEqual({ ok: true, library: emptyLibrary });
  });

  it("round-trips through JSON", () => {
    const lib = save(emptyLibrary, session({ folder: "X", auth: { method: "key", path: "~/.ssh/id" } }));
    expect(parseLibrary(serializeLibrary(lib))).toEqual({ ok: true, library: lib });
  });

  it("reports corrupt or unsupported files instead of returning an empty library", () => {
    expect(parseLibrary("{oops")).toMatchObject({ ok: false });
    expect(parseLibrary('{"version":2,"folders":[],"sessions":[]}')).toMatchObject({ ok: false });
    expect(parseLibrary('{"version":1,"folders":[],"sessions":[{"id":"x"}]}')).toMatchObject({ ok: false });
  });

  it("loads files written before serial sessions existed (no kind) as SSH sessions", () => {
    const legacy = JSON.stringify({
      version: 1,
      folders: ["Prod"],
      sessions: [
        {
          id: "old",
          name: "web",
          folder: "Prod",
          host: "web.example.com",
          port: 22,
          username: "deploy",
          auth: { method: "key", path: "~/.ssh/id" },
        },
      ],
    });
    const result = parseLibrary(legacy);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.library.sessions).toEqual([
      {
        kind: "ssh",
        id: "old",
        name: "web",
        folder: "Prod",
        host: "web.example.com",
        port: 22,
        username: "deploy",
        auth: { method: "key", path: "~/.ssh/id" },
      },
    ]);
    expect(JSON.parse(serializeLibrary(result.library)).sessions[0].kind).toBe("ssh");
  });

  it("round-trips serial sessions and writes their kind", () => {
    const lib = save(save(emptyLibrary, session()), serial({ parity: "even", stopBits: 2, flow: "software" }));
    const json = serializeLibrary(lib);
    expect(JSON.parse(json).sessions.map((s: { kind: string }) => s.kind)).toEqual(["ssh", "serial"]);
    expect(parseLibrary(json)).toEqual({ ok: true, library: lib });
  });

  it("rejects serial sessions with invalid fields", () => {
    const file = (bad: Record<string, unknown>) =>
      JSON.stringify({ version: 1, folders: [], sessions: [{ ...serial(), ...bad }] });
    for (const bad of [
      { path: 5 },
      { baud: 0 },
      { baud: 9600.5 },
      { dataBits: 9 },
      { parity: "mark" },
      { stopBits: 3 },
      { flow: "rts" },
      { kind: "telnet" },
    ]) {
      expect(parseLibrary(file(bad)), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("round-trips Telnet and Mosh sessions and writes their kind", () => {
    const lib = [session(), telnet({ port: 2323 }), mosh({ serverCommand: "mosh-server new -p 60010" }), mosh({ id: "m2" })].reduce(
      save,
      emptyLibrary,
    );
    const json = serializeLibrary(lib);
    expect(JSON.parse(json).sessions.map((s: { kind: string }) => s.kind)).toEqual(["ssh", "telnet", "mosh", "mosh"]);
    expect(JSON.parse(json).sessions[3]).toEqual({ kind: "mosh", id: "m2", name: "web (mosh)", folder: "", sshSessionId: "s1" });
    expect(parseLibrary(json)).toEqual({ ok: true, library: lib });
  });

  it("drops an empty Mosh server command and stray fields", () => {
    const withStray = { ...mosh({ serverCommand: "  " }), password: "hunter2" } as unknown as SavedMoshSession;
    const json = serializeLibrary(save(emptyLibrary, withStray));
    expect(json).not.toContain("hunter2");
    expect(JSON.parse(json).sessions[0]).not.toHaveProperty("serverCommand");
  });

  it("rejects Telnet and Mosh sessions with invalid fields", () => {
    const file = (s: object) => JSON.stringify({ version: 1, folders: [], sessions: [s] });
    for (const bad of [
      telnet({ host: 5 as unknown as string }),
      telnet({ port: 0 }),
      telnet({ port: 70000 }),
      telnet({ port: 23.5 }),
      mosh({ sshSessionId: 1 as unknown as string }),
      mosh({ serverCommand: 3 as unknown as string }),
    ]) {
      expect(parseLibrary(file(bad)), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("treats only SSH sessions as SSH (Telnet and Mosh are not jump hosts)", () => {
    expect([session(), serial(), telnet(), mosh()].map(isSshSession)).toEqual([true, false, false, false]);
    const lib = [telnet({ id: "t1" }), session({ id: "s2", jumpIds: ["t1"] })].reduce(save, emptyLibrary);
    expect(resolveChain(lib, session({ id: "s2", jumpIds: ["t1"] }))).toEqual({
      ok: false,
      error: 'Jump host "old switch" of "web" is not an SSH session.',
    });
  });

  it("never serializes passwords", () => {
    const withSecret = { ...session(), auth: { method: "password", password: "hunter2" } } as unknown as SavedSession;
    const json = serializeLibrary(save(emptyLibrary, withSecret));
    expect(json).not.toContain("hunter2");
    expect(JSON.parse(json).sessions[0].auth).toEqual({ method: "password" });
  });
});

describe("buildTree", () => {
  const lib = [
    session({ id: "1", name: "zeta", folder: "" }),
    session({ id: "2", name: "alpha", folder: "" }),
    session({ id: "3", name: "db", folder: "Prod", host: "10.0.0.9" }),
    session({ id: "4", name: "cache", folder: "Prod/Infra" }),
    serial({ id: "5", name: "router", folder: "Prod", path: "/dev/ttyACM3" }),
  ].reduce(save, libraryReducer(emptyLibrary, { type: "addFolder", path: "Empty" }));

  it("nests folders first, then sessions, each sorted by name", () => {
    const tree = buildTree(lib, "");
    expect(tree.map((n) => n.name)).toEqual(["Empty", "Prod", "alpha", "zeta"]);
    const prod = tree[1];
    expect(prod.kind === "folder" && prod.children.map((n) => n.name)).toEqual(["Infra", "db", "router"]);
  });

  it("filters by name or host and keeps only folders with matches", () => {
    expect(buildTree(lib, "10.0.0").map((n) => n.name)).toEqual(["Prod"]);
    const prod = buildTree(lib, "CACHE")[0];
    expect(prod.kind === "folder" && prod.children.map((n) => n.name)).toEqual(["Infra"]);
  });

  it("matches serial sessions by device path", () => {
    const prod = buildTree(lib, "ttyacm3")[0];
    expect(prod.kind === "folder" && prod.children.map((n) => n.name)).toEqual(["router"]);
  });
});

describe("toTarget", () => {
  it("adds the password typed at connect time only for password sessions", () => {
    expect(toTarget(session({ auth: { method: "password" } }), "pw").auth).toEqual({
      method: "password",
      password: "pw",
    });
    expect(toTarget(session({ auth: { method: "key", path: "/k" } })).auth).toEqual({ method: "key", path: "/k" });
    expect(toTarget(session())).toEqual({
      type: "ssh",
      host: "web.example.com",
      port: 22,
      username: "deploy",
      auth: { method: "agent" },
    });
  });

  it("turns a Telnet session into a Telnet target", () => {
    expect(toTarget(telnet({ port: 2323 }))).toEqual({ type: "telnet", host: "switch.lan", port: 2323 });
  });

  it("turns a serial session into a serial target", () => {
    expect(toTarget(serial({ flow: "hardware" }))).toEqual({
      type: "serial",
      path: "/dev/ttyUSB0",
      baud: 9600,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flow: "hardware",
    });
  });
});
