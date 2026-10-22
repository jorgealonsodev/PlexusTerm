import { describe, expect, it } from "vitest";
import { emptyLibrary, parseLibrary, type LibrarySession, type SessionLibrary } from "./library";
import { exportLibrary, planLibraryImport } from "./sessionsExport";

const sessions: LibrarySession[] = [
  { kind: "ssh", id: "b", name: "bastion", folder: "Prod", host: "1.2.3.4", port: 22, username: "admin", auth: { method: "key", path: "~/.ssh/id_b" } },
  { kind: "ssh", id: "a", name: "app", folder: "Prod", host: "10.0.0.2", port: 2222, username: "root", auth: { method: "password" }, jumpIds: ["b"] },
  { kind: "mosh", id: "m", name: "app (mosh)", folder: "Prod", sshSessionId: "a" },
  { kind: "telnet", id: "t", name: "switch", folder: "", host: "10.0.0.9", port: 23 },
  { kind: "serial", id: "s", name: "router", folder: "Lab", path: "/dev/ttyUSB0", baud: 9600, dataBits: 8, parity: "none", stopBits: 1, flow: "none" },
  { kind: "local", id: "l", name: "fish", folder: "", program: "/usr/bin/fish", args: ["--login"] },
];
const library: SessionLibrary = { version: 1, folders: ["Empty"], sessions };

const counter = () => {
  let n = 0;
  return () => `new-${++n}`;
};

describe("session export", () => {
  it("writes the whole library as PlexusTerm reads it back, with no password field", () => {
    const json = exportLibrary(library);
    const parsed = parseLibrary(json);
    expect(parsed.ok && parsed.library).toEqual(library);
    expect(json).not.toMatch(/password"\s*:/i);
  });

  it("imports every session under Imported with new ids, keeping jump hosts and Mosh logins linked", () => {
    const plan = planLibraryImport(emptyLibrary, exportLibrary(library), counter());
    expect(plan.duplicates).toBe(0);
    expect(plan.skipped).toEqual({});
    expect(plan.toAdd.map((s) => [s.name, s.folder])).toEqual([
      ["bastion", "Imported/Prod"],
      ["app", "Imported/Prod"],
      ["switch", "Imported"],
      ["router", "Imported/Lab"],
      ["fish", "Imported"],
      ["app (mosh)", "Imported/Prod"],
    ]);
    const byName = Object.fromEntries(plan.toAdd.map((s) => [s.name, s]));
    expect(byName.app).toMatchObject({ id: "new-2", jumpIds: ["new-1"], auth: { method: "password" } });
    expect(byName.bastion).toMatchObject({ auth: { method: "key", path: "~/.ssh/id_b" } });
    expect(byName["app (mosh)"]).toMatchObject({ sshSessionId: "new-2" });
  });

  it("adds nothing when the same export is imported again, and links to the sessions already saved", () => {
    const first = planLibraryImport(emptyLibrary, exportLibrary(library), counter());
    const saved: SessionLibrary = { version: 1, folders: [], sessions: first.toAdd };
    const again = planLibraryImport(saved, exportLibrary(library), counter());
    expect(again.toAdd).toEqual([]);
    expect(again.duplicates).toBe(sessions.length);
  });

  it("refuses a file that is not a PlexusTerm export", () => {
    expect(() => planLibraryImport(emptyLibrary, "{ nope", counter())).toThrow();
    expect(() => planLibraryImport(emptyLibrary, JSON.stringify({ version: 9 }), counter())).toThrow();
  });
});
