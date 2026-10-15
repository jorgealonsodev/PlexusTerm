/** Multi-execution (S11.4): typing in the focused pane also goes to the other panes of the group. */

export interface PaneInfo {
  id: string;
  /** Backend session id; null while the pane is still connecting or after it ended. */
  sessionId: number | null;
  excluded: boolean;
}

/** Panes that take part in multi-execution: connected and not excluded. */
export function multiExecGroup(panes: PaneInfo[]): string[] {
  return panes.filter((p) => p.sessionId !== null && !p.excluded).map((p) => p.id);
}

/** Panes that receive the input typed in `sourceId`; nothing when the source is not in the group. */
export function broadcastTargets(panes: PaneInfo[], sourceId: string): string[] {
  const group = multiExecGroup(panes);
  return group.includes(sourceId) ? group.filter((id) => id !== sourceId) : [];
}

export type PaneWriter = (data: string) => void;

/** Where each mounted terminal pane can be written to, as if the user typed it. */
export function createWriterRegistry() {
  const writers = new Map<string, PaneWriter>();
  return {
    /** Returns the unregister function; it never removes a newer writer for the same pane. */
    register(paneId: string, write: PaneWriter): () => void {
      writers.set(paneId, write);
      return () => {
        if (writers.get(paneId) === write) writers.delete(paneId);
      };
    },
    write(paneIds: string[], data: string) {
      for (const id of paneIds) writers.get(id)?.(data);
    },
  };
}

export type WriterRegistry = ReturnType<typeof createWriterRegistry>;
