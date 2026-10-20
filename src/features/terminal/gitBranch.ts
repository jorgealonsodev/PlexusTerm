import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { local } from "../local/localClient";
import { sftp } from "../sftp/sftpClient";
import type { SessionTarget } from "../sessions/types";

/**
 * Where a pane's git branch is read: a local terminal's folder on this computer, or an SSH
 * terminal's folder on its server (one `git` command over the session's connection). Mosh,
 * Telnet and serial terminals have no channel to ask through.
 */
export type BranchSource = { kind: "local" | "ssh"; sessionId: number };

export function branchSourceOf(target: Pick<SessionTarget, "type">, sessionId: number | null): BranchSource | null {
  if (sessionId === null) return null;
  if (target.type === "local" || target.type === "ssh") return { kind: target.type, sessionId };
  return null;
}

/** The folder of the source's shell when it does not report it through OSC 7. */
const folderOf = (source: BranchSource) =>
  source.kind === "local" ? local.shellCwd(source.sessionId) : sftp.shellCwd(source.sessionId);

const branchAt = (source: BranchSource, path: string) =>
  source.kind === "local"
    ? invoke<string | null>("git_branch", { path })
    : invoke<string | null>("ssh_git_branch", { id: source.sessionId, path });

/**
 * How often a watched pane is read again: locally a link and a file are read; over SSH each read
 * runs commands on the server, so less often.
 */
export const BRANCH_WATCH_MS = { local: 1500, ssh: 5000 } as const;

/** The folder of the program running in the pane (a CLI that moved to a worktree), else of its shell. */
const programFolderOf = (source: BranchSource) =>
  source.kind === "local" ? local.programCwd(source.sessionId) : sftp.shellCwd(source.sessionId);

/**
 * The git branch of a pane's folder (the short commit when detached), or null outside a
 * repository. Read when the folder changes and each time `prompt` changes (the shell's prompt came
 * back, so a command may have switched branches). While `watch` (a CLI runs, so the prompt does not
 * come back) it is also read every BRANCH_WATCH_MS, in the folder of the running program: a branch
 * switched or a worktree entered by the CLI shows at once.
 */
export function useGitBranch(
  source: BranchSource | null,
  cwd: string | null,
  prompt: number,
  enabled: boolean,
  watch = false,
): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  const kind = source?.kind ?? null;
  const sessionId = source?.sessionId ?? null;
  useEffect(() => {
    if (!enabled || kind === null || sessionId === null) {
      setBranch(null);
      return;
    }
    const from: BranchSource = { kind, sessionId };
    let live = true;
    void (async () => {
      const folder = cwd ?? (await folderOf(from));
      const found = folder ? await branchAt(from, folder) : null;
      if (live) setBranch(found ?? null);
    })().catch(() => live && setBranch(null));
    return () => {
      live = false;
    };
  }, [kind, sessionId, cwd, prompt, enabled]);

  useEffect(() => {
    if (!enabled || !watch || kind === null || sessionId === null) return;
    const from: BranchSource = { kind, sessionId };
    let live = true;
    let reading = false;
    const timer = setInterval(() => {
      // One read at a time, and none while the window is hidden.
      if (reading || document.hidden) return;
      reading = true;
      void (async () => {
        const folder = (await programFolderOf(from)) ?? cwd;
        const found = folder ? await branchAt(from, folder) : null;
        if (live) setBranch(found ?? null);
      })()
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    }, BRANCH_WATCH_MS[kind]);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [kind, sessionId, cwd, enabled, watch]);
  return enabled ? branch : null;
}

/** Reads a pane's branch with `useGitBranch` and reports each change; renders nothing. */
export function GitBranchReporter({
  source,
  cwd,
  prompt,
  enabled,
  watch = false,
  onBranch,
}: {
  source: BranchSource | null;
  cwd: string | null;
  prompt: number;
  enabled: boolean;
  watch?: boolean;
  onBranch: (branch: string | null) => void;
}): null {
  const branch = useGitBranch(source, cwd, prompt, enabled, watch);
  const report = useRef(onBranch);
  report.current = onBranch;
  useEffect(() => report.current(branch), [branch]);
  return null;
}
