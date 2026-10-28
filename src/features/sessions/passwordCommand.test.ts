import { describe, expect, it } from "vitest";
import { describeSshError, type SshError } from "../ssh/sshErrors";
import { parseQuickConnect, type QuickConnectForm } from "../ssh/quickConnect";
import { retriesAfter } from "../terminal/reconnect";
import { parseTabsDocument, sanitizeTarget, serializeTabs } from "../tabs/tabsPersist";
import { collectLogins } from "./jumpHosts";
import { emptyLibrary, parseLibrary, sanitizeSession, serializeLibrary, toTarget, type SavedSession } from "./library";
import { MAX_COMMAND_LENGTH, PASSWORD_COMMAND_PRESETS, passwordCommandsOf } from "./passwordCommand";
import { shouldAskAgain } from "./passwordFlow";
import { formFromSession, parseSessionForm } from "./sessionForm";
import { planLibraryImport } from "./sessionsExport";

const COMMAND = 'op read "op://Prod/db/password"';

const form = (overrides: Partial<QuickConnectForm> = {}): QuickConnectForm => ({
  host: "db.example.com",
  port: "",
  username: "alice",
  method: "passwordCommand",
  password: "",
  passwordCommand: COMMAND,
  keyPath: "~/.ssh/id_ed25519",
  passphrase: "",
  forwardAgent: false,
  tmux: false,
  tmuxSession: "plexus",
  proxyCommand: "",
  ...overrides,
});

const saved = (auth: SavedSession["auth"]): SavedSession => ({
  kind: "ssh",
  id: "s1",
  name: "db",
  folder: "",
  host: "db.example.com",
  port: 22,
  username: "alice",
  auth,
});

const commandFailure = (overrides: Partial<Extract<SshError, { kind: "passwordCommand" }>> = {}): SshError => ({
  kind: "passwordCommand",
  purpose: "password",
  failure: "exit",
  code: 1,
  stderr: "",
  ...overrides,
});

describe("password from a command (S5)", () => {
  it("quick connect logs in with the command, trimmed", () => {
    const result = parseQuickConnect(form({ passwordCommand: `  ${COMMAND}  ` }));
    expect(result).toEqual({
      ok: true,
      target: { type: "ssh", host: "db.example.com", port: 22, username: "alice", auth: { method: "passwordCommand", command: COMMAND } },
    });
  });

  it("refuses a blank command or one longer than the limit", () => {
    expect(parseQuickConnect(form({ passwordCommand: "  " }))).toEqual({
      ok: false,
      error: "Enter the command that prints the password",
    });
    expect(parseQuickConnect(form({ passwordCommand: "a".repeat(MAX_COMMAND_LENGTH + 1) }))).toEqual({
      ok: false,
      error: "The command may be at most 2000 characters long",
    });
    expect(
      parseQuickConnect(form({ method: "key", passphraseCommand: "a".repeat(MAX_COMMAND_LENGTH + 1) })),
    ).toEqual({ ok: false, error: "The command may be at most 2000 characters long" });
  });

  it("a key may take its passphrase from a command; a typed passphrase is still sent", () => {
    const result = parseQuickConnect(form({ method: "key", passphrase: "typed", passphraseCommand: " pass show k " }));
    expect(result.ok && result.target.auth).toEqual({
      method: "key",
      path: "~/.ssh/id_ed25519",
      passphrase: "typed",
      passphraseCommand: "pass show k",
    });
  });

  it("existing password, key and agent logins parse as before", () => {
    const pw = parseQuickConnect(form({ method: "password", password: "pw" }));
    expect(pw.ok && pw.target.auth).toEqual({ method: "password", password: "pw" });
    const key = parseQuickConnect(form({ method: "key", passphrase: "pp" }));
    expect(key.ok && key.target.auth).toEqual({ method: "key", path: "~/.ssh/id_ed25519", passphrase: "pp" });
    const agent = parseQuickConnect(form({ method: "agent" }));
    expect(agent.ok && agent.target.auth).toEqual({ method: "agent" });
  });

  it("a saved session keeps the command, and its form shows it again", () => {
    const result = parseSessionForm({ ...form(), kind: "ssh", name: "db", folder: "", serial: {} as never, telnet: {} as never, mosh: {} as never, local: {} as never }, "s1");
    expect(result.ok && result.session).toMatchObject({ auth: { method: "passwordCommand", command: COMMAND } });
    const back = formFromSession(saved({ method: "passwordCommand", command: COMMAND }));
    expect([back.method, back.passwordCommand]).toEqual(["passwordCommand", COMMAND]);

    const key = parseSessionForm(
      { ...form({ method: "key", passphrase: "typed", passphraseCommand: "pass show k" }), kind: "ssh", name: "db", folder: "", serial: {} as never, telnet: {} as never, mosh: {} as never, local: {} as never },
      "s1",
    );
    // The typed passphrase is a secret and is not saved; the command is.
    expect(key.ok && key.session).toMatchObject({ auth: { method: "key", path: "~/.ssh/id_ed25519", passphraseCommand: "pass show k" } });
    expect(JSON.stringify(key.ok && key.session)).not.toContain("typed");
    expect(formFromSession(saved({ method: "key", path: "~/k", passphraseCommand: "pass show k" })).passphraseCommand).toBe(
      "pass show k",
    );
  });

  it("sanitize, export and parse keep the command and never a password", () => {
    const session = { ...saved({ method: "passwordCommand", command: COMMAND, password: "hunter2" } as never) };
    expect(sanitizeSession(session)).toEqual(saved({ method: "passwordCommand", command: COMMAND }));
    const keyed = saved({ method: "key", path: "~/k", passphraseCommand: "pass show k", passphrase: "hunter2" } as never);
    expect(sanitizeSession(keyed)).toEqual(saved({ method: "key", path: "~/k", passphraseCommand: "pass show k" }));

    const json = serializeLibrary({ ...emptyLibrary, sessions: [session, { ...keyed, id: "s2" }] });
    expect(json).not.toContain("hunter2");
    const parsed = parseLibrary(json);
    expect(parsed.ok && parsed.library.sessions.map((s) => (s as SavedSession).auth)).toEqual([
      { method: "passwordCommand", command: COMMAND },
      { method: "key", path: "~/k", passphraseCommand: "pass show k" },
    ]);
  });

  it("a sessions file with a blank or too long command is not valid", () => {
    const file = (auth: unknown) => JSON.stringify({ version: 1, folders: [], sessions: [{ ...saved({ method: "agent" }), auth }] });
    expect(parseLibrary(file({ method: "passwordCommand", command: " " })).ok).toBe(false);
    expect(parseLibrary(file({ method: "passwordCommand", command: "a".repeat(MAX_COMMAND_LENGTH + 1) })).ok).toBe(false);
    expect(parseLibrary(file({ method: "key", path: "~/k", passphraseCommand: 42 })).ok).toBe(false);
  });

  it("connects with the command, on the target and on jump hosts", async () => {
    const session = saved({ method: "passwordCommand", command: COMMAND });
    expect(toTarget(session).auth).toEqual({ method: "passwordCommand", command: COMMAND });
    const logins = await collectLogins([session, { ...session, id: "s2" }], {
      secretExists: async () => false,
      askPassword: async () => {
        throw new Error("a password was asked");
      },
    });
    expect(logins).toEqual([
      { auth: { method: "passwordCommand", command: COMMAND } },
      { auth: { method: "passwordCommand", command: COMMAND } },
    ]);
  });

  it("restored tabs keep the command (it is not a secret)", () => {
    const target = { type: "ssh", host: "h", port: 22, username: "u", auth: { method: "passwordCommand", command: COMMAND } };
    expect(sanitizeTarget(target)).toEqual(target);
    const key = { ...target, auth: { method: "key", path: "~/k", passphrase: "hunter2", passphraseCommand: "pass show k" } };
    expect(sanitizeTarget(key)).toEqual({ ...target, auth: { method: "key", path: "~/k", passphraseCommand: "pass show k" } });
    const layout = { kind: "pane", id: "p1" } as const;
    const json = serializeTabs({ version: 1, active: 0, tabs: [{ source: { target: sanitizeTarget(key)! }, layout, focused: "p1", panes: {} }] });
    expect(json).not.toContain("hunter2");
    expect(parseTabsDocument(json)?.tabs[0]).toMatchObject({ source: { target: { auth: { passphraseCommand: "pass show k" } } } });
  });

  it("a failed command is shown with its reason and stderr, never retried as a network failure nor prompted for", () => {
    expect(describeSshError(commandFailure({ code: 3, stderr: "vault is locked\nrun bw unlock" }))).toBe(
      "The password command failed with exit code 3.\r\nvault is locked\r\nrun bw unlock",
    );
    expect(describeSshError(commandFailure({ purpose: "passphrase", failure: "timeout", code: null }))).toBe(
      "The passphrase command did not finish within 30 seconds and was stopped.",
    );
    expect(describeSshError(commandFailure({ failure: "empty", code: null }))).toBe("The password command printed nothing.");
    expect(describeSshError(commandFailure({ failure: "exit", code: null }))).toBe(
      "The password command was stopped by a signal.",
    );
    expect(retriesAfter(commandFailure())).toBe(false);
    expect(retriesAfter({ kind: "hop", hop: 1, name: "bastion", error: commandFailure() })).toBe(false);
    expect(shouldAskAgain({ method: "passwordCommand", command: COMMAND }, commandFailure())).toBe(false);
    expect(shouldAskAgain({ method: "passwordCommand", command: COMMAND }, { kind: "authFailed" })).toBe(false);
  });

  it("presets cover the common password managers with placeholders to fill in", () => {
    expect(PASSWORD_COMMAND_PRESETS.map((p) => [p.label, p.command])).toEqual([
      ["1Password", 'op read "op://VAULT/ITEM/password"'],
      ["Bitwarden", "bw get password ITEM"],
      ["pass", "pass show PATH"],
      ["GNOME Keyring / libsecret", "secret-tool lookup service NAME"],
      ["KeePassXC", "keepassxc-cli show -s -a Password --no-password --key-file KEYFILE DATABASE ENTRY"],
    ]);
  });

  it("an imported file keeps its commands, and the import lists them so none is hidden", () => {
    const file = serializeLibrary({
      ...emptyLibrary,
      sessions: [
        saved({ method: "passwordCommand", command: COMMAND }),
        { ...saved({ method: "key", path: "~/k", passphraseCommand: "pass show k" }), id: "s2", name: "web" },
        { ...saved({ method: "agent" }), id: "s3", name: "plain" },
      ],
    });
    let n = 0;
    const plan = planLibraryImport(emptyLibrary, file, () => `n${++n}`);
    expect(plan.toAdd.map((s) => (s as SavedSession).auth)).toEqual([
      { method: "passwordCommand", command: COMMAND },
      { method: "key", path: "~/k", passphraseCommand: "pass show k" },
      { method: "agent" },
    ]);
    expect(passwordCommandsOf(plan.toAdd)).toEqual([
      { name: "db", command: COMMAND },
      { name: "web", command: "pass show k" },
    ]);
  });
});
