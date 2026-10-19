import { applyEdits, modify, parse } from "jsonc-parser";

/**
 * DEV mode workspaces saved to a file, in VS Code's `.code-workspace` format, so the same file
 * opens the same folders in both: `{ "folders": [{ "path": "..." }] }`.
 */

export const WORKSPACE_EXTENSION = "code-workspace";

type FolderEntry = Record<string, unknown>;

/**
 * The file's text for these folders (absolute paths), written as VS Code writes it: each path
 * relative to the file's folder when it can be (absolute on another drive), with backslashes on
 * Windows unless the file already uses slashes. A new file gets empty settings and tabs; over an
 * `existing` workspace only its folders change, keeping comments, settings, folder names and
 * remote folders.
 */
export function workspaceFileText(folders: readonly string[], file: string, existing?: string | null): string {
  const base = folderOf(file);
  const old = existingFolders(existing);
  const slashes = !isWindowsPath(file) || old.some((entry) => typeof entry.path === "string" && entry.path.includes("/"));
  const byPath = new Map<string, FolderEntry>();
  for (const entry of old) {
    if (typeof entry.path === "string" && entry.path.trim()) byPath.set(resolve(base, entry.path), entry);
  }
  const entries: FolderEntry[] = folders.map((folder) => byPath.get(normalize(folder)) ?? { path: storedPath(base, folder, slashes) });
  // Remote folders are not shown here, so they stay as they were.
  entries.push(...old.filter((entry) => typeof entry.path !== "string" && typeof entry.uri === "string"));
  if (existing == null || old.length === 0 && !isWorkspace(existing)) {
    return JSON.stringify({ folders: entries, settings: {} }, null, "\t");
  }
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const edits = modify(existing, ["folders"], entries, { formattingOptions: { insertSpaces: false, tabSize: 4, eol } });
  return applyEdits(existing, edits);
}

/** The folder entries of an existing workspace file; none when it is not one. */
function existingFolders(text: string | null | undefined): FolderEntry[] {
  if (!text) return [];
  const folders = (parse(text, [], { allowTrailingComma: true }) as { folders?: unknown } | null)?.folders;
  return Array.isArray(folders) ? folders.filter((f): f is FolderEntry => typeof f === "object" && f !== null && !Array.isArray(f)) : [];
}

/** Whether a text is a JSON object (a workspace file VS Code would open). */
const isWorkspace = (text: string) => {
  const data: unknown = parse(text, [], { allowTrailingComma: true });
  return typeof data === "object" && data !== null && !Array.isArray(data);
};

/** A folder's absolute path from a stored one, relative to the file's folder or not. */
const resolve = (base: string, path: string) =>
  isAbsolute(path) ? normalize(path) : normalize(`${base}${separatorFor(base)}${path}`);

/** The path stored for a folder: relative to the file's folder unless they are on different roots. */
function storedPath(base: string, folder: string, slashes: boolean): string {
  const from = normalize(base);
  const to = normalize(folder);
  const fromRoot = rootOf(from);
  if (fromRoot.toLowerCase() !== rootOf(to).toLowerCase()) return to;
  const windows = isWindowsPath(from);
  const same = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  const fromParts = from.slice(fromRoot.length).split(/[\\/]/).filter(Boolean);
  const toParts = to.slice(fromRoot.length).split(/[\\/]/).filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < toParts.length && same(fromParts[common], toParts[common])) common++;
  const parts = [...fromParts.slice(common).map(() => ".."), ...toParts.slice(common)];
  return parts.length === 0 ? "." : parts.join(slashes ? "/" : "\\");
}

/** The root of a normalized path: `/`, `C:\` or `\\server\share\`. */
function rootOf(path: string): string {
  if (/^[A-Za-z]:/.test(path)) return path.slice(0, 3);
  const unc = /^\\\\[^\\]+\\[^\\]+\\?/.exec(path);
  return unc ? unc[0] : "/";
}

/**
 * The folders a workspace file lists, as absolute paths: relative ones are taken from the file's
 * folder, as VS Code does. Remote (`uri`) folders and broken entries are left out; none when the
 * text is not a workspace. VS Code writes these files with comments and trailing commas.
 */
export function parseWorkspaceFile(text: string, filePath: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(withoutTrailingCommas(withoutComments(text)));
  } catch {
    return [];
  }
  const folders = (data as { folders?: unknown } | null)?.folders;
  if (!Array.isArray(folders)) return [];
  const base = folderOf(filePath);
  const found: string[] = [];
  for (const folder of folders) {
    const path = (folder as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !path.trim()) continue;
    const resolved = resolve(base, path);
    if (!found.includes(resolved)) found.push(resolved);
  }
  return found;
}

const isWindowsPath = (path: string) => /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith("\\\\");
const isAbsolute = (path: string) => isWindowsPath(path) || path.startsWith("/");
const separatorFor = (path: string) => (isWindowsPath(path) ? "\\" : "/");

/** The folder holding a file. */
function folderOf(file: string): string {
  const index = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return index <= 0 ? file.slice(0, index + 1) || "/" : file.slice(0, index);
}

/** An absolute path without `.`, `..`, repeated or trailing separators. */
function normalize(path: string): string {
  const sep = separatorFor(path);
  const root = /^[A-Za-z]:/.test(path) ? `${path.slice(0, 2)}\\` : path.startsWith("\\\\") ? "\\\\" : "/";
  const parts: string[] = [];
  // After the drive (`C:`), the UNC mark (two backslashes) or the leading `/`.
  for (const part of path.slice(root === "/" ? 1 : 2).split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return root + parts.join(sep);
}

/** JSON with comments: the comments removed, strings left as they are. */
function withoutComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end - 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      out += " ";
    } else out += c;
  }
  return out;
}

/** JSON with commas before `}` or `]`: those commas removed, strings left as they are. */
function withoutTrailingCommas(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end - 1;
    } else if (c === "," && /^\s*[}\]]/.test(text.slice(i + 1))) continue;
    else out += c;
  }
  return out;
}

/** The index just after the string that starts at `start`. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}
