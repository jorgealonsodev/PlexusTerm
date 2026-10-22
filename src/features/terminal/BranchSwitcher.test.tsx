// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { BranchSwitcher } from "./BranchSwitcher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

/** The backend: the program's folder is /work/app, with these branches; `git_switch` as given. */
function backend(branches: { local: string[]; remote: string[] }, switchResult: () => Promise<unknown> = async () => null) {
  mockedInvoke.mockImplementation(async (command: string) => {
    if (command === "pty_program_cwd") return "/work/app";
    if (command === "git_branches") return branches;
    if (command === "git_switch") return switchResult();
    return null;
  });
}

const renderSwitcher = () => {
  const onSwitched = vi.fn();
  const onNotice = vi.fn();
  render(<BranchSwitcher branch="main" ptyId={3} cwd="/work" onSwitched={onSwitched} onNotice={onNotice} />);
  return { onSwitched, onNotice };
};

beforeEach(() => mockedInvoke.mockReset());
afterEach(cleanup);

describe("BranchSwitcher", () => {
  it("lists the other branches, local first, and switches the terminal's folder to the one chosen", async () => {
    backend({ local: ["feat/log", "main"], remote: ["release"] });
    const { onSwitched, onNotice } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "main" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["feat/log", "release (remote)"]);
    expect(mockedInvoke).toHaveBeenCalledWith("git_branches", { path: "/work/app" });

    fireEvent.click(screen.getByRole("menuitem", { name: "feat/log" }));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("feat/log"));
    expect(mockedInvoke).toHaveBeenCalledWith("git_switch", { path: "/work/app", branch: "feat/log" });
    expect(onNotice).toHaveBeenCalledWith("Switched to feat/log.");
  });

  it("keeps the branch and shows git's reason when the switch is refused", async () => {
    backend({ local: ["main", "topic"], remote: [] }, () => Promise.reject("your local changes would be overwritten"));
    const { onSwitched, onNotice } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "main" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "topic" }));
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith("Could not switch to topic: your local changes would be overwritten"),
    );
    expect(onSwitched).not.toHaveBeenCalled();
  });

  it("says so when there is no other branch", async () => {
    backend({ local: ["main"], remote: [] });
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "main" }));
    const item = await screen.findByRole("menuitem", { name: "No other branches" });
    expect(item.hasAttribute("disabled") || item.getAttribute("aria-disabled") === "true").toBe(true);
  });
});
