import type { IBufferLine, ILink, ILinkHandler, ILinkProvider } from "@xterm/xterm";

/** How a pane turns a path printed in it into a file: resolve it (null when no such file), open it. */
export interface FileLinks {
  /** The file `text` names, as an absolute path, or null when it does not exist. */
  resolve: (text: string) => Promise<string | null>;
  open: (path: string) => void;
}

/** A path printed in a line: its place in the line's text and its text. */
export interface PathCandidate {
  start: number;
  end: number;
  text: string;
}

/**
 * Paths with at least one folder in them (`docs/PRD.md`, `./src/a.ts`, `~/notes/a.txt`,
 * `/etc/hosts`, `C:\Users\me\a.txt`): a bare word such as `README.md` is too often not a file.
 */
const PATH = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)?[\w.@+\-]+(?:[\\/][\w.@+\-]+)+/g;

/** A file name with an extension (`README.md`), alone: it becomes a link only when the file exists. */
const BARE = /[\w@+\-]+(?:\.[\w@+\-]+)*\.[A-Za-z][A-Za-z0-9]{0,9}/g;

/** URLs, left to the web links (quick select finds them with this too). */
export const URLS = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * The paths and file names in a line of terminal text, in order, without line numbers or a
 * sentence's final dot; nothing inside a URL (those are web links).
 */
export function findPathCandidates(text: string): PathCandidate[] {
  const taken = [...text.matchAll(URLS)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const free = (start: number, end: number) => taken.every((span) => end <= span.start || start >= span.end);
  const found: PathCandidate[] = [];
  const add = (start: number, raw: string, needsFolder: boolean) => {
    // A `:line:column` suffix is not part of the match; a sentence's final dot or comma is dropped.
    const path = raw.replace(/[.,]+$/, "");
    if (needsFolder && !/[\\/][\w@+\-]/.test(path)) return;
    const end = start + path.length;
    if (!free(start, end)) return;
    found.push({ start, end, text: path });
    taken.push({ start, end });
  };
  for (const match of text.matchAll(PATH)) add(match.index, match[0], true);
  for (const match of text.matchAll(BARE)) add(match.index, match[0], false);
  return found.sort((a, b) => a.start - b.start);
}

/** The path a `file:` URI names, decoded (`file:///C:/x` is `C:/x`), or null for other URIs. */
export function fileUriPath(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

/** Links open on Ctrl+click (Cmd+click on macOS), as in editors: a plain click stays a selection. */
const opensLink = (event: MouseEvent) => event.ctrlKey || event.metaKey;

/** The handler of the web links (URLs in the text): the browser opens one on Ctrl+click. */
export const webLinkHandler = (openUrl: (url: string) => void) => (event: MouseEvent, uri: string) => {
  if (opensLink(event)) openUrl(uri);
};

/**
 * The handler of the hyperlinks a program prints (OSC 8, such as an AI tool's links on file
 * names): on Ctrl+click, web links open in the browser and `file:` links as files, when the pane
 * can open them (`openFile` gives the opener, or nothing); other schemes are ignored.
 */
export function createLinkHandler({
  openUrl,
  openFile,
}: {
  openUrl: (url: string) => void;
  openFile: () => ((path: string) => void) | undefined;
}): ILinkHandler {
  return {
    allowNonHttpProtocols: true,
    activate: (event, text) => {
      if (!opensLink(event)) return;
      const file = fileUriPath(text);
      if (file !== null) openFile()?.(file);
      else if (/^https?:\/\//i.test(text)) openUrl(text);
    },
  };
}

const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]/.test(path);

/**
 * `text` as an absolute path: kept when absolute, `~` replaced by `home`, otherwise joined to
 * `folder`; `.` and `..` are resolved. Null when the folder or home it needs is unknown.
 */
export function resolvePath(text: string, folder: string | null, home: string | null): string | null {
  let full: string;
  if (text.startsWith("/") || isWindowsPath(text)) full = text;
  else if (/^~[\\/]/.test(text)) {
    if (home === null) return null;
    full = `${home}${text.slice(1)}`;
  } else {
    if (folder === null) return null;
    full = `${folder}${isWindowsPath(folder) ? "\\" : "/"}${text}`;
  }
  const windows = isWindowsPath(full);
  const sep = windows ? "\\" : "/";
  const [root, ...rest] = windows ? [full.slice(0, 2), ...full.slice(3).split(/[\\/]/)] : ["", ...full.slice(1).split("/")];
  const parts: string[] = [];
  for (const part of rest) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${root}${sep}${parts.join(sep)}`;
}

/** The cells of one terminal line: what each prints and how many columns it takes (0 for the second half of a wide one). */
export interface LineCells {
  cells: { chars: string; width: number }[];
}

/** The cells of buffer line `line`, for `createFileLinkProvider`. */
export function cellsOf(line: IBufferLine | undefined): LineCells | null {
  if (!line) return null;
  const cells: LineCells["cells"] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (cell) cells.push({ chars: cell.getChars() || " ", width: cell.getWidth() });
  }
  return { cells };
}

/**
 * Links over the paths of a line that name existing files (S: Ctrl+click opens them). Only
 * Ctrl+click (Cmd+click on macOS) opens one, as in editors: a plain click stays a selection.
 */
export function createFileLinkProvider(lineAt: (y: number) => LineCells | null, fileLinks: FileLinks): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = lineAt(y);
      if (!line) return callback(undefined);
      // The line's text, and the 1-based column where each of its characters starts.
      let text = "";
      const columns: number[] = [];
      let column = 1;
      for (const cell of line.cells) {
        if (cell.width === 0) continue;
        for (const char of cell.chars) {
          text += char;
          columns.push(column);
        }
        column += cell.width;
      }
      const candidates = findPathCandidates(text);
      if (candidates.length === 0) return callback(undefined);
      void Promise.all(
        candidates.map(async (candidate): Promise<ILink | null> => {
          const path = await fileLinks.resolve(candidate.text).catch(() => null);
          if (path === null) return null;
          return {
            text: candidate.text,
            range: { start: { x: columns[candidate.start], y }, end: { x: columns[candidate.end - 1], y } },
            decorations: { underline: true, pointerCursor: true },
            activate: (event) => {
              if (opensLink(event)) fileLinks.open(path);
            },
          };
        }),
      ).then((links) => {
        const found = links.filter((link): link is ILink => link !== null);
        callback(found.length > 0 ? found : undefined);
      });
    },
  };
}
