import { useEffect, useRef, useState } from "react";
import type { GitStatusEntry } from "./gitStatus";

/** A list reads its git status at most this often, however much the terminal prints. */
export const GIT_STATUS_MIN_INTERVAL_MS = 2000;

export interface GitStatusOptions {
  /** Settings → Files → "Show git status in file lists". */
  enabled: boolean;
  /** The list is on screen; a hidden list never reads. */
  visible: boolean;
  /** Changes each time the terminal's prompt comes back (a command may have changed files). */
  prompt: number;
  /** Changes each time the list is loaded again (refresh, after a rename, ...). */
  loads: number;
  /**
   * Listens to the output of the terminal tied to the list (AI CLIs edit files while printing);
   * returns the function that stops listening.
   */
  subscribeOutput?: (listener: (text: string) => void) => () => void;
}

const NONE: GitStatusEntry[] = [];

/**
 * The git status of the files under `root`, read with `read` when the folder changes, when the
 * list loads, when the prompt comes back and while the terminal prints, at most once every
 * {@link GIT_STATUS_MIN_INTERVAL_MS} and only while visible; never polled when idle. A failed read
 * shows no decorations.
 */
export function useGitStatus(
  read: (root: string) => Promise<GitStatusEntry[]>,
  root: string | null,
  { enabled, visible, prompt, loads, subscribeOutput }: GitStatusOptions,
): GitStatusEntry[] {
  const [result, setResult] = useState<{ root: string; entries: GitStatusEntry[] } | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const active = enabled && visible && root !== null;

  // The throttle; it lives as long as the list reads one folder while active.
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    if (!active) {
      request.current = () => {};
      return;
    }
    let live = true;
    let last = -Infinity;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let again = false;
    const run = () => {
      timer = null;
      busy = true;
      last = Date.now();
      readRef
        .current(root)
        .then(
          (entries) => live && setResult({ root, entries: Array.isArray(entries) ? entries : NONE }),
          () => live && setResult({ root, entries: NONE }),
        )
        .finally(() => {
          busy = false;
          if (live && again) {
            again = false;
            request.current();
          }
        });
    };
    request.current = () => {
      if (!live) return;
      if (busy) {
        again = true;
        return;
      }
      if (timer !== null) return;
      const wait = last + GIT_STATUS_MIN_INTERVAL_MS - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    };
    request.current();
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      request.current = () => {};
    };
  }, [active, root]);

  // The prompt came back or the list was loaded again.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    request.current();
  }, [prompt, loads]);

  // The terminal is printing.
  useEffect(() => {
    if (!active || !subscribeOutput) return;
    return subscribeOutput(() => request.current());
  }, [active, subscribeOutput]);

  return active && result?.root === root ? result.entries : NONE;
}
