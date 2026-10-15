import { describe, expect, it } from "vitest";
import { emptyLibrary, libraryReducer, type SavedSession } from "./library";
import { decodeIni, parseSessionsIni, planImport } from "./iniImport";

const SAMPLE = [
  "[Misc]",
  "SessionName=ignored=#109#0%misc.example.com%22%root%",
  "",
  "[Bookmarks]",
  "SubRep=",
  "ImgNum=42",
  "web=#109#0%web.example.com%2222%deploy%%-1%-1%%%22%%0%0%0%%%-1%0%0%0%%1080%%0%0%1#Font%10%0%0%-1%15#0# #-1",
  "bare=#109#0%bare.example.com%%%%-1",
  "telnet box=#98#1%tel.example.com%23%%",
  "desktop=#91#4%rdp.example.com%3389%admin%",
  "rdp=#1#0%rdp2.example.com%3389%",
  "garbage=this is not a session",
  "",
  "[Bookmarks_1]",
  "SubRep=Prod\\DB",
  "ImgNum=41",
  "db1=#109#0%10.0.0.5%abc% admin %",
  "nohost=#109#0%  %22%root%",
  "vnc=#2#0%vnc.example.com%5900%",
  "serial=#131#0%COM1%",
  "wsl=#105#0%Ubuntu%",
  "ftp=#4#0%ftp.example.com%21%",
  "",
  "[Passwords]",
  "root@web.example.com=SECRET_PASSWORD_HASH",
].join("\r\n");

describe("decodeIni", () => {
  it("decodes UTF-8 and strips the BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("[Bookmarks]\nSeñal=x")]);
    expect(decodeIni(bytes)).toBe("[Bookmarks]\nSeñal=x");
  });

  it("falls back to Windows-1252 when the bytes are not valid UTF-8", () => {
    const bytes = new Uint8Array([0x53, 0x65, 0xf1, 0x61, 0x6c, 0x3d, 0x80]); // "Señal=€" in cp1252
    expect(decodeIni(bytes)).toBe("Señal=€");
  });
});

describe("parseSessionsIni", () => {
  const parsed = parseSessionsIni(SAMPLE);

  it("imports SSH sessions from every Bookmarks section with their SubRep folder", () => {
    expect(parsed.sessions).toEqual([
      { name: "web", folder: "Imported", host: "web.example.com", port: 2222, username: "deploy" },
      { name: "bare", folder: "Imported", host: "bare.example.com", port: 22, username: "" },
      { name: "db1", folder: "Imported/Prod/DB", host: "10.0.0.5", port: 22, username: "admin" },
    ]);
  });

  it("counts skipped lines per type and reason", () => {
    expect(parsed.skipped).toEqual({
      Telnet: 1,
      "type 91": 1,
      RDP: 1,
      unrecognized: 1,
      invalid: 1,
      VNC: 1,
      Serial: 1,
      WSL: 1,
      FTP: 1,
    });
  });

  it("never reads other sections such as [Passwords]", () => {
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("SECRET_PASSWORD_HASH");
    expect(text).not.toContain("misc.example.com");
  });

  it("accepts LF line endings and rejects out-of-range ports", () => {
    const lf = parseSessionsIni("[Bookmarks_3]\nSubRep=A\\\\B\\\na=#109#0%h%70000%u%\nb=#109#0%h2%0%u%\n");
    expect(lf.sessions).toEqual([
      { name: "a", folder: "Imported/A/B", host: "h", port: 22, username: "u" },
      { name: "b", folder: "Imported/A/B", host: "h2", port: 22, username: "u" },
    ]);
  });

  it("returns nothing for a file without bookmarks", () => {
    expect(parseSessionsIni("[Misc]\nfoo=bar\n")).toEqual({ sessions: [], skipped: {} });
  });
});

describe("planImport", () => {
  const existing: SavedSession = {
    id: "old",
    name: "web",
    folder: "Imported",
    host: "web.example.com",
    port: 2222,
    username: "deploy",
    auth: { method: "agent" },
  };
  const library = libraryReducer(emptyLibrary, { type: "saveSession", session: existing });

  it("adds new sessions with password auth and skips duplicates of saved sessions", () => {
    let n = 0;
    const plan = planImport(library, parseSessionsIni(SAMPLE), () => `id${++n}`);
    expect(plan.duplicates).toBe(1);
    expect(plan.toAdd).toEqual([
      {
        kind: "ssh",
        id: "id1",
        name: "bare",
        folder: "Imported",
        host: "bare.example.com",
        port: 22,
        username: "",
        auth: { method: "password" },
      },
      {
        kind: "ssh",
        id: "id2",
        name: "db1",
        folder: "Imported/Prod/DB",
        host: "10.0.0.5",
        port: 22,
        username: "admin",
        auth: { method: "password" },
      },
    ]);
    expect(plan.skipped).toEqual(parseSessionsIni(SAMPLE).skipped);
  });

  it("de-duplicates repeated lines inside the same file", () => {
    const text = "[Bookmarks]\nSubRep=\na=#109#0%h%22%u%\n[Bookmarks_1]\nSubRep=\na=#109#0%h%22%u%\n";
    const plan = planImport(emptyLibrary, parseSessionsIni(text), () => "x");
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
  });

  it("does not compare imported hosts against serial sessions", () => {
    const withSerial = libraryReducer(library, {
      type: "saveSession",
      session: {
        kind: "serial",
        id: "c",
        name: "web",
        folder: "Imported",
        path: "/dev/ttyUSB0",
        baud: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flow: "none",
      },
    });
    const text = "[Bookmarks]\nweb=#109#0%web.example.com%2222%deploy%\n";
    expect(planImport(withSerial, parseSessionsIni(text), () => "x").duplicates).toBe(1);
  });

  it("treats a different port or user as a different session", () => {
    const text = "[Bookmarks]\nweb=#109#0%web.example.com%22%deploy%\n";
    expect(planImport(library, parseSessionsIni(text), () => "x").toAdd).toHaveLength(1);
  });
});
