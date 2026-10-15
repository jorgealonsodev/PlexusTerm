import { describe, expect, it } from "vitest";
import { parseQuickConnect, type QuickConnectForm } from "./quickConnect";

const form = (overrides: Partial<QuickConnectForm> = {}): QuickConnectForm => ({
  host: "example.com",
  port: "",
  username: "alice",
  method: "password",
  password: "pw",
  keyPath: "",
  passphrase: "",
  ...overrides,
});

describe("parseQuickConnect", () => {
  it("builds a password target with the default port", () => {
    expect(parseQuickConnect(form())).toEqual({
      ok: true,
      target: {
        type: "ssh",
        host: "example.com",
        port: 22,
        username: "alice",
        auth: { method: "password", password: "pw" },
      },
    });
  });

  it("accepts user@host:port in the host field", () => {
    const result = parseQuickConnect(form({ host: " bob@10.0.0.5:2222 ", username: "" }));
    expect(result).toMatchObject({
      ok: true,
      target: { host: "10.0.0.5", port: 2222, username: "bob" },
    });
  });

  it("an explicit port field wins over the host field", () => {
    const result = parseQuickConnect(form({ host: "h:2222", port: "2200" }));
    expect(result).toMatchObject({ ok: true, target: { host: "h", port: 2200 } });
  });

  it("builds key and agent targets", () => {
    expect(parseQuickConnect(form({ method: "key", keyPath: "~/.ssh/id_ed25519", passphrase: "" })))
      .toMatchObject({ ok: true, target: { auth: { method: "key", path: "~/.ssh/id_ed25519" } } });
    expect(parseQuickConnect(form({ method: "agent" }))).toMatchObject({
      ok: true,
      target: { auth: { method: "agent" } },
    });
  });

  it("keeps a key passphrase only when given", () => {
    const result = parseQuickConnect(form({ method: "key", keyPath: "/k", passphrase: "s3" }));
    expect(result).toMatchObject({
      ok: true,
      target: { auth: { method: "key", path: "/k", passphrase: "s3" } },
    });
  });

  it.each([
    [{ host: "" }, "Host is required"],
    [{ username: "" }, "Username is required"],
    [{ port: "70000" }, "Port must be a number between 1 and 65535"],
    [{ port: "abc" }, "Port must be a number between 1 and 65535"],
    [{ method: "key" as const, keyPath: "" }, "Private key path is required"],
  ])("rejects invalid input %o", (overrides, error) => {
    expect(parseQuickConnect(form(overrides))).toEqual({ ok: false, error });
  });
});
