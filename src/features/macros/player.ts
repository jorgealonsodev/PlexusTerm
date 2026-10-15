import { stripAnsi } from "../terminal/output";
import { parseEscapes, type Macro } from "./macros";

/** What a macro needs from a terminal pane. */
export interface MacroIo {
  /** Writes as if typed, through the pane's normal input path (multi-execution included). */
  send(text: string): void;
  /** Calls `listener` with every chunk of output the pane receives; returns the unsubscribe function. */
  subscribe(listener: (text: string) => void): () => void;
}

/** A terminal pane macros can play into. */
export interface MacroTarget extends MacroIo {
  /** Shows a message in the pane without sending it (e.g. why a macro stopped). */
  notice(text: string): void;
}

export type PlayResult = { status: "done" } | { status: "stopped" } | { status: "failed"; message: string };

export interface PlayOptions {
  /** Called before each step with its index (from 0) and the step count. */
  onProgress?: (step: number, total: number) => void;
}

export interface MacroRun {
  done: Promise<PlayResult>;
  /** Ends the run before its next step; a pending wait ends at once. */
  stop(): void;
}

/** Output kept for waitFor: enough for any prompt, bounded for chatty commands. */
const OUTPUT_KEEP = 64 * 1024;

/** Plays `macro` into `io`, one step after another (S16.3). */
export function playMacro(macro: Macro, io: MacroIo, options: PlayOptions = {}): MacroRun {
  const total = macro.steps.length;
  let stopped = false;
  /** Output received since the current step started. */
  let output = "";
  /** Re-checks the current waitFor after new output or a stop. */
  let wake: () => void = () => {};
  const unsubscribe = io.subscribe((text) => {
    output = (output + text).slice(-OUTPUT_KEEP);
    wake();
  });

  /** Resolves true when `ready()` holds, false on timeout or stop. */
  const until = (ready: () => boolean, ms: number) =>
    new Promise<boolean>((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        wake = () => {};
        resolve(ok);
      };
      const timer = setTimeout(() => finish(ready()), ms);
      wake = () => {
        if (stopped) finish(false);
        else if (ready()) finish(true);
      };
      wake();
    });

  const run = async (): Promise<PlayResult> => {
    for (let i = 0; i < total; i++) {
      if (stopped) return { status: "stopped" };
      options.onProgress?.(i, total);
      const step = macro.steps[i];
      output = "";
      if (step.kind === "send") io.send(parseEscapes(step.text));
      else if (step.kind === "wait") await until(() => false, step.ms);
      else {
        const text = parseEscapes(step.text);
        const found = await until(() => stripAnsi(output).includes(text), step.timeoutSec * 1000);
        if (stopped) return { status: "stopped" };
        if (!found) {
          return {
            status: "failed",
            message: `Macro "${macro.name}" stopped at step ${i + 1} of ${total}: "${step.text}" did not appear within ${step.timeoutSec} s.`,
          };
        }
      }
      // Lets output and a stop arrive between steps.
      await Promise.resolve();
    }
    return stopped ? { status: "stopped" } : { status: "done" };
  };

  const done = run().finally(unsubscribe);
  return {
    done,
    stop() {
      stopped = true;
      wake();
    },
  };
}

/** Per-pane targets (e.g. macro targets), registered by mounted panes. */
export function createTargetRegistry<T>() {
  const targets = new Map<string, T>();
  return {
    /** Returns the unregister function; it never removes a newer target for the same pane. */
    register(paneId: string, target: T): () => void {
      targets.set(paneId, target);
      return () => {
        if (targets.get(paneId) === target) targets.delete(paneId);
      };
    },
    get: (paneId: string) => targets.get(paneId),
  };
}
