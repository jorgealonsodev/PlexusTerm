// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "../../terminal/clipboard";
import type { SavedSession } from "../../sessions/library";
import { KeyGenDialog } from "./KeyGenDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../terminal/clipboard", () => ({ writeText: vi.fn(async () => undefined), readText: vi.fn() }));

const PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKey me@laptop";
const GENERATED = { id: 7, publicKey: PUBLIC, fingerprint: "SHA256:abc" };

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

beforeEach(() => {
  install = () => "added";
  saveResult = () => undefined;
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "keygen_generate") return GENERATED;
    if (cmd === "keygen_save") return saveResult(a);
    if (cmd === "keygen_install") return install(a);
    if (cmd === "secret_exists") return false;
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(save).mockReset();
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
    expect(invoke).toHaveBeenCalledWith("keygen_generate", { passphrase: "secret words", comment: "me@laptop" });
    const textarea = screen.getByLabelText("Public key") as HTMLTextAreaElement;
    expect(textarea.value).toBe(PUBLIC);
    expect(textarea.readOnly).toBe(true);
    expect(screen.getByText("SHA256:abc")).toBeTruthy();
    await click("Copy");
    expect(writeText).toHaveBeenCalledWith(PUBLIC);
    expect(screen.getByRole("status").textContent).toBe("Public key copied to the clipboard.");
  });

  it("saves the key pair and asks before overwriting existing files", async () => {
    vi.mocked(save).mockResolvedValue("/home/me/.ssh/id_new");
    saveResult = (a) => {
      if (!a.overwrite) throw { kind: "exists", path: "/home/me/.ssh/id_new" };
    };
    render(<KeyGenDialog sessions={[web]} onClose={() => {}} />);
    await generate();
    await click("Save…");
    expect(invoke).toHaveBeenCalledWith("keygen_save", { id: 7, path: "/home/me/.ssh/id_new", overwrite: false });
    expect(screen.getByRole("alert").textContent).toBe("/home/me/.ssh/id_new already exists. Overwrite it?");
    await click("Overwrite");
    expect(invoke).toHaveBeenCalledWith("keygen_save", { id: 7, path: "/home/me/.ssh/id_new", overwrite: true });
    expect(screen.getByRole("status").textContent).toBe(
      "Saved the private key to /home/me/.ssh/id_new and the public key to /home/me/.ssh/id_new.pub.",
    );
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
