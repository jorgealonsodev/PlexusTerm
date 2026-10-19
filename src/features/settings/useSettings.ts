import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { clampFontSize, DEFAULT_SETTINGS, parseSettings, serializeSettings, type TerminalSettings } from "./settings";

/** WebKitGTK, the webview on Linux, names itself "(X11; … Linux …)", on Wayland too. */
const isLinuxWebview = () => typeof navigator !== "undefined" && /\(X11;[^)]*Linux/.test(navigator.userAgent);

/**
 * The terminal settings (S15.6), loaded from settings.json and saved after every change.
 * A failed load or save keeps the app usable with the settings in memory.
 */
export function useSettings() {
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULT_SETTINGS);
  /** True once settings.json was read (or could not be): what opens at startup depends on it. */
  const [loaded, setLoaded] = useState(false);
  const current = useRef(settings);
  /** Set once the user changed something: a slower load must not undo it. */
  const changed = useRef(false);
  // Saves run one after another so an older snapshot can never land last.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    invoke<string | null>("settings_load")
      .then((json) => {
        if (changed.current) return;
        current.current = parseSettings(json, { linux: isLinuxWebview() });
        setSettings(current.current);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const update = useCallback((patch: Partial<TerminalSettings>) => {
    const next = { ...current.current, ...patch };
    next.fontSize = Number.isFinite(next.fontSize) ? clampFontSize(next.fontSize) : current.current.fontSize;
    changed.current = true;
    current.current = next;
    setSettings(next);
    const contents = serializeSettings(next);
    saveQueue.current = saveQueue.current.then(() => invoke("settings_save", { contents })).catch(() => {});
  }, []);

  /** Applies a change computed from the latest settings (e.g. one font size step). */
  const updateWith = useCallback(
    (fn: (settings: TerminalSettings) => Partial<TerminalSettings>) => update(fn(current.current)),
    [update],
  );

  return { settings, loaded, update, updateWith };
}
