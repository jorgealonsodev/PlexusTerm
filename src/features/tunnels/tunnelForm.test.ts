import { describe, expect, it } from "vitest";
import { formFromTunnel, parseTunnelForm, type TunnelForm } from "./tunnelForm";

const form = (overrides: Partial<TunnelForm> = {}): TunnelForm => ({
  name: "",
  type: "local",
  sessionId: "s1",
  listenHost: "",
  listenPort: "5433",
  destHost: "db.internal",
  destPort: "5432",
  ...overrides,
});

const sessions = ["s1", "s2"];

describe("parseTunnelForm", () => {
  it("defaults the name and the listen host", () => {
    expect(parseTunnelForm(form(), "t1", sessions)).toEqual({
      ok: true,
      tunnel: {
        id: "t1",
        name: "local 5433→db.internal:5432",
        type: "local",
        sessionId: "s1",
        listenHost: "127.0.0.1",
        listenPort: 5433,
        destHost: "db.internal",
        destPort: 5432,
      },
    });
  });

  it("keeps a typed name and listen host, trimmed", () => {
    const result = parseTunnelForm(form({ name: " DB ", listenHost: " 0.0.0.0 " }), "t1", sessions);
    expect(result.ok && [result.tunnel.name, result.tunnel.listenHost]).toEqual(["DB", "0.0.0.0"]);
  });

  it("requires ports from 1 to 65535", () => {
    for (const listenPort of ["", "0", "65536", "80a", "-1"]) {
      expect(parseTunnelForm(form({ listenPort }), "t1", sessions)).toEqual({
        ok: false,
        error: "Listen port must be a number between 1 and 65535",
      });
    }
    expect(parseTunnelForm(form({ destPort: "0" }), "t1", sessions)).toEqual({
      ok: false,
      error: "Destination port must be a number between 1 and 65535",
    });
  });

  it("requires a destination except for dynamic tunnels", () => {
    expect(parseTunnelForm(form({ destHost: " " }), "t1", sessions)).toEqual({
      ok: false,
      error: "Destination host is required",
    });
    const dynamic = parseTunnelForm(form({ type: "dynamic", destHost: "", destPort: "" }), "t1", sessions);
    expect(dynamic).toEqual({
      ok: true,
      tunnel: expect.objectContaining({ name: "dynamic 5433", destHost: "", destPort: 0 }),
    });
  });

  it("requires an existing saved session", () => {
    for (const sessionId of ["", "gone"]) {
      expect(parseTunnelForm(form({ sessionId }), "t1", sessions)).toEqual({
        ok: false,
        error: "Choose a saved SSH session",
      });
    }
  });
});

describe("formFromTunnel", () => {
  it("round-trips through the form", () => {
    const parsed = parseTunnelForm(form({ name: "DB" }), "t1", sessions);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parseTunnelForm(formFromTunnel(parsed.tunnel), "t1", sessions)).toEqual(parsed);
  });

  it("leaves the destination empty for dynamic tunnels", () => {
    const parsed = parseTunnelForm(form({ type: "dynamic" }), "t1", sessions);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(formFromTunnel(parsed.tunnel)).toMatchObject({ destHost: "", destPort: "" });
  });
});
