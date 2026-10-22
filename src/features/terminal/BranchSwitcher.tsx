import { useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { local } from "../local/localClient";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";

interface Branches {
  local: string[];
  remote: string[];
}

/**
 * The folder whose repository a local terminal is in: the running program's (a CLI that moved to a
 * worktree), else the one its shell reported (OSC 7), else its shell's.
 */
async function folderOf(ptyId: number, cwd: string | null): Promise<string | null> {
  return (await local.programCwd(ptyId).catch(() => null)) ?? cwd ?? (await local.shellCwd(ptyId).catch(() => null));
}

/**
 * The branch in the bar under a local DEV mode terminal: clicking it lists the repository's other
 * branches, and choosing one runs `git switch` in the terminal's folder (nothing is typed into it).
 */
export function BranchSwitcher({
  branch,
  ptyId,
  cwd,
  onSwitched,
  onNotice,
}: {
  branch: string;
  ptyId: number;
  cwd: string | null;
  onSwitched: (branch: string) => void;
  onNotice: (text: string) => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const switchTo = async (folder: string, to: string) => {
    try {
      await invoke("git_switch", { path: folder, branch: to });
      onSwitched(to);
      onNotice(t("app.tabs.branchSwitched", { branch: to }));
    } catch (error) {
      onNotice(t("app.tabs.branchSwitchFailed", { branch: to, error: String(error) }));
    }
  };

  const open = async (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const folder = await folderOf(ptyId, cwd);
    const branches = folder ? await invoke<Branches>("git_branches", { path: folder }).catch(() => null) : null;
    const others = (names: string[]) => names.filter((name) => name !== branch);
    const items: ContextMenuItem[] = [
      ...others(branches?.local ?? []).map((name) => ({ label: name, onSelect: () => void switchTo(folder!, name) })),
      ...(branches && others(branches.local).length > 0 && branches.remote.length > 0 ? [{ separator: true as const }] : []),
      ...others(branches?.remote ?? []).map((name) => ({
        label: t("app.tabs.branchRemote", { branch: name }),
        onSelect: () => void switchTo(folder!, name),
      })),
    ];
    setMenu({
      x: rect.left,
      y: rect.top,
      items: items.length > 0 ? items : [{ label: t("app.tabs.noOtherBranches"), onSelect: () => {}, disabled: true }],
    });
  };

  return (
    <>
      <button
        type="button"
        className="pane-footer__branch pane-footer__branch--button"
        dir="auto"
        title={t("app.tabs.switchBranch", { branch })}
        aria-haspopup="menu"
        // Keep the keyboard focus in the terminal.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => void open(e)}
      >
        <GitBranch size={13} aria-hidden="true" />
        <span className="pane-footer__branch-name">{branch}</span>
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}
