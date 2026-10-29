/**
 * Completes the path typed at the end of a command line from the files of its folder, as inline
 * suggestions draw it in grey: `./` in a folder with one script suggests its name, `cd n` a folder.
 */

export interface FolderEntry {
  name: string;
  kind: "file" | "dir" | "symlink";
}

/** The folder to list and the start of the name typed in it. */
export interface PathQuery {
  folder: string;
  prefix: string;
  /** `cd` and `pushd` take folders only. */
  dirsOnly: boolean;
  windows: boolean;
}

const DIR_COMMANDS = new Set(["cd", "pushd"]);
/** Quotes, variables and escapes make the typed word differ from the path: those are left to Tab. */
const UNSURE = /["'$`]/;
/** Characters a POSIX shell needs escaped in a word. */
const SPECIAL = /[\s'"\\$`!&;|()<>*?[\]{}#~]/g;

const join = (folder: string, rest: string, sep: string) =>
  !rest ? folder : folder.endsWith("/") || folder.endsWith("\\") ? folder + rest : folder + sep + rest;

/**
 * What to list for `line`, typed in `cwd`; null when its last word is not a path being typed: the
 * command itself (unless it has a slash, like `./`), an empty word, or one with quotes or escapes.
 * `home` resolves `~/`; without it such a word gets no completion.
 */
export function pathQuery(line: string, cwd: string, home: string | null, windows: boolean): PathQuery | null {
  const words = line.split(/\s+/);
  const word = words[words.length - 1];
  if (!word || UNSURE.test(word) || (!windows && word.includes("\\"))) return null;
  // An open quote or an escaped space before it: the word is part of a longer one.
  const quotes = (q: string) => line.split(q).length - 1;
  if (quotes('"') % 2 === 1 || quotes("'") % 2 === 1) return null;
  if (!windows && line[line.length - word.length - 2] === "\\") return null;
  const isSep = (c: string) => c === "/" || (windows && c === "\\");
  let cut = -1;
  for (let i = word.length - 1; i >= 0; i--) {
    if (isSep(word[i])) {
      cut = i;
      break;
    }
  }
  // The first word is a command, found in PATH, not in the folder.
  if (words.length === 1 && cut < 0) return null;
  const dir = word.slice(0, cut + 1);
  const prefix = word.slice(cut + 1);
  const sep = windows ? "\\" : "/";
  let folder: string;
  if (dir === "") folder = cwd;
  else if (dir.startsWith("~")) {
    if (home === null || !(dir === "~/" || dir.startsWith("~/") || (windows && dir.startsWith("~\\")))) return null;
    folder = join(home, dir.slice(2), sep);
  } else if (dir.startsWith("/") || (windows && /^([a-zA-Z]:)?[\\/]/.test(dir))) folder = dir;
  else folder = join(cwd, dir, sep);
  return { folder, prefix, dirsOnly: words.length > 1 && DIR_COMMANDS.has(words[0]), windows };
}

/**
 * The rest of the name `query` starts, from the folder's `entries`: the whole name (with a slash
 * after a folder) when one entry matches, or what all the matches share. Hidden names only when
 * the prefix starts with a dot. Null when nothing is left to suggest.
 */
export function pathCompletion(query: PathQuery, entries: FolderEntry[]): string | null {
  const { prefix, windows } = query;
  const fold = (s: string) => (windows ? s.toLowerCase() : s);
  const matches = entries.filter(
    (e) =>
      e.name !== "." &&
      e.name !== ".." &&
      (prefix.startsWith(".") || !e.name.startsWith(".")) &&
      (!query.dirsOnly || e.kind !== "file") &&
      fold(e.name).startsWith(fold(prefix)),
  );
  if (matches.length === 0) return null;
  let rest: string;
  if (matches.length === 1) {
    const [only] = matches;
    rest = only.name.slice(prefix.length) + (only.kind === "dir" ? (windows ? "\\" : "/") : "");
  } else {
    let shared = matches[0].name;
    for (const { name } of matches) {
      let i = 0;
      while (i < shared.length && i < name.length && fold(shared[i]) === fold(name[i])) i++;
      shared = shared.slice(0, i);
    }
    rest = shared.slice(prefix.length);
  }
  if (!rest) return null;
  // cmd and PowerShell need quotes around a name with spaces: left to Tab.
  if (windows) return /\s/.test(rest) ? null : rest;
  return rest.replace(SPECIAL, (c) => `\\${c}`);
}
