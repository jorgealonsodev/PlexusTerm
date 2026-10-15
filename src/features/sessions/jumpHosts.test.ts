import { describe, expect, it, vi } from "vitest";
import {
  emptyLibrary,
  jumpUsers,
  libraryReducer,
  parseLibrary,
  resolveChain,
  serializeLibrary,
  type LibrarySession,
  type SavedSession,
  type SessionLibrary,
} from "./library";
import { chainTarget, collectLogins, hopLabel, type HopLogin } from "./jumpHosts";

const ssh = (id: string, overrides: Partial<SavedSession> = {}): SavedSession => ({
  kind: "ssh",
  id,
  name: id,
  folder: "",
  host: `${id}.example.com`,
  port: 22,
  username: "u",
  auth: { method: "agent" },
  ...overrides,
});

const lib = (...sessions: LibrarySession[]): SessionLibrary => ({ version: 1, folders: [], sessions });

describe("saved jump hosts", () => {
  it("parse, serialize and survive a save", () => {
    const target = ssh("t", { jumpIds: ["a", "b"] });
    const parsed = parseLibrary(serializeLibrary(lib(ssh("a"), ssh("b"), target)));
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.library.sessions[2]).toEqual(target);
    const saved = libraryReducer(emptyLibrary, { type: "saveSession", session: target });
    expect(saved.sessions[0]).toEqual(target);
  });

  it("are left out when empty, so older files load and save unchanged", () => {
    const old = JSON.stringify({
      version: 1,
      folders: [],
      sessions: [{ id: "s", name: "s", folder: "", host: "h", port: 22, username: "u", auth: { method: "agent" } }],
    });
    const parsed = parseLibrary(old);
    expect(parsed.ok && parsed.library.sessions[0]).not.toHaveProperty("jumpIds");
    const saved = libraryReducer(emptyLibrary, { type: "saveSession", session: ssh("x", { jumpIds: [] }) });
    expect(saved.sessions[0]).not.toHaveProperty("jumpIds");
  });

  it("reject a file whose jump hosts are not a list of ids", () => {
    for (const jumpIds of ["a", [1], [null], {}]) {
      const json = JSON.stringify({ version: 1, folders: [], sessions: [{ ...ssh("t"), jumpIds }] });
      expect(parseLibrary(json)).toEqual({ ok: false, error: "sessions file has invalid sessions" });
    }
  });
});

describe("resolveChain", () => {
  it("returns the jump sessions in order", () => {
    const t = ssh("t", { jumpIds: ["b", "a"] });
    const result = resolveChain(lib(ssh("a"), ssh("b"), t), t);
    expect(result).toEqual({ ok: true, jumps: [ssh("b"), ssh("a")] });
  });

  it("is empty for sessions without jump hosts", () => {
    expect(resolveChain(lib(ssh("t")), ssh("t"))).toEqual({ ok: true, jumps: [] });
  });

  it("goes through the jump hosts of a jump host first", () => {
    const inner = ssh("inner", { jumpIds: ["outer"] });
    const t = ssh("t", { jumpIds: ["inner"] });
    expect(resolveChain(lib(ssh("outer"), inner, t), t)).toEqual({ ok: true, jumps: [ssh("outer"), inner] });
  });

  it("rejects a session that is its own jump host", () => {
    const t = ssh("t", { name: "web", jumpIds: ["t"] });
    expect(resolveChain(lib(t), t)).toEqual({ ok: false, error: '"web" cannot be its own jump host.' });
  });

  it("rejects cycles", () => {
    const a = ssh("a", { jumpIds: ["b"] });
    const b = ssh("b", { jumpIds: ["a"] });
    const t = ssh("t", { name: "web", jumpIds: ["a"] });
    expect(resolveChain(lib(a, b, t), t)).toEqual({ ok: false, error: 'The jump hosts of "web" form a cycle.' });
    const back = ssh("a", { jumpIds: ["t"] });
    expect(resolveChain(lib(back, t), t)).toEqual({ ok: false, error: 'The jump hosts of "web" form a cycle.' });
  });

  it("rejects a session used twice in the same chain", () => {
    const b = ssh("b", { jumpIds: ["a"] });
    const t = ssh("t", { name: "web", jumpIds: ["a", "b"] });
    expect(resolveChain(lib(ssh("a", { name: "bastion" }), b, t), t)).toEqual({
      ok: false,
      error: '"bastion" appears more than once in the jump hosts of "web".',
    });
  });

  it("rejects deleted and non-SSH jump sessions", () => {
    const t = ssh("t", { name: "web", jumpIds: ["gone"] });
    expect(resolveChain(lib(t), t)).toEqual({
      ok: false,
      error: 'A jump host of "web" no longer exists; edit the session to choose another one.',
    });
    const console: LibrarySession = {
      kind: "serial",
      id: "c",
      name: "console",
      folder: "",
      path: "/dev/ttyUSB0",
      baud: 9600,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      flow: "none",
    };
    const u = ssh("u", { name: "web", jumpIds: ["c"] });
    expect(resolveChain(lib(console, u), u)).toEqual({
      ok: false,
      error: 'Jump host "console" of "web" is not an SSH session.',
    });
  });

  it("rejects more than 3 jump hosts in total", () => {
    const d = ssh("d", { jumpIds: ["a", "b"] });
    const t = ssh("t", { name: "web", jumpIds: ["c", "d"] });
    expect(resolveChain(lib(ssh("a"), ssh("b"), ssh("c"), d, t), t)).toEqual({
      ok: false,
      error: '"web" goes through more than 3 jump hosts.',
    });
  });
});

describe("deleting a jump host", () => {
  const library = lib(ssh("a"), ssh("b", { folder: "Gw" }), ssh("t", { jumpIds: ["a", "b"] }), ssh("u", { jumpIds: ["b"] }));

  it("lists the sessions that use it", () => {
    expect(jumpUsers(library, ["b"]).map((s) => s.id)).toEqual(["t", "u"]);
    expect(jumpUsers(library, ["t"])).toEqual([]);
    // Sessions deleted together are not reported as users.
    expect(jumpUsers(library, ["b", "u"]).map((s) => s.id)).toEqual(["t"]);
  });

  it("removes it from every chain", () => {
    const next = libraryReducer(library, { type: "deleteSession", id: "a" });
    expect(next.sessions.map((s) => s.id)).toEqual(["b", "t", "u"]);
    expect(next.sessions.find((s) => s.id === "t")).toEqual(ssh("t", { jumpIds: ["b"] }));
  });

  it("removes the jump hosts of a deleted folder from every chain", () => {
    const next = libraryReducer(library, { type: "deleteFolder", path: "Gw" });
    expect(next.sessions.find((s) => s.id === "t")).toEqual(ssh("t", { jumpIds: ["a"] }));
    expect(next.sessions.find((s) => s.id === "u")).not.toHaveProperty("jumpIds");
  });
});

describe("hopLabel", () => {
  const hops = [ssh("bastion"), ssh("inner"), ssh("web", { username: "deploy", host: "10.0.0.1" })];

  it("names jump hosts by position", () => {
    expect(hopLabel(hops, 0)).toBe("bastion — jump host 1 of 2");
    expect(hopLabel(hops, 1)).toBe("inner — jump host 2 of 2");
  });

  it("names the target as user@host", () => {
    expect(hopLabel(hops, 2)).toBe("deploy@10.0.0.1");
    expect(hopLabel([hops[2]], 0)).toBe("deploy@10.0.0.1");
  });
});

describe("collectLogins", () => {
  const bastion = ssh("bastion", { auth: { method: "password" } });
  const saved = ssh("saved", { auth: { method: "password" } });
  const keyed = ssh("keyed", { auth: { method: "key", path: "~/.ssh/id" } });

  it("uses stored passwords, asks for the others one by one and keeps key/agent auth", async () => {
    const asked: number[] = [];
    const logins = await collectLogins([bastion, saved, keyed], {
      secretExists: async (id) => id === "saved",
      askPassword: async (index) => {
        asked.push(index);
        return { password: "pw", remember: true };
      },
    });
    expect(asked).toEqual([0]);
    expect(logins).toEqual<HopLogin[]>([
      {
        auth: { method: "password", password: "pw" },
        storage: { action: "remember", sessionId: "bastion", label: "PlexusTerm: u@bastion.example.com:22" },
      },
      { auth: { method: "storedPassword", sessionId: "saved" } },
      { auth: { method: "key", path: "~/.ssh/id" } },
    ]);
  });

  it("stops at the first cancelled prompt", async () => {
    const askPassword = vi.fn(async () => null);
    const logins = await collectLogins([bastion, ssh("t", { auth: { method: "password" } })], {
      secretExists: async () => false,
      askPassword,
    });
    expect(logins).toBeNull();
    expect(askPassword).toHaveBeenCalledTimes(1);
  });
});

describe("chainTarget", () => {
  it("puts the jump hosts, with their own logins, in front of the target", () => {
    const hops = [ssh("bastion", { port: 2222 }), ssh("web", { auth: { method: "password" } })];
    const logins: HopLogin[] = [
      { auth: { method: "storedPassword", sessionId: "bastion" } },
      { auth: { method: "password", password: "pw" }, storage: { action: "forget", sessionId: "web" } },
    ];
    expect(chainTarget(hops, logins)).toEqual({
      type: "ssh",
      host: "web.example.com",
      port: 22,
      username: "u",
      auth: { method: "password", password: "pw" },
      storage: { action: "forget", sessionId: "web" },
      jumps: [
        {
          name: "bastion",
          host: "bastion.example.com",
          port: 2222,
          username: "u",
          auth: { method: "storedPassword", sessionId: "bastion" },
        },
      ],
    });
  });

  it("adds no jumps for a single hop", () => {
    expect(chainTarget([ssh("web")], [{ auth: { method: "agent" } }])).not.toHaveProperty("jumps");
  });
});
