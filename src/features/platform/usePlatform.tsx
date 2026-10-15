import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/** The operating system NexusTerm runs on, as reported by the backend. */
export type Platform = "linux" | "windows" | "macos";

const PLATFORMS: readonly string[] = ["linux", "windows", "macos"];

/** Platform for the components below; "linux" when no provider is mounted (e.g. in tests). */
export const PlatformContext = createContext<Platform>("linux");

/** The current platform, used to adapt a few platform-specific texts and options. */
export function usePlatform(): Platform {
  return useContext(PlatformContext);
}

/** Asks the backend for the platform once and provides it; assumes "linux" until it answers. */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<Platform>("linux");
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => invoke<unknown>("platform"))
      .then((value) => {
        if (live && typeof value === "string" && PLATFORMS.includes(value)) setPlatform(value as Platform);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}
