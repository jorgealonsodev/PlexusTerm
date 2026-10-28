// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { LibrarySession, SavedSession } from "./library";
import { PlatformContext } from "../platform/usePlatform";
import { SessionEditDialog } from "./SessionEditDialog";
import { ShellsContext } from "../platform/useShells";
import { open } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const web: SavedSession = {
  kind: "ssh",
  id: "s1",
  name: "web",
  folder: "",
  host: "10.0.0.1",
  port: 22,
  username: "u",
  auth: { method: "password" },
};

const FORGET = "Forget saved password";

function renderDialog(session: SavedSession, isNew = false) {
  render(<SessionEditDialog session={session} isNew={isNew} folders={[]} onSave={() => {}} onCancel={() => {}} />);
}

/** Lets the dialog's keyring query settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

beforeEach(() => mockedInvoke.mockReset());
afterEach(cleanup);

describe("SessionEditDialog saved password", () => {
  it("offers to forget a saved password and deletes it from the keyring", async () => {
    mockedInvoke.mockImplementation(async (command: string) => (command === "secret_exists" ? true : undefined));
    renderDialog(web);
    fireEvent.click(await screen.findByText(FORGET));
    expect(mockedInvoke).toHaveBeenCalledWith("secret_exists", { sessionId: "s1" });
    expect(mockedInvoke).toHaveBeenCalledWith("secret_delete", { sessionId: "s1" });
    await screen.findByText("Saved password forgotten.");
    expect(screen.queryByText(FORGET)).toBeNull();
  });

  it("shows why forgetting failed", async () => {
    mockedInvoke.mockResolvedValueOnce(true); // secret_exists
    mockedInvoke.mockRejectedValueOnce({ kind: "keyring", message: "the keyring is locked" }); // secret_delete
    renderDialog(web);
    fireEvent.click(await screen.findByText(FORGET));
    await screen.findByText(/the keyring is locked/);
  });

  it("does not offer it when nothing is saved", async () => {
    mockedInvoke.mockResolvedValue(false);
    renderDialog(web);
    await settle();
    expect(screen.queryByText(FORGET)).toBeNull();
  });

  it("does not query the keyring for a new session", async () => {
    renderDialog(web, true);
    await settle();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("SessionEditDialog jump hosts", () => {
  const gw = (id: string, name: string): SavedSession => ({ ...web, id, name, auth: { method: "agent" } });
  const candidates = [web, gw("a", "alpha"), gw("b", "beta"), gw("c", "gamma"), gw("d", "delta")];

  function renderWithJumps(session: SavedSession) {
    const onSave = vi.fn();
    render(
      <SessionEditDialog
        session={session}
        isNew={false}
        folders={[]}
        jumpCandidates={candidates}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    return onSave;
  }

  const add = (name: string) => {
    fireEvent.change(screen.getByLabelText("Add jump host"), {
      target: { value: candidates.find((c) => c.name === name)!.id },
    });
    fireEvent.click(screen.getByText("Add"));
  };

  it("adds, reorders and removes jump hosts, and saves them in order", async () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderWithJumps(web);
    // The session itself is not offered.
    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Add jump host").options).map((o) => o.text);
    expect(options).not.toContain("web");
    add("alpha");
    add("beta");
    add("gamma");
    fireEvent.click(screen.getByLabelText("Move gamma up"));
    fireEvent.click(screen.getByLabelText("Remove alpha"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ jumpIds: ["c", "b"] }));
  });

  it("offers at most 3 jump hosts", async () => {
    mockedInvoke.mockResolvedValue(false);
    renderWithJumps({ ...web, jumpIds: ["a", "b", "c"] });
    expect(screen.getByLabelText<HTMLSelectElement>("Add jump host").disabled).toBe(true);
    expect(screen.getByText("Add").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByLabelText("Move alpha down"));
    expect(screen.getAllByRole("listitem").map((li) => li.querySelector(".jump-hosts__name")?.textContent)).toEqual([
      "beta",
      "alpha",
      "gamma",
    ]);
  });

  it("refuses to save jump hosts together with a proxy command", async () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderWithJumps({ ...web, jumpIds: ["a"] });
    fireEvent.change(screen.getByLabelText(/Proxy command/), { target: { value: "nc %h %p" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Use either jump hosts or a proxy command, not both");
    fireEvent.click(screen.getByLabelText("Remove alpha"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ proxyCommand: "nc %h %p" }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty("jumpIds");
  });

  it("shows jump hosts that no longer exist so they can be removed", async () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderWithJumps({ ...web, jumpIds: ["gone", "a"] });
    expect(screen.getByText("(deleted session)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove (deleted session)"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ jumpIds: ["a"] }));
  });
});

describe("SessionEditDialog Telnet and Mosh (S17.3)", () => {
  function renderKinds(session: LibrarySession, isNew: boolean) {
    const onSave = vi.fn();
    render(
      <SessionEditDialog
        session={session}
        isNew={isNew}
        folders={[]}
        jumpCandidates={[web]}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    return onSave;
  }

  it("offers every session type", () => {
    renderKinds(web, true);
    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Session type").options).map((o) => o.text);
    expect(options).toEqual(["SSH", "Serial", "Telnet", "Mosh", "Local terminal"]);
  });

  it("does not offer Mosh on Windows, except to keep an existing Mosh session (S18.3)", () => {
    const kinds = () =>
      Array.from(screen.getByLabelText<HTMLSelectElement>("Session type").options).map((o) => o.text);
    const renderOn = (session: LibrarySession, isNew: boolean) =>
      render(
        <PlatformContext.Provider value="windows">
          <SessionEditDialog session={session} isNew={isNew} folders={[]} jumpCandidates={[web]} onSave={vi.fn()} onCancel={() => {}} />
        </PlatformContext.Provider>,
      );
    renderOn(web, true);
    expect(kinds()).toEqual(["SSH", "Serial", "Telnet", "Local terminal"]);
    cleanup();
    renderOn({ kind: "mosh", id: "m", name: "m", folder: "", sshSessionId: "s1" }, false);
    expect(kinds()).toEqual(["SSH", "Serial", "Telnet", "Mosh", "Local terminal"]);
  });

  it("saves a Telnet session", () => {
    const onSave = renderKinds({ ...web, id: "new" }, true);
    fireEvent.change(screen.getByLabelText("Session type"), { target: { value: "telnet" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "switch" } });
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "switch.lan" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ kind: "telnet", id: "new", name: "switch", folder: "", host: "switch.lan", port: 23 });
  });

  it("saves a Mosh session over a saved SSH session", () => {
    const onSave = renderKinds({ ...web, id: "new" }, true);
    fireEvent.change(screen.getByLabelText("Session type"), { target: { value: "mosh" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("SSH session"), { target: { value: "s1" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ kind: "mosh", id: "new", name: "web (mosh)", folder: "", sshSessionId: "s1" });
  });

  it("never queries the keyring for Telnet or Mosh sessions", async () => {
    renderKinds({ kind: "telnet", id: "t", name: "t", folder: "", host: "h", port: 23 }, false);
    cleanup();
    renderKinds({ kind: "mosh", id: "m", name: "m", folder: "", sshSessionId: "s1" }, false);
    await settle();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});

describe("SessionEditDialog local terminal (local shells S4)", () => {
  it("saves a local session with its shell, arguments and starting directory", () => {
    const onSave = vi.fn();
    render(
      <ShellsContext.Provider value={{ default: { name: "bash", program: "/bin/bash" }, available: [{ name: "zsh", program: "/usr/bin/zsh" }] }}>
        <SessionEditDialog session={{ ...web, id: "new" }} isNew folders={[]} onSave={onSave} onCancel={() => {}} />
      </ShellsContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText("Session type"), { target: { value: "local" } });
    expect(screen.queryByLabelText("Host")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Shell"), { target: { value: "/usr/bin/zsh" } });
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: "-l" } });
    fireEvent.change(screen.getByLabelText("Starting directory"), { target: { value: "~/src" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ kind: "local", id: "new", name: "Dev", folder: "", program: "/usr/bin/zsh", args: ["-l"], cwd: "~/src" });
  });

  it("chooses the starting directory with Browse…", async () => {
    vi.mocked(open).mockResolvedValueOnce("/home/me/projects");
    render(<SessionEditDialog session={{ kind: "local", id: "l", name: "Dev", folder: "" }} isNew={false} folders={[]} onSave={vi.fn()} onCancel={() => {}} />);
    expect((screen.getByLabelText("Session type") as HTMLSelectElement).value).toBe("local");
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await act(() => Promise.resolve());
    expect((screen.getByLabelText("Starting directory") as HTMLInputElement).value).toBe("/home/me/projects");
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
  });
});

describe("SessionEditDialog SSH options", () => {
  function renderSaving(session: SavedSession) {
    const onSave = vi.fn();
    render(<SessionEditDialog session={session} isNew={false} folders={[]} onSave={onSave} onCancel={() => {}} />);
    return onSave;
  }

  it("saves agent forwarding and the tmux session ticked in the dialog", () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderSaving(web);
    expect(screen.queryByLabelText("tmux session name")).toBeNull();
    fireEvent.click(screen.getByLabelText("Forward SSH agent"));
    fireEvent.click(screen.getByLabelText("Keep the shell in tmux"));
    expect(screen.getByLabelText<HTMLInputElement>("tmux session name").value).toBe("plexus");
    fireEvent.change(screen.getByLabelText("tmux session name"), { target: { value: "work" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ forwardAgent: true, tmuxSession: "work" }));
  });

  it("shows the options of a saved session and saves them off when unticked", () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderSaving({ ...web, forwardAgent: true, tmuxSession: "work" });
    expect(screen.getByLabelText<HTMLInputElement>("Forward SSH agent").checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("tmux session name").value).toBe("work");
    fireEvent.click(screen.getByLabelText("Forward SSH agent"));
    fireEvent.click(screen.getByLabelText("Keep the shell in tmux"));
    fireEvent.click(screen.getByText("Save"));
    const saved = onSave.mock.calls[0][0];
    expect(saved).not.toHaveProperty("forwardAgent");
    expect(saved).not.toHaveProperty("tmuxSession");
  });

  it("refuses an invalid tmux session name with a field error", () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderSaving(web);
    fireEvent.click(screen.getByLabelText("Keep the shell in tmux"));
    fireEvent.change(screen.getByLabelText("tmux session name"), { target: { value: "my work" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "The tmux session name may only use letters, digits, dots, underscores and dashes (64 at most)",
    );
  });
});
