import { shortcutConflict, type KeyLike, type ShortcutOverrides } from "../panes/shortcuts";

/** Modifier names, in the order a shortcut lists them ("Ctrl+Alt+Shift+Meta+K"). */
const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS", "Super", "Hyper"]);

const keyName = (key: string) => (key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key);

/** The shortcut a key event makes ("Ctrl+Shift+Space"), or null while only modifiers are held. */
export function shortcutFromEvent(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key) || !e.key) return null;
  const held = [e.ctrlKey, e.altKey, e.shiftKey, e.metaKey];
  return [...MODIFIERS.filter((_, i) => held[i]), keyName(e.key)].join("+");
}

/** True when the key event is `shortcut`. */
export const matchesShortcut = (e: KeyLike, shortcut: string) => shortcutFromEvent(e) === shortcut;

function parse(shortcut: string): { mods: Set<string>; key: string } | null {
  const plusKey = shortcut.endsWith("++");
  const parts = (plusKey ? shortcut.slice(0, -2) : shortcut).split("+");
  const key = plusKey ? "+" : parts.pop();
  if (!key || MODIFIER_KEYS.has(key) || (MODIFIERS as readonly string[]).includes(key)) return null;
  const mods = new Set(parts);
  if (mods.size !== parts.length || parts.some((m) => !(MODIFIERS as readonly string[]).includes(m))) return null;
  return { mods, key };
}

/** A shortcut with Ctrl, Alt or Meta and one key (plain keys and Shift+key belong to typing). */
export function isValidShortcut(shortcut: string): boolean {
  const parsed = parse(shortcut);
  return parsed !== null && (parsed.mods.has("Ctrl") || parsed.mods.has("Alt") || parsed.mods.has("Meta"));
}

/**
 * True when PlexusTerm already uses the combination with these overrides (the defaults when omitted):
 * any action's binding, the macro keys or accept-word.
 */
export const appShortcutConflict = (shortcut: string, overrides: ShortcutOverrides = {}): boolean =>
  parse(shortcut) !== null && shortcutConflict(shortcut, overrides) !== null;
