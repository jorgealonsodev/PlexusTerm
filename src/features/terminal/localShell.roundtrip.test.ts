import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseLibrary, serializeLibrary, toTarget, type SavedLocalSession } from "../sessions/library";
import { formFromSession, parseSessionForm } from "../sessions/sessionForm";
import type { SessionTarget } from "../sessions/types";
import { backendFor } from "./backend";
import { joinArgs, splitArgs } from "./localShell";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: unknown = null;
  },
}));
beforeEach(() => invoke.mockReset());

/** Arguments a saved local session may hold: empty, quoted, Windows paths, non-Latin text, both quote kinds. */
const ODD = [
  [""],
  ["", "-l", ""],
  ["-Command", "Set-Location 'C:\\My Files'"],
  ["-c", 'echo "hi"'],
  ["C:\\Program Files\\x\\", "\\\\server\\share"],
  ["ñandú", "日本語", "🙂 emoji"],
  ["tab\there", "new\nline"],
  ["-c", `echo "it's"`],
  [`a'b"c`],
];

describe("local session arguments", () => {
  it.each(ODD.map((args) => [args]))("%j survive joinArgs then splitArgs", (args) => {
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });

  it.each(ODD.map((args) => [args]))("%j survive editing the session and the sessions file", (args) => {
    const saved: SavedLocalSession = {
      kind: "local",
      id: "x",
      name: "n",
      folder: "F",
      program: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      args,
      cwd: "C:\\Users\\ñ\\proj",
    };
    expect(parseSessionForm(formFromSession(saved), "x", { sessions: [] })).toEqual({ ok: true, session: saved });
    const library = { version: 1 as const, folders: ["F"], sessions: [saved] };
    expect(parseLibrary(serializeLibrary(library))).toEqual({ ok: true, library });
  });

  it("never sends an environment to pty_spawn, from a tab or a saved session", async () => {
    invoke.mockResolvedValue(1);
    const target = { type: "local", program: "bash", env: { S: "x" } } as unknown as SessionTarget;
    await backendFor(target).start({ cols: 80, rows: 24 }, () => {});
    expect(Object.keys(invoke.mock.calls[0][1].request).sort()).toEqual(["cols", "program", "rows"]);
    invoke.mockReset();
    invoke.mockResolvedValue(1);
    const saved = { kind: "local", id: "s", name: "s", folder: "", program: "zsh", env: { A: "b" } } as unknown as SavedLocalSession;
    await backendFor(toTarget(saved)).start({ cols: 80, rows: 24 }, () => {});
    expect(invoke.mock.calls[0][1].request).not.toHaveProperty("env");
  });
});
