import type { Platform } from "../platform/usePlatform";
import type { SessionTarget } from "../sessions/types";

/**
 * Keys that empty the shell's input line before a command is sent as typed.
 *
 * Local shells on Windows (PowerShell with PSReadLine in Windows mode, cmd) ignore the
 * Emacs keys and would keep them as text in the line, so they get Ctrl+End (delete to the
 * end) then Ctrl+Home (delete to the start). Everything else, remote sessions included,
 * gets Ctrl+E then Ctrl+U as bash and zsh understand them.
 */
export function clearLineKeys(platform: Platform, target: SessionTarget["type"]): string {
  if (platform === "windows" && target === "local") return "\x1b[1;5F\x1b[1;5H";
  return "\x05\x15";
}
