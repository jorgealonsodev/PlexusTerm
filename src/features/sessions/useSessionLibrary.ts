import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyLibrary,
  libraryReducer,
  parseLibrary,
  serializeLibrary,
  type LibraryAction,
  type SessionLibrary,
} from "./library";

export type LibraryStatus =
  | { state: "loading" }
  | { state: "ready" }
  /** The file could not be read; editing is disabled so it is never overwritten. */
  | { state: "error"; message: string };

/** Loads the saved sessions and persists every change through the Rust storage commands. */
export function useSessionLibrary() {
  const [library, setLibrary] = useState<SessionLibrary>(emptyLibrary);
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const libraryRef = useRef(library);
  // Saves run one after another so an older snapshot can never land last.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  libraryRef.current = library;

  useEffect(() => {
    invoke<string | null>("sessions_load")
      .then((json) => {
        const parsed = parseLibrary(json);
        if (parsed.ok) {
          setLibrary(parsed.library);
          setStatus({ state: "ready" });
        } else {
          setStatus({ state: "error", message: parsed.error });
        }
      })
      .catch((err) => setStatus({ state: "error", message: String(err) }));
  }, []);

  const dispatch = useCallback(
    (action: LibraryAction) => {
      if (status.state !== "ready") return;
      const next = libraryReducer(libraryRef.current, action);
      libraryRef.current = next;
      setLibrary(next);
      const contents = serializeLibrary(next);
      saveQueue.current = saveQueue.current
        .then(() => invoke("sessions_save", { contents }))
        .then(() => setSaveError(null))
        .catch((err) => setSaveError(String(err)));
    },
    [status.state],
  );

  /** Replaces the whole library (sessions merged from another computer) and saves it. */
  const replace = useCallback(
    (next: SessionLibrary) => {
      if (status.state !== "ready") return;
      libraryRef.current = next;
      setLibrary(next);
      const contents = serializeLibrary(next);
      saveQueue.current = saveQueue.current
        .then(() => invoke("sessions_save", { contents }))
        .then(() => setSaveError(null))
        .catch((err) => setSaveError(String(err)));
    },
    [status.state],
  );

  return { library, status, saveError, dispatch, replace };
}
