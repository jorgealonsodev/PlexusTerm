// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { BRANCH_WATCH_MS, branchSourceOf, useGitBranch, type BranchSource } from "./gitBranch";

afterEach(() => invoke.mockReset());

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const answer = (answers: Record<string, unknown>) =>
  invoke.mockImplementation(async (cmd: string) => (cmd in answers ? answers[cmd] : null));

const local: BranchSource = { kind: "local", sessionId: 3 };
const ssh: BranchSource = { kind: "ssh", sessionId: 8 };

describe("branchSourceOf", () => {
  it("reads local and SSH terminals only, once they are connected", () => {
    expect(branchSourceOf({ type: "local" }, 3)).toEqual(local);
    expect(branchSourceOf({ type: "ssh" } as never, 8)).toEqual(ssh);
    expect(branchSourceOf({ type: "local" }, null)).toBeNull();
    for (const type of ["mosh", "telnet", "serial"]) expect(branchSourceOf({ type } as never, 4)).toBeNull();
  });
});

describe("useGitBranch", () => {
  it("reads the branch of a local folder from the backend", async () => {
    answer({ git_branch: "main" });
    const { result } = renderHook(() => useGitBranch(local, "/home/me/project", 0, true));
    await settle();
    expect(result.current).toBe("main");
    expect(invoke).toHaveBeenCalledWith("git_branch", { path: "/home/me/project" });
  });

  it("reads it again when the folder changes and when the prompt comes back, not otherwise", async () => {
    answer({ git_branch: "main" });
    const { result, rerender } = renderHook(({ cwd, prompt }) => useGitBranch(local, cwd, prompt, true), {
      initialProps: { cwd: "/a", prompt: 0 },
    });
    await settle();
    rerender({ cwd: "/a", prompt: 0 });
    await settle();
    expect(invoke).toHaveBeenCalledTimes(1);
    answer({ git_branch: "feature" });
    rerender({ cwd: "/a", prompt: 1 });
    await settle();
    expect(result.current).toBe("feature");
    answer({ git_branch: null });
    rerender({ cwd: "/b", prompt: 1 });
    await settle();
    expect(result.current).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("asks the shell for its folder when it does not report one (OSC 7)", async () => {
    answer({ pty_cwd: "/srv/app", git_branch: "release" });
    const { result } = renderHook(() => useGitBranch(local, null, 0, true));
    await settle();
    expect(invoke).toHaveBeenCalledWith("pty_cwd", { id: 3 });
    expect(invoke).toHaveBeenCalledWith("git_branch", { path: "/srv/app" });
    expect(result.current).toBe("release");
  });

  it("runs git over the SSH session for remote folders, asking the server for the folder when needed", async () => {
    answer({ ssh_shell_cwd: "/var/www", ssh_git_branch: "prod" });
    const { result } = renderHook(() => useGitBranch(ssh, null, 0, true));
    await settle();
    expect(invoke).toHaveBeenCalledWith("ssh_shell_cwd", { id: 8 });
    expect(invoke).toHaveBeenCalledWith("ssh_git_branch", { id: 8, path: "/var/www" });
    expect(result.current).toBe("prod");
  });

  it("shows nothing when turned off, without a source, or when reading fails", async () => {
    answer({ git_branch: "main" });
    const off = renderHook(() => useGitBranch(local, "/a", 0, false));
    const none = renderHook(() => useGitBranch(null, "/a", 0, true));
    await settle();
    expect(off.result.current).toBeNull();
    expect(none.result.current).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValue(new Error("gone"));
    const failing = renderHook(() => useGitBranch(local, "/a", 0, true));
    await settle();
    expect(failing.result.current).toBeNull();
  });

  it("ignores an answer for a folder the terminal has already left", async () => {
    let finish: (branch: string) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { result, rerender } = renderHook(({ cwd }) => useGitBranch(local, cwd, 0, true), {
      initialProps: { cwd: "/old" },
    });
    invoke.mockResolvedValueOnce(null);
    rerender({ cwd: "/new" });
    await settle();
    await act(async () => finish("stale"));
    expect(result.current).toBeNull();
  });

  it("follows a running CLI's folder and branch while watching: a worktree or a switched branch shows at once", async () => {
    vi.useFakeTimers();
    try {
      const branches: Record<string, string> = { "/repo": "main", "/repo-wt": "feature" };
      let program = "/repo";
      invoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "pty_program_cwd") return program;
        if (cmd === "git_branch") return branches[(args as { path: string }).path] ?? null;
        return null;
      });
      const { result, rerender } = renderHook(({ watch }) => useGitBranch(local, "/repo", 0, true, watch), {
        initialProps: { watch: false },
      });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(result.current).toBe("main");
      // Not watching: nothing is read again.
      program = "/repo-wt";
      await act(() => vi.advanceTimersByTimeAsync(BRANCH_WATCH_MS.local * 3));
      expect(result.current).toBe("main");
      rerender({ watch: true });
      await act(() => vi.advanceTimersByTimeAsync(BRANCH_WATCH_MS.local));
      expect(result.current).toBe("feature");
      branches["/repo-wt"] = "other";
      await act(() => vi.advanceTimersByTimeAsync(BRANCH_WATCH_MS.local));
      expect(result.current).toBe("other");
    } finally {
      vi.useRealTimers();
    }
  });

  it("watches an SSH terminal less often, through its session", async () => {
    vi.useFakeTimers();
    try {
      invoke.mockImplementation(async (cmd: string) => (cmd === "ssh_shell_cwd" ? "/srv/wt" : cmd === "ssh_git_branch" ? "hotfix" : null));
      const { result } = renderHook(() => useGitBranch(ssh, "/srv/app", 0, true, true));
      await act(() => vi.advanceTimersByTimeAsync(0));
      await act(() => vi.advanceTimersByTimeAsync(BRANCH_WATCH_MS.ssh));
      expect(result.current).toBe("hotfix");
      expect(invoke).toHaveBeenCalledWith("ssh_git_branch", { id: 8, path: "/srv/wt" });
      expect(BRANCH_WATCH_MS.ssh).toBeGreaterThan(BRANCH_WATCH_MS.local);
    } finally {
      vi.useRealTimers();
    }
  });
});
