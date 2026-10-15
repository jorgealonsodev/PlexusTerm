import { describe, expect, it } from "vitest";
import { emptyLibrary, libraryReducer, type LibrarySession, type SavedSession } from "./library";
import {
  secretToForgetOnEdit,
  removedSshSessions,
  secretLabel,
  shouldAskAgain,
  storageFor,
  storedPasswordTarget,
  typedPasswordTarget,
} from "./passwordFlow";

const web: SavedSession = {
  kind: "ssh",
  id: "s1",
  name: "web",
  folder: "Prod",
  host: "10.0.0.1",
  port: 2222,
  username: "u",
  auth: { method: "password" },
};

describe("secretLabel", () => {
  it("names the session as NexusTerm: user@host:port", () => {
    expect(secretLabel(web)).toBe("NexusTerm: u@10.0.0.1:2222");
  });
});

describe("storedPasswordTarget", () => {
  it("connects with a reference to the saved password, never the password itself", () => {
    expect(storedPasswordTarget(web)).toEqual({
      type: "ssh",
      host: "10.0.0.1",
      port: 2222,
      username: "u",
      auth: { method: "storedPassword", sessionId: "s1" },
    });
  });
});

describe("typedPasswordTarget", () => {
  it("connects with the typed password and carries the storage request", () => {
    const storage = { action: "remember" as const, sessionId: "s1", label: "L" };
    expect(typedPasswordTarget(web, "pw", storage)).toEqual({
      type: "ssh",
      host: "10.0.0.1",
      port: 2222,
      username: "u",
      auth: { method: "password", password: "pw" },
      storage,
    });
  });

  it("omits storage when there is nothing to save or forget", () => {
    expect(typedPasswordTarget(web, "pw", undefined)).not.toHaveProperty("storage");
  });
});

describe("storageFor", () => {
  it("leaves a saved password alone when the keyring state is still unknown", () => {
    expect(storageFor(web, undefined, true)).toBeUndefined();
  });

  it("remembers the password when the checkbox is ticked", () => {
    expect(storageFor(web, true, false)).toEqual({
      action: "remember",
      sessionId: "s1",
      label: "NexusTerm: u@10.0.0.1:2222",
    });
    expect(storageFor(web, true, true)).toMatchObject({ action: "remember" });
  });

  it("forgets a saved password when the checkbox is unticked", () => {
    expect(storageFor(web, false, true)).toEqual({ action: "forget", sessionId: "s1" });
  });

  it("does nothing when unticked and nothing was saved", () => {
    expect(storageFor(web, false, false)).toBeUndefined();
  });
});

describe("shouldAskAgain", () => {
  const stored = { method: "storedPassword" as const, sessionId: "s1" };

  it("asks for the password when the saved one is missing or rejected", () => {
    expect(shouldAskAgain(stored, { kind: "secretMissing" })).toBe(true);
    expect(shouldAskAgain(stored, { kind: "authFailed" })).toBe(true);
  });

  it("does not ask again for other failures", () => {
    expect(shouldAskAgain(stored, { kind: "connection", message: "refused" })).toBe(false);
    expect(
      shouldAskAgain(stored, { kind: "unknownHost", host: "h", fingerprint: "f", otherKnownKeys: [] }),
    ).toBe(false);
  });

  it("never loops on a typed password", () => {
    expect(shouldAskAgain({ method: "password", password: "pw" }, { kind: "authFailed" })).toBe(false);
  });
});

describe("removedSshSessions", () => {
  const serial: LibrarySession = {
    kind: "serial",
    id: "c1",
    name: "console",
    folder: "Prod",
    path: "/dev/ttyUSB0",
    baud: 115200,
    dataBits: 8,
    parity: "none",
    stopBits: 1,
    flow: "none",
  };
  const db: SavedSession = { ...web, id: "s2", name: "db", folder: "Dev" };
  const library = libraryReducer(emptyLibrary, { type: "saveSessions", sessions: [web, db, serial] });

  it("lists the deleted SSH session", () => {
    expect(removedSshSessions(library, { type: "deleteSession", id: "s1" }).map((s) => s.id)).toEqual(["s1"]);
  });

  it("lists every SSH session inside a deleted folder, but no serial session", () => {
    expect(removedSshSessions(library, { type: "deleteFolder", path: "Prod" }).map((s) => s.id)).toEqual(["s1"]);
  });

  it("lists nothing for actions that delete no session", () => {
    expect(removedSshSessions(library, { type: "addFolder", path: "X" })).toEqual([]);
  });
});

describe("secretToForgetOnEdit", () => {
  it("forgets the saved password when a session stops using password authentication", () => {
    expect(secretToForgetOnEdit(web, { ...web, auth: { method: "agent" } })).toBe(web.id);
  });

  it("forgets it when the host, port or username changes", () => {
    expect(secretToForgetOnEdit(web, { ...web, host: "10.0.0.2" })).toBe(web.id);
    expect(secretToForgetOnEdit(web, { ...web, port: 22 })).toBe(web.id);
    expect(secretToForgetOnEdit(web, { ...web, username: "root" })).toBe(web.id);
  });

  it("keeps it while the session still uses a password for the same endpoint, and ignores other sessions", () => {
    expect(secretToForgetOnEdit(web, { ...web, name: "renamed", folder: "Other" })).toBeNull();
    expect(secretToForgetOnEdit(web, { ...web, host: " 10.0.0.1 " })).toBeNull();
    const key: SavedSession = { ...web, auth: { method: "key", path: "/k" } };
    expect(secretToForgetOnEdit(key, { ...key, auth: { method: "agent" } })).toBeNull();
  });
});
