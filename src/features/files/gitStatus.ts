/**
 * Git status of the entries in the file lists, decorated like VS Code's Explorer
 * (microsoft/vscode, extensions/git/src/repository.ts): a letter, a colour, a tooltip, deleted
 * files struck through, ignored ones faded, and folders coloured like their most important
 * descendant.
 */

/** A file's status as the backend reports it, named after VS Code's `Status`. */
export type GitFileStatus =
  | "indexModified"
  | "indexAdded"
  | "indexDeleted"
  | "indexRenamed"
  | "indexCopied"
  | "indexTypeChanged"
  | "modified"
  | "deleted"
  | "untracked"
  | "ignored"
  | "intentToAdd"
  | "intentToRename"
  | "typeChanged"
  | "addedByUs"
  | "addedByThem"
  | "deletedByUs"
  | "deletedByThem"
  | "bothAdded"
  | "bothDeleted"
  | "bothModified";

/**
 * One status under the listed folder: `path` is relative to it and `/`-separated; a trailing `/`
 * is a whole folder (untracked or ignored as a block); `""` means the listed folder is inside one.
 */
export interface GitStatusEntry {
  path: string;
  status: GitFileStatus;
}

/** VS Code's `gitDecoration.*ResourceForeground` colours, as CSS variables `--git-<color>`. */
export type GitColor =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked"
  | "ignored"
  | "stageModified"
  | "stageDeleted"
  | "conflicting";

/** Tooltip of a status: `sftp.git.<label>`. */
export type GitLabel =
  | "modified"
  | "stagedModified"
  | "added"
  | "deleted"
  | "stagedDeleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "untracked"
  | "ignored"
  | "conflict";

interface StatusInfo {
  letter: string;
  color: GitColor;
  label: GitLabel;
  /** VS Code's priority when one file has several statuses: conflict 4, ignored 3, modified 2, others 1. */
  priority: number;
}

const CONFLICT: StatusInfo = { letter: "!", color: "conflicting", label: "conflict", priority: 4 };

const INFO: Record<GitFileStatus, StatusInfo> = {
  indexModified: { letter: "M", color: "stageModified", label: "stagedModified", priority: 2 },
  modified: { letter: "M", color: "modified", label: "modified", priority: 2 },
  indexAdded: { letter: "A", color: "added", label: "added", priority: 1 },
  intentToAdd: { letter: "A", color: "added", label: "added", priority: 1 },
  indexDeleted: { letter: "D", color: "stageDeleted", label: "stagedDeleted", priority: 1 },
  deleted: { letter: "D", color: "deleted", label: "deleted", priority: 1 },
  indexRenamed: { letter: "R", color: "renamed", label: "renamed", priority: 1 },
  intentToRename: { letter: "R", color: "renamed", label: "renamed", priority: 1 },
  indexCopied: { letter: "C", color: "renamed", label: "copied", priority: 2 },
  indexTypeChanged: { letter: "T", color: "modified", label: "typeChanged", priority: 2 },
  typeChanged: { letter: "T", color: "modified", label: "typeChanged", priority: 2 },
  untracked: { letter: "U", color: "untracked", label: "untracked", priority: 1 },
  ignored: { letter: "I", color: "ignored", label: "ignored", priority: 3 },
  addedByUs: CONFLICT,
  addedByThem: CONFLICT,
  deletedByUs: CONFLICT,
  deletedByThem: CONFLICT,
  bothAdded: CONFLICT,
  bothDeleted: CONFLICT,
  bothModified: CONFLICT,
};

const isDeleted = (status: GitFileStatus) => status === "deleted" || status === "indexDeleted";

/** Like VS Code, deleted and ignored entries do not colour the folders above them. */
const propagates = (status: GitFileStatus) => !isDeleted(status) && status !== "ignored";

/** How an entry is decorated; a folder coloured by its contents has no letter (a dot is shown). */
export interface Decoration {
  status: GitFileStatus;
  letter: string | null;
  color: GitColor;
  label: GitLabel;
  strike: boolean;
  faded: boolean;
}

/** The statuses of one list, indexed so each row is decorated without scanning them all. */
export interface GitStatusIndex {
  /** Statuses of exact paths, in the backend's order (index column first). */
  own: Map<string, GitFileStatus[]>;
  /** Folder blocks (`dir/`, or `""` for the whole list) and their statuses. */
  blocks: [string, GitFileStatus][];
  /** The most important propagating status below each folder path. */
  folders: Map<string, GitFileStatus>;
}

/** The more important of two statuses; on a tie the later one (the working tree) wins. */
const pick = (current: GitFileStatus | undefined, next: GitFileStatus) =>
  current === undefined || INFO[next].priority >= INFO[current].priority ? next : current;

export function indexGitStatus(entries: GitStatusEntry[]): GitStatusIndex {
  const own = new Map<string, GitFileStatus[]>();
  const blocks: [string, GitFileStatus][] = [];
  const folders = new Map<string, GitFileStatus>();
  for (const { path, status } of entries) {
    if (path === "" || path.endsWith("/")) blocks.push([path, status]);
    else own.set(path, [...(own.get(path) ?? []), status]);
    if (!propagates(status)) continue;
    // Every folder above the entry (a block also colours the folders above itself).
    const parts = path.replace(/\/$/, "").split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      folders.set(folder, pick(folders.get(folder), status));
    }
  }
  return { own, blocks, folders };
}

const decoration = (status: GitFileStatus, isDir: boolean): Decoration => {
  const info = INFO[status];
  return {
    status,
    letter: isDir ? null : info.letter,
    color: info.color,
    label: info.label,
    strike: isDeleted(status),
    faded: status === "ignored",
  };
};

/** The decoration of the entry at `path` (relative to the listed folder), or null for none. */
export function decorationFor(index: GitStatusIndex, path: string, isDir: boolean): Decoration | null {
  let best: GitFileStatus | undefined;
  for (const status of index.own.get(path) ?? []) best = pick(best, status);
  for (const [block, status] of index.blocks) {
    if (block === "" || `${path}/`.startsWith(block)) best = pick(best, status);
  }
  if (best !== undefined) return decoration(best, isDir);
  const below = isDir ? index.folders.get(path) : undefined;
  return below === undefined ? null : decoration(below, true);
}
