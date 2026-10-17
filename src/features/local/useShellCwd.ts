import { useEffect, useState } from "react";
import { local } from "./localClient";

/** How often the panel asks for the folder of a shell that does not send OSC 7. */
export const SHELL_CWD_POLL_MS = 1000;

/**
 * The folder of a local terminal: the one its shell reports through OSC 7, otherwise the shell's
 * working folder read by the backend every second while `enabled`. Null until known.
 */
export function useShellCwd(ptyId: number | null, oscCwd: string | null, enabled: boolean): string | null {
  const [polled, setPolled] = useState<string | null>(null);
  useEffect(() => {
    setPolled(null);
    if (!enabled || oscCwd !== null || ptyId === null) return;
    let live = true;
    const ask = () =>
      local
        .shellCwd(ptyId)
        .then((dir) => live && dir !== null && setPolled(dir))
        .catch(() => {});
    void ask();
    const timer = window.setInterval(ask, SHELL_CWD_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [ptyId, oscCwd, enabled]);
  return oscCwd ?? polled;
}
