/** Pure helpers for POSIX paths on the remote side (always `/`-separated). */

const trimTrailing = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") || "/" : path);

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** The containing folder; the root is its own parent. */
export function parentPath(path: string): string {
  const trimmed = trimTrailing(path);
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

export function basename(path: string): string {
  const trimmed = trimTrailing(path);
  if (trimmed === "/") return "/";
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Characters that never need quoting in a POSIX shell word. */
const PLAIN = /^[A-Za-z0-9_\-./+@:,=%]+$/;

/** `path` as one POSIX shell word: unchanged when plain, otherwise single-quoted. */
export function shellQuote(path: string): string {
  return PLAIN.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}
