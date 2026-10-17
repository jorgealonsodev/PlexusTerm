/** Pure helpers for local paths: `/`-separated, or Windows paths such as `C:\Users\me`. */

const isWindows = (path: string) => /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith("\\\\");

/** The separator a path uses: `\` for Windows drive and UNC paths, `/` otherwise. */
export const separatorOf = (path: string) =>
  isWindows(path) && (path.includes("\\") || !path.includes("/")) ? "\\" : "/";

/** The root of a path: `/`, `C:\` (or `C:/`), or null when it has none. */
function rootOf(path: string): string | null {
  const drive = /^[A-Za-z]:[\\/]?/.exec(path);
  if (drive) return drive[0].length === 2 ? `${drive[0]}${separatorOf(path)}` : drive[0];
  return path.startsWith("/") ? "/" : null;
}

const trimTrailing = (path: string) => {
  const root = rootOf(path);
  const trimmed = path.replace(/[\\/]+$/, "");
  return root !== null && trimmed.length < root.length ? root : trimmed || path;
};

export function joinPath(dir: string, name: string): string {
  const sep = separatorOf(dir);
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/** The containing folder; a root (`/`, `C:\`) is its own parent. */
export function parentPath(path: string): string {
  const trimmed = trimTrailing(path);
  const root = rootOf(trimmed);
  if (root !== null && trimmed === root) return root;
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return trimmed;
  const parent = trimmed.slice(0, index);
  return root !== null && parent.length < root.length ? root : parent;
}

export function isRoot(path: string): boolean {
  const trimmed = trimTrailing(path);
  return rootOf(trimmed) === trimmed;
}

export function basename(path: string): string {
  const trimmed = trimTrailing(path);
  if (isRoot(trimmed)) return trimmed;
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** A file or folder name that can be created in a folder. */
export const validName = (name: string) =>
  name !== "" && name !== "." && name !== ".." && !/[\\/]/.test(name);
