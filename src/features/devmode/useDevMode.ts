import { useCallback, useMemo, useRef, useState } from "react";
import { cliOfCommand, cliOfTitle, devReducer, titleKeepsCli, withDefaultCommands, type DevAction, type DevState } from "./devMode";

/** Where a tab's DEV mode anchors the Explorer: the folder its pane is in and that folder's project root. */
export type LocateProject = (tab: string, pane: string) => Promise<{ folder: string; root: string } | null>;

/**
 * The DEV mode of every tab (S10), with the project folder looked up each time a tab turns on.
 * `locate` may change between renders; the latest one is used.
 */
export function useDevMode(locate: LocateProject) {
  const [state, setState] = useState<DevState>({});
  const current = useRef<DevState>(state);
  const nextId = useRef(1);
  /** Whether each pane's last title named a CLI: only a new CLI title turns DEV mode on. */
  const titledCli = useRef(new Map<string, boolean>());
  /**
   * The CLI running in each pane, as its command or title first named it (default CLIs included),
   * until the shell is back: replayed for a DEV mode turned on later by hand.
   */
  const runningCli = useRef(new Map<string, { cli: string; seen: Extract<DevAction, { type: "command" | "title" }> }>());
  const locateRef = useRef(locate);
  locateRef.current = locate;

  const apply = useCallback((action: DevAction) => {
    const before = current.current;
    const next = devReducer(before, action);
    if (next === before) return;
    current.current = next;
    setState(next);
    if (!("tab" in action) || before[action.tab] || !next[action.tab]) return;
    // A tab just turned on: anchor its Explorer once the folder is known.
    const { tab } = action;
    const { id, pane } = next[tab];
    if (pane === null) return;
    void locateRef
      .current(tab, pane)
      .then((found) => found && apply({ type: "anchor", tab, id, ...found }))
      .catch(() => {});
  }, []);

  const actions = useMemo(() => {
    const id = () => nextId.current++;
    return {
      command: (tab: string, pane: string, command: string, prompt: string, commands: readonly string[]) => {
        const seen = { type: "command" as const, tab, pane, command, prompt, commands, id: id() };
        // Typed inside a running CLI, a command is not the start of one.
        const cli = cliOfCommand(command, withDefaultCommands(commands));
        if (cli && !runningCli.current.has(pane)) runningCli.current.set(pane, { cli, seen });
        apply(seen);
      },
      // A CLI retitles its terminal while it runs (Claude Code's spinner): only the first such title
      // counts, so a DEV mode turned off by hand stays off until the CLI starts again.
      title: (tab: string, pane: string, title: string, commands: readonly string[]) => {
        // A DEV mode already on also knows the default CLIs (their icon), listed or not.
        const isCli = cliOfTitle(title, current.current[tab] ? withDefaultCommands(commands) : commands) !== null;
        const was = titledCli.current.get(pane) ?? false;
        titledCli.current.set(pane, isCli);
        const running = runningCli.current.get(pane);
        const named = cliOfTitle(title, withDefaultCommands(commands));
        if (running && !titleKeepsCli(title, running.cli, withDefaultCommands(commands))) runningCli.current.delete(pane);
        else if (named && !running) runningCli.current.set(pane, { cli: named, seen: { type: "title", tab, pane, title, commands, id: 0 } });
        // A DEV mode on without a CLI (turned on by hand while one ran) learns it from any CLI title.
        const unknown = current.current[tab]?.cli === null;
        if (isCli && (!was || unknown)) apply({ type: "title", tab, pane, title, commands, id: id() });
      },
      promptMark: (tab: string, pane: string) => {
        runningCli.current.delete(pane);
        apply({ type: "promptMark", tab, pane });
      },
      quiet: (tab: string, pane: string, row: string) => apply({ type: "quiet", tab, pane, row }),
      show: (tab: string, pane: string, hidden: readonly string[]) => apply({ type: "show", tab, pane, hidden }),
      toggle: (tab: string, pane: string, hidden?: readonly string[]) => {
        apply({ type: "toggle", tab, pane, id: id(), hidden });
        // Turned on while a CLI already runs in the pane: it is known now, not at its next title.
        const running = runningCli.current.get(pane);
        if (current.current[tab] && running) apply({ ...running.seen, tab, id: id() });
      },
      forget: (panes: ReadonlyMap<string, readonly string[]>) => {
        const open = new Set([...panes.values()].flat());
        for (const pane of runningCli.current.keys()) if (!open.has(pane)) runningCli.current.delete(pane);
        apply({ type: "forget", panes });
      },
    };
  }, [apply]);

  return { state, ...actions };
}
