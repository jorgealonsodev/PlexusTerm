import { describe, expect, it } from "vitest";
import {
  describeTunnel,
  emptyTunnels,
  isLoopback,
  parseTunnels,
  serializeTunnels,
  tunnelsReducer,
  type Tunnel,
} from "./tunnels";

const tunnel = (overrides: Partial<Tunnel> = {}): Tunnel => ({
  id: "t1",
  name: "db",
  type: "local",
  sessionId: "s1",
  listenHost: "127.0.0.1",
  listenPort: 5433,
  destHost: "db.internal",
  destPort: 5432,
  ...overrides,
});

describe("tunnelsReducer", () => {
  it("adds, replaces and deletes tunnels by id", () => {
    let list = tunnelsReducer(emptyTunnels, { type: "save", tunnel: tunnel() });
    list = tunnelsReducer(list, { type: "save", tunnel: tunnel({ id: "t2", name: "web" }) });
    list = tunnelsReducer(list, { type: "save", tunnel: tunnel({ name: "renamed" }) });
    expect(list.tunnels.map((t) => t.name)).toEqual(["renamed", "web"]);
    list = tunnelsReducer(list, { type: "delete", id: "t1" });
    expect(list.tunnels.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("parseTunnels / serializeTunnels", () => {
  it("treats a missing file as an empty list", () => {
    expect(parseTunnels(null)).toEqual({ ok: true, list: emptyTunnels });
  });

  it("round-trips and drops fields that are not part of the saved shape", () => {
    const list = { version: 1 as const, tunnels: [{ ...tunnel(), password: "secret" } as Tunnel] };
    const json = serializeTunnels(list);
    expect(json).not.toContain("secret");
    expect(parseTunnels(json)).toEqual({ ok: true, list: { version: 1, tunnels: [tunnel()] } });
  });

  it("reports corrupt files as errors instead of emptying them", () => {
    expect(parseTunnels("{oops").ok).toBe(false);
    expect(parseTunnels('{"version":2,"tunnels":[]}').ok).toBe(false);
    expect(parseTunnels('{"version":1,"tunnels":[{"id":"x"}]}').ok).toBe(false);
    const badType = JSON.stringify({ version: 1, tunnels: [tunnel({ type: "other" as Tunnel["type"] })] });
    expect(parseTunnels(badType).ok).toBe(false);
    const badPort = JSON.stringify({ version: 1, tunnels: [tunnel({ listenPort: 70000 })] });
    expect(parseTunnels(badPort).ok).toBe(false);
  });

  it("accepts dynamic tunnels without a destination", () => {
    const dynamic = tunnel({ type: "dynamic", destHost: "", destPort: 0 });
    const parsed = parseTunnels(JSON.stringify({ version: 1, tunnels: [dynamic] }));
    expect(parsed).toEqual({ ok: true, list: { version: 1, tunnels: [dynamic] } });
  });
});

describe("describeTunnel", () => {
  it("summarizes each type", () => {
    expect(describeTunnel(tunnel())).toBe("L 127.0.0.1:5433 → db.internal:5432");
    expect(describeTunnel(tunnel({ type: "remote", listenPort: 8080, destHost: "localhost", destPort: 3000 }))).toBe(
      "R 127.0.0.1:8080 → localhost:3000",
    );
    expect(describeTunnel(tunnel({ type: "dynamic", listenPort: 1080, destHost: "", destPort: 0 }))).toBe(
      "D 127.0.0.1:1080 (SOCKS5)",
    );
    expect(describeTunnel(tunnel({ listenHost: "::1" }))).toBe("L [::1]:5433 → db.internal:5432");
  });
});

describe("isLoopback", () => {
  it("accepts only loopback listen addresses", () => {
    expect(["127.0.0.1", "localhost", "::1", " LOCALHOST "].every(isLoopback)).toBe(true);
    expect(["0.0.0.0", "192.168.1.5", "::", ""].some(isLoopback)).toBe(false);
  });
});
