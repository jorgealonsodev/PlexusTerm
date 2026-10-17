import type { Platform } from "../platform/usePlatform";
import type { SessionTarget } from "../sessions/types";

/** Windows shells that ignore the Emacs line-editing keys. */
const WINDOWS_SHELLS = ["pwsh", "powershell", "cmd"];

/**
 * Keys that empty the shell's input line before a command is sent as typed.
 *
 * PowerShell (PSReadLine in Windows mode) and cmd on Windows ignore the Emacs keys and would
 * keep them as text in the line, so they get Ctrl+End (delete to the end) then Ctrl+Home
 * (delete to the start). `shell` names the local tab's shell; when it is unknown, a Windows
 * local tab is taken to run one of them. Everything else (bash, WSL, PowerShell on Linux and
 * macOS, remote sessions) gets Ctrl+E then Ctrl+U as readline and Emacs mode understand them.
 */
export function clearLineKeys(platform: Platform, target: SessionTarget["type"], shell: string | null = null): string {
  const windowsShell = shell === null || WINDOWS_SHELLS.includes(shell.toLowerCase());
  if (platform === "windows" && target === "local" && windowsShell) return "\x1b[1;5F\x1b[1;5H";
  return "\x05\x15";
}
