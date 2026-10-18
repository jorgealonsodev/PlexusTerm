/**
 * DEV mode workspaces saved to a file, in VS Code's `.code-workspace` format, so the same file
 * opens the same folders in both: `{ "folders": [{ "path": "..." }] }`.
 */

export const WORKSPACE_EXTENSION = "code-workspace";

/** The file's text for these folders (absolute paths). */
export function workspaceFileText(folders: readonly string[]): string {
  return `${JSON.stringify({ folders: folders.map((path) => ({ path })) }, null, 2)}\n`;
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
    const resolved = isAbsolute(path) ? normalize(path) : normalize(`${base}${separatorFor(base)}${path}`);
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
