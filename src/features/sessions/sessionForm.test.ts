import { describe, expect, it } from "vitest";
import { defaultSerialForm } from "../serial/serialSettings";
import type { SavedSession } from "./library";
import { formFromSession, parseSessionForm, type SessionForm } from "./sessionForm";

const form = (overrides: Partial<SessionForm> = {}): SessionForm => ({
  name: "Web",
  folder: " Prod / Web ",
  host: "web.example.com",
  port: "",
  username: "deploy",
  method: "password",
  password: "",
  keyPath: "",
  passphrase: "",
  kind: "ssh",
  serial: defaultSerialForm,
  telnet: { host: "", port: "" },
  mosh: { sshSessionId: "", serverCommand: "" },
  local: { program: "", args: "", cwd: "" },
  ...overrides,
});

describe("parseSessionForm", () => {
  it("builds a saved session with a normalized folder and no password", () => {
    expect(parseSessionForm(form(), "id-1")).toEqual({
      ok: true,
      session: {
        kind: "ssh",
        id: "id-1",
        name: "Web",
        folder: "Prod/Web",
        host: "web.example.com",
        port: 22,
        username: "deploy",
        auth: { method: "password" },
      },
    });
  });

  it("defaults the name to user@host", () => {
    expect(parseSessionForm(form({ name: "  ", host: "h:2200" }), "x")).toMatchObject({
      ok: true,
      session: { name: "deploy@h", port: 2200 },
    });
  });

  it("keeps the key path but not the passphrase", () => {
    const result = parseSessionForm(form({ method: "key", keyPath: "~/.ssh/k", passphrase: "secret" }), "x");
    expect(result).toMatchObject({ ok: true, session: { auth: { method: "key", path: "~/.ssh/k" } } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports validation errors", () => {
    expect(parseSessionForm(form({ host: "" }), "x")).toEqual({ ok: false, error: "Host is required" });
  });
});

describe("parseSessionForm (serial)", () => {
  const serialForm = (overrides: Partial<SessionForm["serial"]> = {}) =>
    form({ kind: "serial", name: "", host: "", serial: { ...defaultSerialForm, path: "/dev/ttyUSB1", ...overrides } });

  it("builds a serial session named after the device by default", () => {
    expect(parseSessionForm(serialForm({ baud: "9600" }), "c-1")).toEqual({
      ok: true,
      session: {
        kind: "serial",
        id: "c-1",
        name: "/dev/ttyUSB1",
        folder: "Prod/Web",
        path: "/dev/ttyUSB1",
        baud: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        flow: "none",
      },
    });
  });

  it("reports serial validation errors", () => {
    expect(parseSessionForm(serialForm({ path: "" }), "x")).toEqual({ ok: false, error: "Serial port is required" });
  });

  it("round-trips a serial session", () => {
    const parsed = parseSessionForm(serialForm({ baud: "custom", customBaud: "250000", parity: "odd" }), "c-2");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parseSessionForm(formFromSession(parsed.session), "c-2")).toEqual(parsed);
  });
});

describe("parseSessionForm (Telnet and Mosh)", () => {
  const sshSession: SavedSession = {
    kind: "ssh",
    id: "s1",
    name: "web",
    folder: "",
    host: "web.example.com",
    port: 22,
    username: "deploy",
    auth: { method: "agent" },
  };
  const library = { sessions: [sshSession] };

  it("builds a Telnet session on port 23 by default, named after the host", () => {
    const result = parseSessionForm(form({ kind: "telnet", name: "", telnet: { host: " switch.lan ", port: "" } }), "t-1");
    expect(result).toEqual({
      ok: true,
      session: { kind: "telnet", id: "t-1", name: "switch.lan", folder: "Prod/Web", host: "switch.lan", port: 23 },
    });
  });

  it("reports Telnet validation errors", () => {
    expect(parseSessionForm(form({ kind: "telnet", telnet: { host: " ", port: "" } }), "t")).toEqual({
      ok: false,
      error: "Host is required",
    });
    expect(parseSessionForm(form({ kind: "telnet", telnet: { host: "h", port: "99999" } }), "t")).toEqual({
      ok: false,
      error: "Port must be a number between 1 and 65535",
    });
  });

  it("builds a Mosh session over a saved SSH session, keeping a custom server command", () => {
    const mosh = { sshSessionId: "s1", serverCommand: " mosh-server new -p 60010 " };
    expect(parseSessionForm(form({ kind: "mosh", name: "", mosh }), "m-1", library)).toEqual({
      ok: true,
      session: {
        kind: "mosh",
        id: "m-1",
        name: "web (mosh)",
        folder: "Prod/Web",
        sshSessionId: "s1",
        serverCommand: "mosh-server new -p 60010",
      },
    });
    const plain = parseSessionForm(form({ kind: "mosh", mosh: { sshSessionId: "s1", serverCommand: "" } }), "m-1", library);
    expect(plain.ok && plain.session).not.toHaveProperty("serverCommand");
  });

  it("requires an existing SSH session for Mosh", () => {
    const error = { ok: false, error: "Choose the saved SSH session Mosh logs in with" };
    expect(parseSessionForm(form({ kind: "mosh", mosh: { sshSessionId: "", serverCommand: "" } }), "m", library)).toEqual(error);
    expect(parseSessionForm(form({ kind: "mosh", mosh: { sshSessionId: "gone", serverCommand: "" } }), "m", library)).toEqual(error);
  });

  it("round-trips Telnet and Mosh sessions", () => {
    for (const f of [
      form({ kind: "telnet", telnet: { host: "h", port: "2323" } }),
      form({ kind: "mosh", mosh: { sshSessionId: "s1", serverCommand: "mosh-server new" } }),
    ]) {
      const parsed = parseSessionForm(f, "x", library);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parseSessionForm(formFromSession(parsed.session), "x", library)).toEqual(parsed);
    }
  });
});

describe("formFromSession", () => {
  it("round-trips a saved session", () => {
    const parsed = parseSessionForm(form({ method: "key", keyPath: "/k", port: "2222" }), "id-9");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parseSessionForm(formFromSession(parsed.session), "id-9")).toEqual(parsed);
  });
});

describe("parseSessionForm (jump hosts)", () => {
  it("keeps the ordered jump hosts of an SSH session", () => {
    const result = parseSessionForm(form({ jumpIds: ["b", "a"] }), "id-1");
    expect(result).toMatchObject({ ok: true, session: { jumpIds: ["b", "a"] } });
    if (result.ok) expect(parseSessionForm(formFromSession(result.session), "id-1")).toEqual(result);
  });

  it("leaves jumpIds out when there are none", () => {
    const result = parseSessionForm(form({ jumpIds: [] }), "id-1");
    expect(result.ok && result.session).not.toHaveProperty("jumpIds");
  });

  it("rejects a chain that loops back through another session's jump hosts", () => {
    const other: SavedSession = {
      kind: "ssh",
      id: "b",
      name: "bastion",
      folder: "",
      host: "bastion",
      port: 22,
      username: "u",
      auth: { method: "agent" },
      jumpIds: ["x"],
    };
    expect(parseSessionForm(form({ jumpIds: ["b"] }), "x", { sessions: [other] })).toMatchObject({
      ok: false,
      error: expect.stringContaining("cycle"),
    });
    const plain: SavedSession = { ...other, jumpIds: undefined };
    expect(parseSessionForm(form({ jumpIds: ["b"] }), "x", { sessions: [plain] })).toMatchObject({ ok: true });
  });

  it("rejects more than 3, repeated or self jump hosts", () => {
    expect(parseSessionForm(form({ jumpIds: ["a", "b", "c", "d"] }), "x")).toEqual({
      ok: false,
      error: "At most 3 jump hosts are allowed",
    });
    expect(parseSessionForm(form({ jumpIds: ["a", "a"] }), "x")).toEqual({
      ok: false,
      error: "A jump host is listed twice",
    });
    expect(parseSessionForm(form({ jumpIds: ["x"] }), "x")).toEqual({
      ok: false,
      error: "A session cannot be its own jump host",
    });
  });
});

describe("local session form (local shells S4)", () => {
  it("saves the shell, its split arguments and the starting directory", () => {
    const result = parseSessionForm(
      form({ kind: "local", name: " ", local: { program: " /usr/bin/fish ", args: "--login -C 'cd /srv'", cwd: " ~/src " } }),
      "l-1",
    );
    expect(result).toEqual({
      ok: true,
      session: { kind: "local", id: "l-1", name: "fish", folder: "Prod/Web", program: "/usr/bin/fish", args: ["--login", "-C", "cd /srv"], cwd: "~/src" },
    });
  });

  it("saves the system default shell without program or arguments, named Local shell", () => {
    expect(parseSessionForm(form({ kind: "local", name: "", folder: "", local: { program: "", args: "-x", cwd: "" } }), "l-2")).toEqual({
      ok: true,
      session: { kind: "local", id: "l-2", name: "Local shell", folder: "" },
    });
  });

  it("fills the form back, quoting arguments that have spaces", () => {
    const f = formFromSession({
      kind: "local",
      id: "l",
      name: "WSL",
      folder: "",
      program: "wsl.exe",
      args: ["-d", "Ubuntu 24.04", ""],
      cwd: "~",
    });
    expect(f.kind).toBe("local");
    expect(f.local).toEqual({ program: "wsl.exe", args: '-d "Ubuntu 24.04" ""', cwd: "~" });
    expect(parseSessionForm(f, "l")).toMatchObject({ ok: true, session: { args: ["-d", "Ubuntu 24.04", ""] } });
  });
});
