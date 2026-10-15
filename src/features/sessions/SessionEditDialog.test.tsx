// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { SavedSession } from "./library";
import { SessionEditDialog } from "./SessionEditDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

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

  it("shows jump hosts that no longer exist so they can be removed", async () => {
    mockedInvoke.mockResolvedValue(false);
    const onSave = renderWithJumps({ ...web, jumpIds: ["gone", "a"] });
    expect(screen.getByText("(deleted session)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove (deleted session)"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ jumpIds: ["a"] }));
  });
});
