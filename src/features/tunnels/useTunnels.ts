import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryStatus } from "../sessions/useSessionLibrary";
import {
  emptyTunnels,
  parseTunnels,
  serializeTunnels,
  tunnelsReducer,
  type TunnelAction,
  type TunnelList,
  type TunnelStatus,
} from "./tunnels";

interface StatusUpdate {
  id: string;
  status: TunnelStatus;
}

/** Loads the saved tunnels, persists every change and tracks the backend status of each tunnel. */
export function useTunnels() {
  const [list, setList] = useState<TunnelList>(emptyTunnels);
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, TunnelStatus>>({});
  const listRef = useRef(list);
  // Saves run one after another so an older snapshot can never land last.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  listRef.current = list;

  useEffect(() => {
    invoke<string | null>("tunnels_load")
      .then((json) => {
        const parsed = parseTunnels(json);
        if (parsed.ok) {
          setList(parsed.list);
          setStatus({ state: "ready" });
        } else {
          setStatus({ state: "error", message: parsed.error });
        }
      })
      .catch((err) => setStatus({ state: "error", message: String(err) }));
  }, []);

  const applyStatus = useCallback((update: StatusUpdate) => {
    setStatuses((prev) => ({ ...prev, [update.id]: update.status }));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<StatusUpdate>("tunnel-status", ({ payload }) => applyStatus(payload))
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => {});
    // Tunnels keep running while the window reloads: pick up their current state.
    invoke<StatusUpdate[]>("tunnel_statuses")
      .then((all) => all.forEach(applyStatus))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyStatus]);

  const dispatch = useCallback(
    (action: TunnelAction) => {
      if (status.state !== "ready") return;
      const next = tunnelsReducer(listRef.current, action);
      listRef.current = next;
      setList(next);
      const contents = serializeTunnels(next);
      saveQueue.current = saveQueue.current
        .then(() => invoke("tunnels_save", { contents }))
        .then(() => setSaveError(null))
        .catch((err) => setSaveError(String(err)));
    },
    [status.state],
  );

  const statusOf = useCallback(
    (id: string): TunnelStatus => statuses[id] ?? { state: "stopped" },
    [statuses],
  );

  /** Records a failure detected before reaching the backend (e.g. a deleted session). */
  const reportError = useCallback(
    (id: string, message: string) => applyStatus({ id, status: { state: "error", message } }),
    [applyStatus],
  );

  return { list, status, saveError, statusOf, reportError, dispatch };
}
