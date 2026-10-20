import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type LiHTMLAttributes } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../../i18n/i18n";
import type { SftpEntry } from "../sftp/sftpClient";
import { DIR_DROP_EVENT, type DirDrop } from "../drop/pathDrag";
import { formatDate, formatSize } from "../sftp/format";
import { FileTypeIcon } from "./FileTypeIcon";
import { GitBadge, gitNameClass } from "./GitBadge";
import { decorationFor, type GitStatusIndex } from "./gitStatus";

interface FileTreeProps {
  /** The listed folder's entries (its children are listed lazily as folders open). */
  entries: SftpEntry[];
  /** Lists a folder's entries when it is first opened, and again on each `loads` change. */
  list: (path: string) => Promise<SftpEntry[]>;
  describeError: (err: unknown) => string;
  /** Changes each time the list is loaded again (refresh, after a change): open folders are listed again. */
  loads: number;
  selected: string | null;
  onSelect: (entry: SftpEntry) => void;
  /** Double-click or Enter on a file, double-click on a folder (the list's own "open"). */
  onOpen: (entry: SftpEntry) => void;
  /** The list's own handlers for a row: context menu, drag, middle click. */
  rowProps: (entry: SftpEntry) => LiHTMLAttributes<HTMLLIElement>;
  details: boolean;
  gitIndex: GitStatusIndex;
  /** Changes each time every open folder should close (the Explorer's Collapse Folders). */
  collapse?: number;
  /**
   * The listed folder: with it, entries dragged onto a folder row (a file row stands for its own
   * folder, the list's empty space for this one) are handed to `onDirDrop` (S2).
   */
  dropDir?: string;
  onDirDrop?: (drop: DirDrop) => void;
}

type Children = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; entries: SftpEntry[] };

type Row =
  | { kind: "entry"; entry: SftpEntry; depth: number; rel: string; parent: string | null }
  | { kind: "note"; key: string; depth: number; text: string; error: boolean };

/**
 * A folder's entries as a tree, like VS Code's Explorer: folders open and close in place with a
 * chevron, their children indented under thin guide lines and listed only when first opened. The
 * open folders stay open while the tree shows the same folder (key it by that folder), and are
 * listed again when the list is.
 */
export function FileTree({
  entries,
  list,
  describeError,
  loads,
  selected,
  onSelect,
  onOpen,
  rowProps,
  details,
  gitIndex,
  collapse = 0,
  dropDir,
  onDirDrop,
}: FileTreeProps) {
  const t = useT();
  const treeRef = useRef<HTMLUListElement>(null);
  const onDirDropRef = useRef(onDirDrop);
  onDirDropRef.current = onDirDrop;
  // Listening from the moment the rows are in the page (a layout effect runs before they are
  // painted): a drop on a row that is already shown is never missed.
  useLayoutEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const listener = (e: Event) => onDirDropRef.current?.((e as CustomEvent<DirDrop>).detail);
    tree.addEventListener(DIR_DROP_EVENT, listener);
    return () => tree.removeEventListener(DIR_DROP_EVENT, listener);
  }, []);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [children, setChildren] = useState<Record<string, Children>>({});
  const collapsedAt = useRef(collapse);
  useEffect(() => {
    if (collapse === collapsedAt.current) return;
    collapsedAt.current = collapse;
    setExpanded(new Set());
  }, [collapse]);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const seq = useRef(new Map<string, number>());
  const listRef = useRef(list);
  listRef.current = list;
  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  /** Lists a folder; while listing again, what it showed stays on screen. */
  const load = useCallback((path: string, again: boolean) => {
    const n = (seq.current.get(path) ?? 0) + 1;
    seq.current.set(path, n);
    if (!again) setChildren((prev) => ({ ...prev, [path]: { state: "loading" } }));
    listRef
      .current(path)
      .then(
        (found): Children => ({ state: "ok", entries: found ?? [] }),
        (err): Children => ({ state: "error", message: describeRef.current(err) }),
      )
      .then((result) => {
        if (seq.current.get(path) === n) setChildren((prev) => ({ ...prev, [path]: result }));
      });
  }, []);

  // The list was loaded again: so are the open folders.
  const current = useRef({ expanded, children });
  current.current = { expanded, children };
  const firstLoads = useRef(loads);
  useEffect(() => {
    if (loads === firstLoads.current) return;
    for (const path of current.current.expanded) if (current.current.children[path]) load(path, true);
  }, [loads, load]);

  const setOpen = (entry: SftpEntry, open: boolean) => {
    if (entry.kind !== "dir" || expanded.has(entry.path) === open) return;
    const next = new Set(expanded);
    if (open) {
      next.add(entry.path);
      if (!children[entry.path] || children[entry.path].state === "error") load(entry.path, false);
    } else next.delete(entry.path);
    setExpanded(next);
  };
  const toggle = (entry: SftpEntry) => setOpen(entry, !expanded.has(entry.path));

  const rows: Row[] = [];
  const walk = (items: SftpEntry[], depth: number, parentRel: string, parent: string | null) => {
    for (const entry of items) {
      const rel = parentRel ? `${parentRel}/${entry.name}` : entry.name;
      rows.push({ kind: "entry", entry, depth, rel, parent });
      if (entry.kind !== "dir" || !expanded.has(entry.path)) continue;
      const inside = children[entry.path];
      if (!inside || inside.state === "loading") {
        rows.push({ kind: "note", key: `${entry.path}\0loading`, depth: depth + 1, text: t("sftp.tree.loading"), error: false });
      } else if (inside.state === "error") {
        rows.push({ kind: "note", key: `${entry.path}\0error`, depth: depth + 1, text: inside.message, error: true });
      } else walk(inside.entries, depth + 1, rel, entry.path);
    }
  };
  walk(entries, 0, "", null);
  const entryRows = rows.filter((r): r is Extract<Row, { kind: "entry" }> => r.kind === "entry");

  const focusRow = (path: string | null | undefined) => {
    const row = entryRows.find((r) => r.entry.path === path);
    if (!row) return;
    rowRefs.current.get(row.entry.path)?.focus();
    onSelect(row.entry);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, row: Extract<Row, { kind: "entry" }>) => {
    const { entry } = row;
    const index = entryRows.indexOf(row);
    const open = entry.kind === "dir" && expanded.has(entry.path);
    switch (e.key) {
      case "ArrowDown":
        focusRow(entryRows[index + 1]?.entry.path);
        break;
      case "ArrowUp":
        focusRow(entryRows[index - 1]?.entry.path);
        break;
      case "ArrowRight":
        if (entry.kind !== "dir") return;
        if (!open) setOpen(entry, true);
        else if (entryRows[index + 1]?.parent === entry.path) focusRow(entryRows[index + 1].entry.path);
        break;
      case "ArrowLeft":
        if (open) setOpen(entry, false);
        else focusRow(row.parent);
        break;
      case "Enter":
        if (entry.kind === "dir") toggle(entry);
        else onOpen(entry);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  /** One thin vertical line per level above the row. */
  const guides = (depth: number) =>
    depth > 0 && (
      <span className="tree-indent" aria-hidden="true">
        {Array.from({ length: depth }, (_, i) => (
          <span key={i} className="tree-guide" />
        ))}
      </span>
    );

  return (
    <ul className="sftp__list" role="tree" ref={treeRef} data-drop-dir={dropDir}>
      {rows.map((row) => {
        if (row.kind === "note") {
          return (
            <li key={row.key} className={`sftp-row sftp-row--note${row.error ? " form-error" : ""}`} role="none">
              {guides(row.depth)}
              <span className="tree-chevron" aria-hidden="true" />
              <span className="sftp-row__name" role={row.error ? "alert" : undefined}>
                {row.text}
              </span>
            </li>
          );
        }
        const { entry, depth, rel, parent } = row;
        const isDir = entry.kind === "dir";
        const open = isDir && expanded.has(entry.path);
        const decoration = decorationFor(gitIndex, rel, isDir);
        return (
          <li
            key={entry.path}
            ref={(el) => {
              if (el) rowRefs.current.set(entry.path, el);
              else rowRefs.current.delete(entry.path);
            }}
            className={`sftp-row${entry.path === selected ? " sftp-row--selected" : ""}${decoration?.faded ? " sftp-row--faded" : ""}`}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={isDir ? open : undefined}
            aria-selected={entry.path === selected}
            tabIndex={0}
            title={entry.path}
            data-drop-dir={dropDir === undefined ? undefined : isDir ? entry.path : (parent ?? dropDir)}
            {...rowProps(entry)}
            onClick={() => {
              onSelect(entry);
              if (isDir) toggle(entry);
            }}
            onDoubleClick={() => onOpen(entry)}
            onKeyDown={(e) => onKeyDown(e, row)}
          >
            {guides(depth)}
            <span className="tree-chevron" aria-hidden="true">
              {isDir && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
            </span>
            <FileTypeIcon name={entry.name} kind={entry.kind} open={open} />
            <span className={`sftp-row__name${gitNameClass(decoration)}`}>{entry.name}</span>
            {decoration && <GitBadge decoration={decoration} />}
            {details && (
              <>
                <span className="sftp-row__size">{isDir ? "" : formatSize(entry.size)}</span>
                <span className="sftp-row__date">{entry.modified ? formatDate(entry.modified) : ""}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
