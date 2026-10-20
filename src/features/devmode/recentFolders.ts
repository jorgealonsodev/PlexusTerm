/** The local folders DEV mode was last used in and the workspace files last opened, offered by the Explorer to open again. */

/** How many folders are kept unless Settings say otherwise, and the most they may say. */
export const DEFAULT_RECENT_FOLDERS = 10;
export const MAX_RECENT_FOLDERS = 50;

/** Local storage is shared by every PlexusTerm window and kept across restarts. */
const KEY = "plexusterm.recentDevFolders";
/** The workspace files last opened or saved, a list of their own with the same limit. */
const WORKSPACES_KEY = "plexusterm.recentDevWorkspaces";

/** `folder` first, without its older entry, keeping the last `limit`; the same list when nothing changes. */
export function addRecentFolder(list: readonly string[], folder: string, limit = DEFAULT_RECENT_FOLDERS): readonly string[] {
  if (list[0] === folder && list.length <= limit) return list;
  return [folder, ...list.filter((f) => f !== folder)].slice(0, limit);
}

export const loadRecentFolders = () => loadList(KEY);
export const saveRecentFolders = (folders: readonly string[]) => saveList(KEY, folders);
export const loadRecentWorkspaces = () => loadList(WORKSPACES_KEY);
export const saveRecentWorkspaces = (files: readonly string[]) => saveList(WORKSPACES_KEY, files);

function loadList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    const folders: string[] = [];
    for (const item of value) {
      if (typeof item === "string" && item !== "" && !folders.includes(item)) folders.push(item);
    }
    return folders.slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
}

function saveList(key: string, list: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Without storage the list lasts until the window reloads.
  }
}
