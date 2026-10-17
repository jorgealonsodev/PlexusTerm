import type { Shells } from "../platform/useShells";
import type { LocalTarget, SessionTarget } from "../sessions/types";
import type { TerminalSettings } from "../settings/settings";

/**
 * Splits typed arguments on spaces like a shell: single or double quotes keep spaces in one
 * argument (and are removed); backslashes are kept, so Windows paths need no escaping.
 */
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/** The file name of a program without its directory or a `.exe` extension (like the backend's). */
export function shellNameOf(program: string): string {
  const file = program.trim().split(/[/\\]/).pop() ?? "";
  return /\.exe$/i.test(file) ? file.slice(0, -4) : file;
}

/** The target of a new local terminal: the shell chosen in Settings, or the system default. */
export function localTargetOf(settings: Pick<TerminalSettings, "localShell" | "localShellArgs">): LocalTarget {
  const program = settings.localShell.trim();
  if (!program) return { type: "local" };
  const args = splitArgs(settings.localShellArgs);
  return { type: "local", program, ...(args.length ? { args } : {}) };
}

/** The name of the shell a tab runs: its own, or the default one; null when unknown or remote. */
export function runningShellOf(target: SessionTarget, shells: Shells | null): string | null {
  if (target.type !== "local") return null;
  if (target.program?.trim()) return shellNameOf(target.program);
  return shells?.default.name ?? null;
}
