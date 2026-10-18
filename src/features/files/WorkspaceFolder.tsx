import { useEffect, useMemo, useRef, useState, type LiHTMLAttributes, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import type { SftpEntry } from "../sftp/sftpClient";
import { FileTree } from "./FileTree";
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
  /** Given, the title's right-click menu removes the folder from the workspace. */
  onRemove?: () => void;
  children: ReactNode;
}

/**
 * A root of a DEV mode workspace with several folders, as in VS Code: a row with a chevron and the
 * folder's name that folds its tree, and a dot coloured by its git changes.
 */
export function WorkspaceRoot({ name, path, open, onToggle, decoration, onRemove, children }: WorkspaceRootProps) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <section className="workspace-root" role="group" aria-label={name}>
      <div
        className="workspace-root__title"
        title={path}
        onContextMenu={(e) => {
          e.preventDefault();
          if (onRemove) setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <button type="button" className="workspace-root__toggle" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span className={`workspace-root__name${gitNameClass(decoration)}`}>{name}</span>
        </button>
        {decoration && <GitBadge decoration={decoration} />}
      </div>
      {open && children}
      {menu && onRemove && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: t("sftp.panel.workspace.remove"), onSelect: onRemove }]}
          onClose={() => setMenu(null)}
        />
      )}
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
  rowProps: (entry: SftpEntry) => LiHTMLAttributes<HTMLLIElement>;
  details: boolean;
  onRemove: () => void;
}

/** A folder added to the DEV mode workspace: a root with its own tree and its own git status. */
export function WorkspaceFolder(props: WorkspaceFolderProps) {
  const { path, name, list, readGit, describeError, git } = props;
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const describeRef = useRef(describeError);
  describeRef.current = describeError;

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

  const gitEntries = useGitStatus(readGit, path, git);
  const gitIndex = useMemo(() => indexGitStatus(gitEntries), [gitEntries]);

  return (
    <WorkspaceRoot
      name={name}
      path={path}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      decoration={rootDecoration(gitEntries)}
      onRemove={props.onRemove}
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
          details={props.details}
          gitIndex={gitIndex}
          rowProps={props.rowProps}
        />
      )}
    </WorkspaceRoot>
  );
}
