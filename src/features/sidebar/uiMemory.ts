/**
 * How the interface was left (the sidebar tab, the folded session folders), kept in local storage
 * so PlexusTerm opens the same way; shared by every window. Unreadable or missing values give null.
 */

const SIDEBAR_VIEW_KEY = "plexusterm.sidebarView";
const FOLDED_SESSION_FOLDERS_KEY = "plexusterm.foldedSessionFolders";

function load(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage (private mode, a full disk) the interface simply starts as by default.
  }
}

/** The sidebar tab last shown, if it is one of `views`. */
export function loadSidebarView<V extends string>(views: readonly V[]): V | null {
  const value = load(SIDEBAR_VIEW_KEY);
  return typeof value === "string" && (views as readonly string[]).includes(value) ? (value as V) : null;
}

export const saveSidebarView = (view: string) => store(SIDEBAR_VIEW_KEY, view);

/** The session folders left folded. */
export function loadFoldedSessionFolders(): Set<string> {
  const value = load(FOLDED_SESSION_FOLDERS_KEY);
  return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
}

export const saveFoldedSessionFolders = (folders: ReadonlySet<string>) => store(FOLDED_SESSION_FOLDERS_KEY, [...folders].sort());
