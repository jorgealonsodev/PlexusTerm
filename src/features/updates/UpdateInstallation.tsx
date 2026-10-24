import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { Release } from "./updates";

export interface Progress {
  phase: "checking" | "downloading" | "verifying" | "installing";
  downloaded?: number;
  total?: number;
}

type Installation =
  | { state: "idle" }
  | { state: "busy"; release: Release; progress: Progress }
  | { state: "failed"; release: Release; error: string }
  | { state: "done"; release: Release; result: "installed" | "installerOpened" };

export const updateError = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Owns the channel beyond either UI's lifetime; only the app provider owns this controller. */
function createInstallation() {
  let snapshot: Installation = { state: "idle" };
  let channel: Channel<Progress> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Installation) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async start(release: Release) {
      // Synchronous guard also covers clicks before React has rendered disabled buttons.
      if (snapshot.state === "busy" || snapshot.state === "done") return;
      publish({ state: "busy", release, progress: { phase: "checking" } });
      try {
        channel = new Channel<Progress>();
        channel.onmessage = (progress) => publish({ state: "busy", release, progress });
        const result = await invoke<"installed" | "installerOpened">("update_install", { onProgress: channel });
        publish({ state: "done", release, result });
      } catch (error) {
        publish({ state: "failed", release, error: updateError(error) });
      } finally {
        if (channel) channel.onmessage = () => {};
        channel = null;
      }
    },
  };
}

const InstallationContext = createContext(createInstallation());

export function UpdateInstallationProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createInstallation);
  return <InstallationContext.Provider value={controller}>{children}</InstallationContext.Provider>;
}

export function useUpdateInstallation() {
  const controller = useContext(InstallationContext);
  const installation = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return { installation, start: controller.start };
}
