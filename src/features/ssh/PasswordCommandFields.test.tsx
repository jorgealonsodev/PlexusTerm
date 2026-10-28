// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { QuickConnectDialog } from "./QuickConnectDialog";
import { IniImportDialog } from "../sessions/IniImportDialog";
import { SessionEditDialog } from "../sessions/SessionEditDialog";
import type { SavedSession } from "../sessions/library";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const db: SavedSession = {
  kind: "ssh",
  id: "s1",
  name: "db",
  folder: "",
  host: "db.example.com",
  port: 22,
  username: "alice",
  auth: { method: "passwordCommand", command: "pass show prod/db" },
};

beforeEach(() => mockedInvoke.mockReset().mockResolvedValue(false));
afterEach(cleanup);

const pickPreset = (label: string) => {
  const presets = screen.getByLabelText<HTMLSelectElement>("Presets");
  const option = [...presets.options].find((o) => o.textContent === label)!;
  fireEvent.change(presets, { target: { value: option.value } });
};

describe("password from a command fields (S5)", () => {
  it("quick connect: a preset fills the command, which is what the login uses; no password is asked", () => {
    const onConnect = vi.fn();
    render(<QuickConnectDialog onConnect={onConnect} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Remote host"), { target: { value: "alice@db.example.com" } });
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "passwordCommand" } });
    expect(screen.queryByLabelText("Password")).toBeNull();

    pickPreset("Bitwarden");
    const field = screen.getByLabelText<HTMLInputElement>("Password command");
    expect(field.value).toBe("bw get password ITEM");
    fireEvent.change(field, { target: { value: "bw get password prod-db" } });
    fireEvent.click(screen.getByText("Connect"));
    expect(onConnect.mock.calls[0][0].auth).toEqual({ method: "passwordCommand", command: "bw get password prod-db" });
  });

  it("every preset fills its template", () => {
    render(<QuickConnectDialog onConnect={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Authentication"), { target: { value: "passwordCommand" } });
    const field = screen.getByLabelText<HTMLInputElement>("Password command");
    const filled = ["1Password", "Bitwarden", "pass", "GNOME Keyring / libsecret", "KeePassXC"].map((label) => {
      pickPreset(label);
      return field.value;
    });
    expect(filled).toEqual([
      'op read "op://VAULT/ITEM/password"',
      "bw get password ITEM",
      "pass show PATH",
      "secret-tool lookup service NAME",
      "keepassxc-cli show -s -a Password DATABASE ENTRY",
    ]);
  });

  it("a saved session shows its command and saves the edited one", () => {
    const onSave = vi.fn();
    render(<SessionEditDialog session={db} isNew={false} folders={[]} onSave={onSave} onCancel={() => {}} />);
    const field = screen.getByLabelText<HTMLInputElement>("Password command");
    expect(field.value).toBe("pass show prod/db");
    fireEvent.change(field, { target: { value: "pass show prod/db2" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].auth).toEqual({ method: "passwordCommand", command: "pass show prod/db2" });
  });

  it("a key's passphrase may come from a command, filled from a preset and saved", () => {
    const onSave = vi.fn();
    render(
      <SessionEditDialog
        session={{ ...db, auth: { method: "key", path: "~/.ssh/work" } }}
        isNew={false}
        folders={[]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    pickPreset("1Password");
    expect(screen.getByLabelText<HTMLInputElement>("Passphrase from a command (optional)").value).toBe(
      'op read "op://VAULT/ITEM/password"',
    );
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].auth).toEqual({
      method: "key",
      path: "~/.ssh/work",
      passphraseCommand: 'op read "op://VAULT/ITEM/password"',
    });
  });

  it("the import preview lists every command the imported sessions would run", () => {
    render(
      <IniImportDialog
        result={{
          ok: true,
          plan: {
            toAdd: [db, { ...db, id: "s2", name: "web", auth: { method: "key", path: "~/k", passphraseCommand: "op read x" } }],
            duplicates: 0,
            skipped: {},
          },
        }}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/run a command on this computer/)).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["db: pass show prod/db", "web: op read x"]);
  });
});
