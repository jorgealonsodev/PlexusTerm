/** The local folders DEV mode was last used in, offered by the Explorer to open again. */

/** How many folders are kept unless Settings say otherwise, and the most they may say. */
export const DEFAULT_RECENT_FOLDERS = 10;
export const MAX_RECENT_FOLDERS = 50;

/** Local storage is shared by every PlexusTerm window and kept across restarts. */
const KEY = "plexusterm.recentDevFolders";

/** `folder` first, without its older entry, keeping the last `limit`; the same list when nothing changes. */
export function addRecentFolder(list: readonly string[], folder: string, limit = DEFAULT_RECENT_FOLDERS): readonly string[] {
  if (list[0] === folder && list.length <= limit) return list;
  return [folder, ...list.filter((f) => f !== folder)].slice(0, limit);
}

export function loadRecentFolders(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
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

export function saveRecentFolders(folders: readonly string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(folders));
  } catch {
    // Without storage the list lasts until the window reloads.
  }
}
