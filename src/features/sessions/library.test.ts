import { describe, expect, it } from "vitest";
import {
  buildTree,
  emptyLibrary,
  libraryReducer,
  normalizeFolder,
  parseLibrary,
  serializeLibrary,
  toTarget,
  type SavedSession,
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

const save = (lib: SessionLibrary, s: SavedSession) =>
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
  ].reduce(save, libraryReducer(emptyLibrary, { type: "addFolder", path: "Empty" }));

  it("nests folders first, then sessions, each sorted by name", () => {
    const tree = buildTree(lib, "");
    expect(tree.map((n) => n.name)).toEqual(["Empty", "Prod", "alpha", "zeta"]);
    const prod = tree[1];
    expect(prod.kind === "folder" && prod.children.map((n) => n.name)).toEqual(["Infra", "db"]);
  });

  it("filters by name or host and keeps only folders with matches", () => {
    expect(buildTree(lib, "10.0.0").map((n) => n.name)).toEqual(["Prod"]);
    const prod = buildTree(lib, "CACHE")[0];
    expect(prod.kind === "folder" && prod.children.map((n) => n.name)).toEqual(["Infra"]);
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
});
