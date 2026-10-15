import { t } from "../../i18n/i18n";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Whether a system keyring (Secret Service) can hold saved passwords. */
export async function secretAvailable(): Promise<boolean> {
  try {
    return (await invoke<boolean>("secret_available")) === true;
  } catch {
    return false;
  }
}

/** Whether a password is saved for the session; unreadable keyrings count as "no". */
export async function secretExists(sessionId: string): Promise<boolean> {
  try {
    return (await invoke<boolean>("secret_exists", { sessionId })) === true;
  } catch {
    return false;
  }
}

/** Deletes the saved password of the session; rejects when the keyring refuses. */
export async function secretDelete(sessionId: string): Promise<void> {
  await invoke("secret_delete", { sessionId });
}

/**
 * Deletes the saved passwords of the sessions (missing ones are fine). Resolves to an
 * error message when some could not be deleted, or null. Without a keyring there is nothing to delete.
 */
export async function forgetSecrets(sessionIds: string[]): Promise<string | null> {
  if (sessionIds.length === 0 || !(await secretAvailable())) return null;
  const results = await Promise.allSettled(sessionIds.map(secretDelete));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === 0) return null;
  const reason = failed[0].reason as { message?: unknown } | undefined;
  const detail = typeof reason?.message === "string" ? reason.message : String(failed[0].reason);
  return t("sessions.secrets.deleteFailed", { count: failed.length, error: detail });
}

/** `secret_available`, asked once per mount while `enabled`; null until known. */
export function useSecretAvailable(enabled: boolean): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void secretAvailable().then((value) => live && setAvailable(value));
    return () => {
      live = false;
    };
  }, [enabled]);
  return available;
}
