import type { Platform } from "../platform/usePlatform";
import type { SessionTarget } from "../sessions/types";
import { shellQuote } from "../sftp/remotePath";

/** How a pane's shell reads a quoted path. */
export type ShellFlavor = "posix" | "powershell" | "cmd";

/**
 * The quoting rules of a pane's shell: PowerShell and cmd for local tabs running them (a Windows
 * local tab with an unknown shell runs PowerShell, the default there), POSIX for everything else
 * (bash, zsh, fish, WSL, Git Bash, remote sessions).
 */
export function shellFlavor(platform: Platform, target: SessionTarget["type"], shell: string | null): ShellFlavor {
  if (target !== "local") return "posix";
  const name = shell?.toLowerCase() ?? (platform === "windows" ? "powershell" : null);
  if (name === "cmd") return "cmd";
  if (name === "pwsh" || name === "powershell") return "powershell";
  return "posix";
}

const PLAIN_POWERSHELL = /^[A-Za-z0-9_\-./\\:+@,=]+$/;
const PLAIN_CMD = /^[A-Za-z0-9_\-./\\:+@,=~]+$/;

/**
 * `path` as one word for the shell, or null when it holds control characters: the line editor
 * acts on them (Ctrl-U, newline) even inside quotes, so such a path cannot be typed safely.
 */
export function quotePath(path: string, flavor: ShellFlavor): string | null {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(path)) return null;
  switch (flavor) {
    case "posix":
      return shellQuote(path);
    case "powershell":
      return PLAIN_POWERSHELL.test(path) ? path : `'${path.replace(/'/g, "''")}'`;
    case "cmd":
      // Windows file names cannot contain `"`, so double quotes always suffice.
      return PLAIN_CMD.test(path) ? path : `"${path}"`;
  }
}

/** The command that changes to `path` (cmd needs `/d` to change drive too), or null when unsafe. */
export function cdCommand(path: string, flavor: ShellFlavor): string | null {
  const quoted = quotePath(path, flavor);
  if (quoted === null) return null;
  return flavor === "cmd" ? `cd /d ${quoted}` : `cd ${quoted}`;
}
