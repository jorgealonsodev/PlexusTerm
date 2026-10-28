import { describe, expect, it } from "vitest";
import { emptyLibrary, libraryReducer, type LibrarySession, type SessionLibrary } from "./library";
import { emptySyncState, mergeSync, noteLocal, parseSyncDoc, serializeSyncDoc, TOMBSTONE_DAYS, type SyncState } from "./sessionSync";

const DAY = 24 * 3600 * 1000;

const ssh = (id: string, name: string, folder = "", host = `${id}.example`): LibrarySession => ({
  kind: "ssh",
  id,
  name,
  folder,
  host,
  port: 22,
  username: "me",
  auth: { method: "agent" },
});
const lib = (sessions: LibrarySession[], folders: string[] = []): SessionLibrary =>
  sessions.reduce((acc, session) => libraryReducer(acc, { type: "saveSession", session }), { ...emptyLibrary, folders });
const names = (l: SessionLibrary) => l.sessions.map((s) => s.name);

/** One computer: its library and sync state, synced through `doc` (the shared file's text). */
class Computer {
  library: SessionLibrary;
  state: SyncState = emptySyncState;
  constructor(library: SessionLibrary = emptyLibrary) {
    this.library = library;
  }
  edit(action: Parameters<typeof libraryReducer>[1], now: number) {
    this.library = libraryReducer(this.library, action);
    this.state = noteLocal(this.library, this.state, now);
  }
  sync(file: { text: string | null }, now: number) {
    this.state = noteLocal(this.library, this.state, now);
    const result = mergeSync(this.library, this.state, file.text === null ? null : parseSyncDoc(file.text), now);
    this.library = result.library;
    this.state = result.state;
    file.text = serializeSyncDoc(result.state);
  }
}

describe("session sync", () => {
  it("brings the sessions of one computer to the other, and keeps them both", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web")]));
    const b = new Computer(lib([ssh("2", "db", "work")]));
    a.sync(file, 1000);
    b.sync(file, 2000);
    a.sync(file, 3000);
    expect(names(a.library).sort()).toEqual(["db", "web"]);
    expect(names(b.library).sort()).toEqual(["db", "web"]);
    expect(a.library.folders).toContain("work");
  });

  it("keeps the change made last when both computers edited the same session", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web")]));
    a.sync(file, 1000);
    const b = new Computer();
    b.sync(file, 1100);
    a.edit({ type: "saveSession", session: ssh("1", "web (old name on A)") }, 2000);
    b.edit({ type: "saveSession", session: ssh("1", "web (newer on B)") }, 3000);
    a.sync(file, 4000);
    b.sync(file, 5000);
    a.sync(file, 6000);
    expect(names(a.library)).toEqual(["web (newer on B)"]);
    expect(names(b.library)).toEqual(["web (newer on B)"]);
  });

  it("deletes on every computer a session deleted on one, unless it was edited after", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web"), ssh("2", "db")]));
    a.sync(file, 1000);
    const b = new Computer();
    b.sync(file, 1100);
    a.edit({ type: "deleteSession", id: "1" }, 2000);
    b.edit({ type: "saveSession", session: ssh("2", "db edited later") }, 2500);
    a.edit({ type: "deleteSession", id: "2" }, 2400);
    a.sync(file, 3000);
    b.sync(file, 3100);
    a.sync(file, 3200);
    // web: deleted on A, gone everywhere. db: deleted on A before B edited it: kept, edited.
    expect(names(b.library)).toEqual(["db edited later"]);
    expect(names(a.library)).toEqual(["db edited later"]);
  });

  it("deletes a folder everywhere, and keeps one created again afterwards", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web", "old")], ["empty"]));
    a.sync(file, 1000);
    const b = new Computer();
    b.sync(file, 1100);
    expect(b.library.folders.sort()).toEqual(["empty", "old"]);
    a.edit({ type: "deleteFolder", path: "old" }, 2000);
    a.edit({ type: "deleteFolder", path: "empty" }, 2000);
    a.sync(file, 2100);
    b.sync(file, 2200);
    expect(b.library.folders).toEqual([]);
    expect(b.library.sessions).toEqual([]);
    b.edit({ type: "addFolder", path: "empty" }, 3000);
    b.sync(file, 3100);
    a.sync(file, 3200);
    expect(a.library.folders).toEqual(["empty"]);
  });

  it("lets a computer syncing for the first time take the shared version of a session it also has", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web")]));
    a.sync(file, 1000);
    a.edit({ type: "saveSession", session: ssh("1", "web renamed") }, 2000);
    a.sync(file, 2100);
    // B imported the same session long ago, before the rename.
    const b = new Computer(lib([ssh("1", "web"), ssh("9", "only on B")]));
    b.state = noteLocal(b.library, emptySyncState, 0);
    const result = mergeSync(b.library, b.state, parseSyncDoc(file.text!), 9000);
    expect(names(result.library)).toEqual(["web renamed", "only on B"]);
  });

  it("drops a jump host deleted on another computer from the sessions that went through it", () => {
    const file = { text: null as string | null };
    const jump = ssh("j", "bastion");
    const target: LibrarySession = { ...ssh("s", "inner"), jumpIds: ["j"] } as LibrarySession;
    const a = new Computer(lib([jump, target]));
    a.sync(file, 1000);
    const b = new Computer();
    b.sync(file, 1100);
    a.edit({ type: "deleteSession", id: "j" }, 2000);
    b.edit({ type: "saveSession", session: { ...target, name: "inner renamed" } as LibrarySession }, 3000);
    a.sync(file, 3100);
    b.sync(file, 3200);
    const inner = b.library.sessions.find((s) => s.id === "s") as { jumpIds?: string[]; name: string };
    expect(inner.name).toBe("inner renamed");
    expect(inner.jumpIds ?? []).toEqual([]);
  });

  it("settles a tie between two different versions the same way on every computer", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "a's copy")]));
    const b = new Computer(lib([ssh("1", "b's copy")]));
    a.state = noteLocal(a.library, emptySyncState, 0);
    b.state = noteLocal(b.library, emptySyncState, 0);
    a.sync(file, 1000);
    b.sync(file, 1100);
    a.sync(file, 1200);
    const settled = file.text;
    b.sync(file, 1300);
    expect(names(a.library)).toEqual(names(b.library));
    expect(file.text).toBe(settled);
  });

  it("does not duplicate the sessions two computers imported from the same export (new ids on each)", () => {
    const file = { text: null as string | null };
    // A imported web and db (and inner through web); so did B, with ids of its own.
    const imported = (id: string, name: string, jumpIds?: string[]) =>
      ({ ...ssh(id, name, "", `${name}.example`), ...(jumpIds ? { jumpIds } : {}) }) as LibrarySession;
    const a = new Computer(lib([imported("a1", "web"), imported("a2", "db"), imported("a3", "inner", ["a1"])]));
    a.sync(file, 1000);
    const b = new Computer(lib([imported("b1", "web"), imported("b2", "db"), imported("b3", "inner", ["b1"]), ssh("b9", "only on B")]));
    b.state = noteLocal(b.library, emptySyncState, 0);
    b.sync(file, 2000);
    expect(names(b.library).sort()).toEqual(["db", "inner", "only on B", "web"]);
    // B's copies were dropped for A's, and B's inner goes through A's web.
    const inner = b.library.sessions.find((s) => s.name === "inner") as { id: string; jumpIds?: string[] };
    expect(inner.id).toBe("a3");
    expect(inner.jumpIds).toEqual(["a1"]);
    a.sync(file, 3000);
    expect(names(a.library).sort()).toEqual(["db", "inner", "only on B", "web"]);
  });

  it("keeps a session that only looks like one in the shared file once this computer synced before", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("a1", "web")]));
    a.sync(file, 1000);
    const b = new Computer();
    b.sync(file, 1100);
    // Later, B makes a second session just like it on purpose.
    b.edit({ type: "saveSession", session: ssh("b1", "web", "", "a1.example") }, 2000);
    b.sync(file, 2100);
    expect(b.library.sessions.map((s) => s.id).sort()).toEqual(["a1", "b1"]);
  });

  it("changes nothing in a library that is already in step, and writes no session the user did not have", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web")]));
    a.sync(file, 1000);
    const before = a.library;
    const text = file.text;
    a.sync(file, 5000);
    expect(a.library).toEqual(before);
    expect(file.text).toBe(text);
  });

  it("forgets deletions older than TOMBSTONE_DAYS", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([ssh("1", "web")]));
    a.sync(file, 0);
    a.edit({ type: "deleteSession", id: "1" }, 1000);
    a.sync(file, 2000);
    expect(file.text).toContain('"1"');
    a.sync(file, 1000 + (TOMBSTONE_DAYS + 1) * DAY);
    expect(file.text).not.toContain('"1"');
  });

  it("never takes passwords or anything outside the saved shape from the shared file", () => {
    const text = JSON.stringify({
      format: "plexusterm-sessions",
      version: 1,
      sessions: { x: { at: 1, session: { ...ssh("x", "evil"), password: "hunter2", auth: { method: "password", secret: "s" } } } },
      folders: {},
    });
    const doc = parseSyncDoc(text)!;
    const merged = mergeSync(emptyLibrary, emptySyncState, doc, 10);
    expect(JSON.stringify(merged.library)).not.toContain("hunter2");
    expect(JSON.stringify(merged.library)).not.toContain('"secret"');
    expect(names(merged.library)).toEqual(["evil"]);
  });

  it("refuses a file that is not a PlexusTerm sessions file, so it never empties the library", () => {
    expect(parseSyncDoc("not json")).toBeNull();
    expect(parseSyncDoc(JSON.stringify({ version: 1, sessions: [] }))).toBeNull();
    expect(parseSyncDoc(JSON.stringify({ format: "plexusterm-sessions", version: 2, sessions: {}, folders: {} }))).toBeNull();
    const bad = JSON.stringify({ format: "plexusterm-sessions", version: 1, sessions: { x: { at: 1, session: { id: "x" } } }, folders: {} });
    expect(parseSyncDoc(bad)).toBeNull();
  });

  it("brings agent forwarding and the tmux session of a session to the other computer", () => {
    const file = { text: null as string | null };
    const a = new Computer(lib([{ ...ssh("1", "web"), forwardAgent: true, tmuxSession: "work" } as LibrarySession]));
    const b = new Computer();
    a.sync(file, 1000);
    b.sync(file, 2000);
    expect(b.library.sessions[0]).toMatchObject({ forwardAgent: true, tmuxSession: "work" });
  });
});
