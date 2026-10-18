/** The toolbar colour of this window, to tell PlexusTerm windows apart (like VS Code's Peacock). */

/** Colours offered in the toolbar's menu, by name (`app.toolbarColor.<name>`). */
export const TOOLBAR_COLORS = [
  ["red", "#c0392b"],
  ["orange", "#d35400"],
  ["yellow", "#d4ac0d"],
  ["green", "#27ae60"],
  ["teal", "#16a085"],
  ["blue", "#2e86de"],
  ["purple", "#8e44ad"],
  ["pink", "#d63384"],
] as const;

/** Session storage is this window's own: other PlexusTerm windows keep theirs, and a reload keeps it. */
const KEY = "plexusterm.toolbarColor";
const VALID = /^#[0-9a-f]{6}$/i;

export function loadToolbarColor(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value && VALID.test(value) ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function saveToolbarColor(color: string | null) {
  try {
    if (color) sessionStorage.setItem(KEY, color);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Without storage the colour lasts until the window reloads.
  }
}
