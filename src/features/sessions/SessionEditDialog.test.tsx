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
