import { invoke } from "@tauri-apps/api/core";

/** A published release newer than the running PlexusTerm. */
export interface Release {
  version: string;
  notes: string;
  /** Its GitHub page, where every package can be downloaded. */
  url: string;
}

export interface UpdateCheck {
  current: string;
  latest: Release | null;
}

/** Asks the backend whether a newer release is published; rejects with a message when the check fails. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  try {
    return await invoke<UpdateCheck>("update_check");
  } catch (err) {
    throw typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  }
}
