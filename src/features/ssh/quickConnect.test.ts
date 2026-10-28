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
  forwardAgent: false,
  tmux: false,
  tmuxSession: "plexus",
  proxyCommand: "",
  ...overrides,
});

describe("parseQuickConnect: proxy command", () => {
  it("keeps a trimmed proxy command and leaves a blank one out", () => {
    const proxied = parseQuickConnect(form({ proxyCommand: "  cloudflared access ssh --hostname %h  " }));
    expect(proxied.ok && proxied.target.proxyCommand).toBe("cloudflared access ssh --hostname %h");
    const plain = parseQuickConnect(form({ proxyCommand: "   " }));
    expect(plain.ok && plain.target).not.toHaveProperty("proxyCommand");
  });

  it.each(["a".repeat(2001), "nc %h %p\nrm -rf ~"])("rejects the proxy command %#", (proxyCommand) => {
    expect(parseQuickConnect(form({ proxyCommand }))).toEqual({
      ok: false,
      error: "The proxy command must be one line of at most 2000 characters",
    });
  });
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

  it.each([
    ["::1", "::1", 22],
    ["[::1]", "::1", 22],
    ["[fe80::1%eth0]:2222", "fe80::1%eth0", 2222],
    ["bob@[2001:db8::7]:2200", "2001:db8::7", 2200],
  ])("parses the IPv6 address %s", (input, host, port) => {
    expect(parseQuickConnect(form({ host: input }))).toMatchObject({ ok: true, target: { host, port } });
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

  it("adds agent forwarding and the tmux session only when they are ticked", () => {
    const plain = parseQuickConnect(form({ tmuxSession: "work" }));
    expect(plain.ok && plain.target).not.toHaveProperty("forwardAgent");
    expect(plain.ok && plain.target).not.toHaveProperty("tmuxSession");
    const both = parseQuickConnect(form({ forwardAgent: true, tmux: true, tmuxSession: " work.2_x-y " }));
    expect(both.ok && both.target).toMatchObject({ forwardAgent: true, tmuxSession: "work.2_x-y" });
  });

  it("uses the tmux session plexus when the name is left blank", () => {
    const result = parseQuickConnect(form({ tmux: true, tmuxSession: "  " }));
    expect(result.ok && result.target.tmuxSession).toBe("plexus");
  });

  it.each(["a b", "x';rm", "ñ", "a".repeat(65)])("rejects the tmux session name %j", (tmuxSession) => {
    expect(parseQuickConnect(form({ tmux: true, tmuxSession }))).toEqual({
      ok: false,
      error: "The tmux session name may only use letters, digits, dots, underscores and dashes (64 at most)",
    });
  });

  it("ignores an invalid tmux session name while tmux is off", () => {
    expect(parseQuickConnect(form({ tmux: false, tmuxSession: "a b" })).ok).toBe(true);
  });
});
