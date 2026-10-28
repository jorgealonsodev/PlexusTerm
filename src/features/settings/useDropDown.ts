import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { t as translate } from "../../i18n/i18n";

/** Why the drop-down shortcut could not be set, as `dropdown_set` answers it. */
export type DropDownError =
  | { kind: "invalid"; detail: string }
  | { kind: "wayland" }
  | { kind: "register"; detail: string };

const isDropDownError = (value: unknown): value is DropDownError =>
  typeof value === "object" &&
  value !== null &&
  ["invalid", "wayland", "register"].includes((value as { kind?: unknown }).kind as string);

/** The message Settings shows under the drop-down shortcut. */
export function describeDropDownError(err: unknown, t: typeof translate): string {
  if (!isDropDownError(err)) return t("settings.general.dropDownFailed", { error: String(err) });
  if (err.kind === "wayland") return t("settings.general.dropDownWayland");
  if (err.kind === "invalid") return t("settings.shortcuts.invalid");
  return t("settings.general.dropDownFailed", { error: err.detail });
}

/**
 * Keeps the system-wide drop-down shortcut (Settings → General) registered as the settings say,
 * from the moment they are loaded. While it was never set, nothing is asked of the system. Answers
 * why the last shortcut could not be set, or null.
 */
export function useDropDown(shortcut: string, height: number, loaded: boolean): unknown {
  const [error, setError] = useState<unknown>(null);
  const used = useRef(false);

  useEffect(() => {
    if (!loaded || (shortcut === "" && !used.current)) return;
    used.current = true;
    let live = true;
    invoke("dropdown_set", { shortcut, height })
      .then(() => live && setError(null))
      .catch((err: unknown) => live && setError(err ?? "unknown"));
    return () => {
      live = false;
    };
  }, [shortcut, height, loaded]);

  return error;
}
