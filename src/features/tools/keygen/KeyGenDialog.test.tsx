// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "../../terminal/clipboard";
import type { SavedSession } from "../../sessions/library";
import { KeyGenDialog } from "./KeyGenDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../terminal/clipboard", () => ({ writeText: vi.fn(async () => undefined), readText: vi.fn() }));

const PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKey me@laptop";
const GENERATED = { id: 7, publicKey: PUBLIC, fingerprint: "SHA256:abc", comment: "me@laptop", keyType: "ED25519", encrypted: false };
const RSA_PUBLIC = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ old@box";
const LOADED = { id: 9, publicKey: RSA_PUBLIC, fingerprint: "SHA256:rsa", comment: "old@box", keyType: "RSA 3072", encrypted: true };

const web: SavedSession = {
  kind: "ssh",
  id: "s1",
  name: "web",
  folder: "",
  host: "web.example",
  port: 22,
  username: "deploy",
  auth: { method: "password" },
};
const db: SavedSession = { ...web, id: "s2", name: "db", host: "db.example", auth: { method: "agent" } };

/** Backend answers by command; `install` decides what `keygen_install` does. */
let install: (args: Record<string, unknown>) => unknown;
let saveResult: (args: Record<string, unknown>) => unknown;
let loadResult: (args: Record<string, unknown>) => unknown;

beforeEach(() => {
  install = () => "added";
  saveResult = () => undefined;
  loadResult = () => LOADED;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "keygen_generate") return GENERATED;
    if (cmd === "keygen_load") return loadResult(a);
    if (cmd === "keygen_update")
      return { ...LOADED, comment: a.comment, encrypted: a.passphrase !== null, publicKey: `ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ ${String(a.comment)}` };
    if (cmd.startsWith("keygen_save") || cmd === "keygen_export_ppk") return saveResult({ cmd, ...a });
    if (cmd === "keygen_install") return install(a);
    if (cmd === "secret_exists") return false;
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(save).mockReset();
  vi.mocked(open).mockReset();
  vi.mocked(writeText).mockClear();
});

const click = async (name: string) => act(async () => void fireEvent.click(screen.getByRole("button", { name })));

async function generate(passphrase = "", confirm = passphrase) {
  fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: passphrase } });
  fireEvent.change(screen.getByLabelText("Confirm passphrase"), { target: { value: confirm } });
  fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "me@laptop" } });
  await click("Generate");
}

describe("KeyGenDialog", () => {
  it("refuses to generate when the passphrases differ", async () => {
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await generate("one", "two");
    expect(screen.getByRole("alert").textContent).toBe("The passphrases do not match.");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("generates a key, shows only its public half and copies it", async () => {
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await generate("secret words");
    expect(invoke).toHaveBeenCalledWith("keygen_generate", {
      keyType: "ed25519",
      passphrase: "secret words",
      comment: "me@laptop",
    });
    const textarea = screen.getByLabelText("Public key") as HTMLTextAreaElement;
    expect(textarea.value).toBe(PUBLIC);
    expect(textarea.readOnly).toBe(true);
    expect(screen.getByText("SHA256:abc")).toBeTruthy();
    await click("Copy");
    expect(writeText).toHaveBeenCalledWith(PUBLIC);
    expect(screen.getByRole("status").textContent).toBe("Public key copied to the clipboard.");
  });

  it("generates the chosen type and size, RSA 3072 and ECDSA P-256 by default", async () => {
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    expect(screen.queryByLabelText("Size")).toBeNull();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "rsa" } });
    const size = screen.getByLabelText("Size") as HTMLSelectElement;
    expect(size.value).toBe("3072");
    expect([...size.options].map((o) => o.value)).toEqual(["2048", "3072", "4096"]);
    fireEvent.change(size, { target: { value: "4096" } });
    await click("Generate");
    expect(invoke).toHaveBeenLastCalledWith("keygen_generate", { keyType: "rsa-4096", passphrase: null, comment: "" });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ecdsa" } });
    const curves = screen.getByLabelText("Size") as HTMLSelectElement;
    expect(curves.value).toBe("256");
    expect([...curves.options].map((o) => o.value)).toEqual(["256", "384", "521"]);
    fireEvent.change(curves, { target: { value: "521" } });
    await click("Generate again");
    expect(invoke).toHaveBeenLastCalledWith("keygen_generate", { keyType: "ecdsa-p521", passphrase: null, comment: "" });
  });

  it("saves the public and the private key separately, asking before overwriting", async () => {
    vi.mocked(save).mockImplementation(async (o) => `/home/me/.ssh/${String(o?.defaultPath)}`);
    saveResult = (a) => {
      if (!a.overwrite) throw { kind: "exists", path: a.path };
    };
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await generate();
    await click("Save public key…");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "id_ed25519.pub" }));
    expect(invoke).toHaveBeenCalledWith("keygen_save_public", { id: 7, path: "/home/me/.ssh/id_ed25519.pub", overwrite: false });
    expect(screen.getByRole("alert").textContent).toBe("/home/me/.ssh/id_ed25519.pub already exists. Overwrite it?");
    await click("Overwrite");
    expect(invoke).toHaveBeenCalledWith("keygen_save_public", { id: 7, path: "/home/me/.ssh/id_ed25519.pub", overwrite: true });
    expect(screen.getByRole("status").textContent).toBe("Saved the public key to /home/me/.ssh/id_ed25519.pub.");

    await click("Save private key…");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "id_ed25519" }));
    expect(invoke).toHaveBeenCalledWith("keygen_save_private", { id: 7, path: "/home/me/.ssh/id_ed25519", overwrite: false });
    await click("Keep the file");
    expect(screen.queryByRole("button", { name: "Overwrite" })).toBeNull();
    expect(invoke).not.toHaveBeenCalledWith("keygen_save_private", expect.objectContaining({ overwrite: true }));
    expect(invoke).not.toHaveBeenCalledWith("keygen_save", expect.anything());
  });

  it("saves the key as a PuTTY .ppk file", async () => {
    vi.mocked(save).mockResolvedValue("/keys/work.ppk");
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await generate();
    await click("Save as PuTTY key (.ppk)…");
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: "id_ed25519.ppk" }));
    expect(invoke).toHaveBeenCalledWith("keygen_export_ppk", { id: 7, path: "/keys/work.ppk", overwrite: false });
    expect(screen.getByRole("status").textContent).toBe("Saved the PuTTY key to /keys/work.ppk.");
  });

  it("loads a key file, asking for its passphrase until it is right", async () => {
    vi.mocked(open).mockResolvedValue("/keys/id_rsa");
    loadResult = (a) => {
      if (a.passphrase === null) throw { kind: "passphraseRequired" };
      if (a.passphrase !== "right") throw { kind: "wrongPassphrase" };
      return LOADED;
    };
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await click("Load…");
    expect(invoke).toHaveBeenCalledWith("keygen_load", { path: "/keys/id_rsa", passphrase: null });
    fireEvent.change(screen.getByLabelText("Passphrase of id_rsa"), { target: { value: "bad" } });
    await click("Unlock");
    expect(screen.getByRole("alert").textContent).toBe("Wrong passphrase.");
    fireEvent.change(screen.getByLabelText("Passphrase of id_rsa"), { target: { value: "right" } });
    await click("Unlock");
    expect(invoke).toHaveBeenLastCalledWith("keygen_load", { path: "/keys/id_rsa", passphrase: "right" });
    expect((screen.getByLabelText("Public key") as HTMLTextAreaElement).value).toBe(RSA_PUBLIC);
    expect(screen.getByText("SHA256:rsa")).toBeTruthy();
    expect(screen.getByText("RSA 3072")).toBeTruthy();
    expect((screen.getByLabelText("Comment") as HTMLInputElement).value).toBe("old@box");
    expect((screen.getByLabelText("Passphrase") as HTMLInputElement).value).toBe("right");
    expect(screen.queryByLabelText("Passphrase of id_rsa")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Loaded /keys/id_rsa (protected by its passphrase).");
  });

  it("applies a changed comment and passphrase before saving a loaded key", async () => {
    vi.mocked(open).mockResolvedValue("/keys/id_rsa");
    vi.mocked(save).mockImplementation(async (o) => String(o?.defaultPath));
    loadResult = () => ({ ...LOADED, encrypted: false });
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await click("Load…");
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: " new@box " } });
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), { target: { value: "other" } });
    await click("Save private key…");
    expect(screen.getByRole("alert").textContent).toBe("The passphrases do not match.");
    expect(invoke).not.toHaveBeenCalledWith("keygen_update", expect.anything());
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), { target: { value: "new" } });
    await click("Save private key…");
    expect(invoke).toHaveBeenCalledWith("keygen_update", { id: 9, comment: "new@box", passphrase: "new" });
    expect(invoke).toHaveBeenLastCalledWith("keygen_save_private", { id: 9, path: "/keys/id_rsa", overwrite: false });
    expect((screen.getByLabelText("Public key") as HTMLTextAreaElement).value).toBe("ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ new@box");
    expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();

    // Clearing the passphrase removes it.
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Confirm passphrase"), { target: { value: "" } });
    await click("Apply changes");
    expect(invoke).toHaveBeenLastCalledWith("keygen_update", { id: 9, comment: "new@box", passphrase: null });
    expect(screen.getByRole("status").textContent).toBe("Key updated (no passphrase). Save it again to keep the change.");
  });

  it("installs the key on a saved session, asking for its password when none is saved", async () => {
    install = () => "alreadyPresent";
    render(<KeyGenDialog sessions={[web, db]} onClose={() => {}} />);
    await generate();
    fireEvent.change(screen.getByLabelText("Saved session"), { target: { value: "s1" } });
    await click("Install");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    await click("Connect");
    expect(invoke).toHaveBeenCalledWith("keygen_install", {
      id: 7,
      target: {
        type: "ssh",
        host: "web.example",
        port: 22,
        username: "deploy",
        auth: { method: "password", password: "pw" },
      },
      trustedFingerprint: null,
    });
    expect(screen.getByRole("status").textContent).toBe("The key was already installed on web.");
  });

  it("asks to trust an unknown host, then installs", async () => {
    install = (a) => {
      if (!a.trustedFingerprint) throw { kind: "unknownHost", host: "db.example", fingerprint: "SHA256:host", otherKnownKeys: [] };
      return "added";
    };
    render(<KeyGenDialog sessions={[web, db]} onClose={() => {}} />);
    await generate();
    fireEvent.change(screen.getByLabelText("Saved session"), { target: { value: "s2" } });
    await click("Install");
    expect(screen.getByText("SHA256:host")).toBeTruthy();
    await click("Trust and connect");
    expect(invoke).toHaveBeenLastCalledWith("keygen_install", expect.objectContaining({ trustedFingerprint: "SHA256:host" }));
    expect(screen.getByRole("status").textContent).toBe("The key was added to ~/.ssh/authorized_keys on db.");
  });

  it("shows install errors", async () => {
    install = () => {
      throw { kind: "authFailed" };
    };
    render(<KeyGenDialog sessions={[db]} onClose={() => {}} />);
    await generate();
    await click("Install");
    expect(screen.getByRole("alert").textContent).toBe("Authentication failed.");
  });

  it("forgets the generated key when closed", async () => {
    const onClose = vi.fn();
    render(<KeyGenDialog sessions={[web]} onClose={onClose} />);
    await generate();
    await click("Close");
    expect(invoke).toHaveBeenCalledWith("keygen_discard", { id: 7 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
