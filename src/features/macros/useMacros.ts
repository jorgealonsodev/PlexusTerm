import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryStatus } from "../sessions/useSessionLibrary";
import { emptyMacros, macrosReducer, parseMacros, serializeMacros, type MacroAction, type MacroList } from "./macros";

/** Loads the saved macros and persists every change to macros.json (S16.5). */
export function useMacros() {
  const [list, setList] = useState<MacroList>(emptyMacros);
  const [status, setStatus] = useState<LibraryStatus>({ state: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const listRef = useRef(list);
  // Saves run one after another so an older snapshot can never land last.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  listRef.current = list;

  useEffect(() => {
    invoke<string | null>("macros_load")
      .then((json) => {
        const parsed = parseMacros(json);
        if (parsed.ok) {
          setList(parsed.list);
          setStatus({ state: "ready" });
        } else {
          setStatus({ state: "error", message: parsed.error });
        }
      })
      .catch((err) => setStatus({ state: "error", message: String(err) }));
  }, []);

  const dispatch = useCallback(
    (action: MacroAction) => {
      if (status.state !== "ready") return;
      const next = macrosReducer(listRef.current, action);
      listRef.current = next;
      setList(next);
      const contents = serializeMacros(next);
      saveQueue.current = saveQueue.current
        .then(() => invoke("macros_save", { contents }))
        .then(() => setSaveError(null))
        .catch((err) => setSaveError(String(err)));
    },
    [status.state],
  );

  return { list, status, saveError, dispatch };
}
