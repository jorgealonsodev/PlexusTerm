import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/** A command interpreter local terminals can run. */
export interface Shell {
  /** File name without directory or `.exe`, e.g. `pwsh` or `zsh`. */
  name: string;
  /** What to run: a full path, or a bare name. */
  program: string;
}

/** The shells found on this machine and the one local terminals run by default. */
export interface Shells {
  default: Shell;
  available: Shell[];
}

/** The shells for the components below; null until the backend answers (and in tests without a provider). */
export const ShellsContext = createContext<Shells | null>(null);

export function useShells(): Shells | null {
  return useContext(ShellsContext);
}

const isShell = (value: unknown): value is Shell =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Shell).name === "string" &&
  typeof (value as Shell).program === "string";

const isShells = (value: unknown): value is Shells =>
  typeof value === "object" &&
  value !== null &&
  isShell((value as Shells).default) &&
  Array.isArray((value as Shells).available) &&
  (value as Shells).available.every(isShell);

/** Asks the backend for the installed shells once and provides them. */
export function ShellsProvider({ children }: { children: ReactNode }) {
  const [shells, setShells] = useState<Shells | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => invoke<unknown>("shells"))
      .then((value) => {
        if (live && isShells(value)) setShells(value);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return <ShellsContext.Provider value={shells}>{children}</ShellsContext.Provider>;
}
