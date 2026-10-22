import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

/** How often the interface tells the backend it is alive. */
export const HEARTBEAT_MS = 1000;
/** A backend reply slower than this is logged. */
export const SLOW_REPLY_MS = 2000;

const logEntry = (level: "info" | "warn" | "error", message: string) =>
  void invoke("diag_log", { level, message }).catch(() => {});

/** Where the diagnostic log goes when no folder is chosen, or null outside the app. */
export const diagnosticLogDefaultDir = () => invoke<string>("diag_log_default_dir").catch(() => null);

/**
 * The diagnostic log, as Settings choose: turned on in `dir` ("" = the app's log folder) or off once
 * the settings are loaded. While on, the interface sends a heartbeat every second (the backend's
 * watchdog logs when it stops, i.e. the window froze), notes when its own timer fired late (its
 * thread was blocked) or the backend replied slowly, and logs uncaught errors.
 */
export function useDiagnosticLog(loaded: boolean, enabled: boolean, dir: string) {
  useEffect(() => {
    if (!loaded) return;
    if (!enabled) {
      void invoke("diag_log_configure", { enabled: false, dir: "" }).catch(() => {});
      return;
    }
    void invoke("diag_log_configure", { enabled: true, dir }).catch((error) =>
      console.warn("Diagnostic log could not start:", error),
    );

    let due = performance.now() + HEARTBEAT_MS;
    const beat = () => {
      const now = performance.now();
      const lateMs = Math.max(0, Math.round(now - due));
      due = now + HEARTBEAT_MS;
      void invoke("diag_heartbeat", { lateMs })
        .then(() => {
          const took = performance.now() - now;
          if (took >= SLOW_REPLY_MS) logEntry("warn", `backend replied to the heartbeat after ${(took / 1000).toFixed(1)} s`);
        })
        .catch(() => {});
    };
    const timer = setInterval(beat, HEARTBEAT_MS);

    const onError = (event: ErrorEvent) =>
      logEntry("error", `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? (event.reason.stack ?? event.reason.message) : String(event.reason);
      logEntry("error", `unhandled promise rejection: ${reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      clearInterval(timer);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [loaded, enabled, dir]);
}
