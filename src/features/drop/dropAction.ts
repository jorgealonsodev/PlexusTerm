import { cdCommand, quotePath, type ShellFlavor } from "../terminal/shellPath";
import type { SessionTarget } from "../sessions/types";
import type { DraggedPath, PathOrigin } from "./pathDrag";

/** What a drop on a terminal does: run `cd` (sent with Enter) or type text at the cursor. */
export type DropAction = { kind: "run"; command: string } | { kind: "type"; text: string } | { kind: "unsafe" };

export interface DropContext {
  /** Nothing is typed on the command line (and the shell is not in a full-screen program). */
  lineEmpty: boolean;
  /** The paths are on the machine the terminal runs on (so `cd` can reach them). */
  sameMachine: boolean;
  flavor: ShellFlavor;
}

/**
 * S4: one folder dropped on an empty command line of its own machine changes to it; anything
 * else types the quoted paths, separated and followed by a space. Paths with control characters
 * are never typed.
 */
export function dropAction(paths: DraggedPath[], ctx: DropContext): DropAction {
  if (paths.length === 0) return { kind: "unsafe" };
  // fish reads `\'` as an escape even inside single quotes, so a POSIX path with a backslash
  // cannot be quoted for every shell: it is typed, never sent with Enter.
  const runnable = ctx.flavor !== "posix" || !paths[0].path.includes("\\");
  if (paths.length === 1 && paths[0].isDir && ctx.lineEmpty && ctx.sameMachine && runnable) {
    const command = cdCommand(paths[0].path, ctx.flavor);
    return command === null ? { kind: "unsafe" } : { kind: "run", command };
  }
  const quoted = paths.map((p) => quotePath(p.path, ctx.flavor));
  if (quoted.some((q) => q === null)) return { kind: "unsafe" };
  return { kind: "type", text: `${quoted.join(" ")} ` };
}

/**
 * Whether `cd` in a pane can reach dragged paths: local paths in a local terminal, SFTP paths in
 * the SSH pane of that same session (L4).
 */
export function sameMachine(origin: PathOrigin, target: SessionTarget["type"], paneSessionId: number | null): boolean {
  return origin.kind === "local" ? target === "local" : target === "ssh" && paneSessionId === origin.sessionId;
}
