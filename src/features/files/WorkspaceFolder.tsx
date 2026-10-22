import { useEffect, useMemo, useRef, useState, type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from "react";
import type { IconPack } from "./iconPacks";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DirDrop } from "../drop/pathDrag";
import type { SftpEntry } from "../sftp/sftpClient";
import { FileTree, isInside, type FileTreeProps, type Reveal } from "./FileTree";
import { GitBadge, gitNameClass } from "./GitBadge";
import { indexGitStatus, rootDecoration, type Decoration, type GitStatusEntry } from "./gitStatus";
import { useGitStatus, type GitStatusOptions } from "./useGitStatus";

interface WorkspaceRootProps {
  name: string;
  path: string;
  open: boolean;
  onToggle: () => void;
  /** Coloured by what changed inside; null for nothing. */
  decoration: Decoration | null;
  /** The title's handlers, as a folder row's: its right-click menu and its drag onto a terminal. */
  titleProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
}

/**
 * A root of a DEV mode workspace with several folders, as in VS Code: a row with a chevron and the
 * folder's name that folds its tree, and a dot coloured by its git changes.
 */
export function WorkspaceRoot({ name, path, open, onToggle, decoration, titleProps, children }: WorkspaceRootProps) {
  return (
    <section className="workspace-root" role="group" aria-label={name}>
      <div className="workspace-root__title" title={path} {...titleProps}>
        <button type="button" className="workspace-root__toggle" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span className={`workspace-root__name${gitNameClass(decoration)}`}>{name}</span>
        </button>
        {decoration && <GitBadge decoration={decoration} />}
      </div>
      {open && children}
    </section>
  );
}

interface WorkspaceFolderProps {
  /** The folder added to the workspace. */
  path: string;
  /** Its name as the root's title. */
  name: string;
  list: (path: string) => Promise<SftpEntry[]>;
  readGit: (root: string) => Promise<GitStatusEntry[]>;
  describeError: (err: unknown) => string;
  /** The panel's git options; `loads` also lists this folder again (refresh, after a change). */
  git: GitStatusOptions;
  selected: string | null;
  onSelect: (entry: SftpEntry) => void;
  onOpen: (entry: SftpEntry) => void;
  /** Renames an entry in place (see FileTree). */
  onRename?: (entry: SftpEntry, name: string) => void;
  rowProps: (entry: SftpEntry) => LiHTMLAttributes<HTMLLIElement>;
  details: boolean;
  /** The icon pack of its tree (Settings → Files). */
  iconPack?: IconPack;
  /** The list's shortcuts on a row (see FileTree). */
  onRowKey?: FileTreeProps["onRowKey"];
  /** The root title's handlers (menu with Remove folder from workspace, drag). */
  titleProps: HTMLAttributes<HTMLDivElement>;
  /** Collapse Folders: changes when every open folder, this root included, should close. */
  collapse: number;
  /** Entries dropped on one of its folders (S2). */
  onDirDrop?: (drop: DirDrop) => void;
  /** A file to show: inside this folder, the root opens and its tree opens down to it. */
  reveal?: Reveal;
}

/** A folder added to the DEV mode workspace: a root with its own tree and its own git status. */
export function WorkspaceFolder(props: WorkspaceFolderProps) {
  const { path, name, list, readGit, describeError, git } = props;
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  // Collapse Folders closes the root itself too.
  const collapsedAt = useRef(props.collapse);
  useEffect(() => {
    if (props.collapse === collapsedAt.current) return;
    collapsedAt.current = props.collapse;
    setOpen(false);
  }, [props.collapse]);

  useEffect(() => {
    let live = true;
    list(path).then(
      (found) => {
        if (!live) return;
        setEntries(found ?? []);
        setError(null);
      },
      (err) => live && setError(describeRef.current(err)),
    );
    return () => {
      live = false;
    };
  }, [list, path, git.loads]);

  const revealId = props.reveal?.id;
  useEffect(() => {
    if (props.reveal && isInside(props.reveal.path, path)) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId]);

  const gitEntries = useGitStatus(readGit, path, git);
  const gitIndex = useMemo(() => indexGitStatus(gitEntries), [gitEntries]);

  return (
    <WorkspaceRoot
      name={name}
      path={path}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      decoration={rootDecoration(gitEntries)}
      titleProps={props.titleProps}
    >
      {error ? (
        <p className="sidebar__note form-error" role="alert">
          {error}
        </p>
      ) : (
        <FileTree
          entries={entries}
          list={list}
          describeError={describeError}
          loads={git.loads}
          selected={props.selected}
          onSelect={props.onSelect}
          onOpen={props.onOpen}
          onRename={props.onRename}
          details={props.details}
          iconPack={props.iconPack}
          onRowKey={props.onRowKey}
          gitIndex={gitIndex}
          rowProps={props.rowProps}
          collapse={props.collapse}
          dropDir={props.onDirDrop ? path : undefined}
          reveal={props.reveal}
          onDirDrop={props.onDirDrop}
        />
      )}
    </WorkspaceRoot>
  );
}
