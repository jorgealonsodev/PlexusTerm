import { isRoot, parentPath } from "../local/localPath";

/** Folders climbed at most looking for the repository. */
const MAX_DEPTH = 64;

/**
 * Where DEV mode anchors the Explorer (S10): the git repository holding `folder` (the nearest
 * folder with a `.git` entry, file or folder), else `folder` itself. A folder that cannot be listed
 * ends the search. `list` lists a folder of the terminal's machine (local disk or SFTP).
 */
export async function projectRootOf(
  folder: string,
  list: (path: string) => Promise<readonly { name: string }[]>,
): Promise<string> {
  let dir = folder;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let names: readonly { name: string }[];
    try {
      names = await list(dir);
    } catch {
      return folder;
    }
    if (names.some((entry) => entry.name === ".git")) return dir;
    if (isRoot(dir)) break;
    const parent = parentPath(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return folder;
}
