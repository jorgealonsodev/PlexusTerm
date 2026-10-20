import { useCallback, useMemo, useRef, useState } from "react";
import { cliOfTitle, devReducer, type DevAction, type DevState } from "./devMode";

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
  /** Each pane's last title and the CLI list it was read with, for a DEV mode turned on later. */
  const lastTitle = useRef(new Map<string, { title: string; commands: readonly string[] }>());
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
      command: (tab: string, pane: string, command: string, prompt: string, commands: readonly string[]) =>
        apply({ type: "command", tab, pane, command, prompt, commands, id: id() }),
      // A CLI retitles its terminal while it runs (Claude Code's spinner): only the first such title
      // counts, so a DEV mode turned off by hand stays off until the CLI starts again.
      title: (tab: string, pane: string, title: string, commands: readonly string[]) => {
        const isCli = cliOfTitle(title, commands) !== null;
        const was = titledCli.current.get(pane) ?? false;
        titledCli.current.set(pane, isCli);
        lastTitle.current.set(pane, { title, commands });
        // A DEV mode on without a CLI (turned on by hand while one ran) learns it from any CLI title.
        const unknown = current.current[tab]?.cli === null;
        if (isCli && (!was || unknown)) apply({ type: "title", tab, pane, title, commands, id: id() });
      },
      promptMark: (tab: string, pane: string) => apply({ type: "promptMark", tab, pane }),
      quiet: (tab: string, pane: string, row: string) => apply({ type: "quiet", tab, pane, row }),
      show: (tab: string, pane: string, hidden: readonly string[]) => apply({ type: "show", tab, pane, hidden }),
      toggle: (tab: string, pane: string, hidden?: readonly string[]) => {
        apply({ type: "toggle", tab, pane, id: id(), hidden });
        // Turned on while a CLI already runs in the pane: its title names it now, not later.
        const last = lastTitle.current.get(pane);
        if (current.current[tab] && last && cliOfTitle(last.title, last.commands) !== null) {
          apply({ type: "title", tab, pane, ...last, id: id() });
        }
      },
      forget: (panes: ReadonlyMap<string, readonly string[]>) => apply({ type: "forget", panes }),
    };
  }, [apply]);

  return { state, ...actions };
}
