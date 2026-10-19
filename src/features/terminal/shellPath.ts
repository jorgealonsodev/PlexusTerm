import type { Platform } from "../platform/usePlatform";
import type { SessionTarget } from "../sessions/types";
import { shellQuote } from "../sftp/remotePath";

/** How a pane's shell reads a quoted path. */
export type ShellFlavor = "posix" | "powershell" | "cmd" | "gitbash";

/**
 * The quoting rules of a pane's shell: PowerShell and cmd for local tabs running them (a Windows
 * local tab with an unknown shell runs PowerShell, the default there), Git Bash for bash on Windows
 * (POSIX, with Windows paths in its `/c/...` form), POSIX for everything else (bash, zsh, fish,
 * WSL, remote sessions).
 */
export function shellFlavor(platform: Platform, target: SessionTarget["type"], shell: string | null): ShellFlavor {
  if (target !== "local") return "posix";
  const name = shell?.toLowerCase() ?? (platform === "windows" ? "powershell" : null);
  if (name === "cmd") return "cmd";
  if (name === "pwsh" || name === "powershell") return "powershell";
  if (name === "bash" && platform === "windows") return "gitbash";
  return "posix";
}

// `,` builds an array and `@` a splat in PowerShell's argument mode: both are quoted.
const PLAIN_POWERSHELL = /^[A-Za-z0-9_\-./\\:+=]+$/;
/** PowerShell reads the typographic quotes U+2018..U+201B as single quotes too. */
const POWERSHELL_QUOTES = /['\u2018-\u201B]/g;
/** Wildcards PowerShell expands in a path unless it is given with -LiteralPath. */
const POWERSHELL_WILDCARDS = /[[\]*?]/;
const PLAIN_CMD = /^[A-Za-z0-9_\-./\\:+@,=~]+$/;

/** How Git Bash names a Windows path: `C:\\Users` is `/c/Users`, `\\\\server\\share` is `//server/share`. */
export function gitBashPath(path: string): string {
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(path);
  if (drive) return `/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
  return path.replace(/\\/g, "/");
}

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
    case "gitbash":
      return shellQuote(gitBashPath(path));
    case "powershell":
      return PLAIN_POWERSHELL.test(path) ? path : `'${path.replace(POWERSHELL_QUOTES, "$&$&")}'`;
    case "cmd":
      // Windows file names cannot contain `"`, so double quotes always suffice.
      return PLAIN_CMD.test(path) ? path : `"${path}"`;
  }
}

/** The command that changes to `path` (cmd needs `/d` to change drive too), or null when unsafe. */
export function cdCommand(path: string, flavor: ShellFlavor): string | null {
  const quoted = quotePath(path, flavor);
  if (quoted === null) return null;
  if (flavor === "cmd") return `cd /d ${quoted}`;
  if (flavor === "powershell" && POWERSHELL_WILDCARDS.test(path)) return `cd -LiteralPath ${quoted}`;
  return `cd ${quoted}`;
}
