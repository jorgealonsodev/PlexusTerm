import { useEffect, useMemo, useRef, useState, type LiHTMLAttributes } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useT } from "../../i18n/i18n";
import type { SftpEntry } from "../sftp/sftpClient";
import { FileTree } from "./FileTree";
import { indexGitStatus, type GitStatusEntry } from "./gitStatus";
import { useGitStatus, type GitStatusOptions } from "./useGitStatus";

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

/**
 * A folder added to the DEV mode workspace, as a VS Code workspace root: a title that folds it and
 * removes it, and its own tree with its own git status under the panel's main folder.
 */
export function WorkspaceFolder(props: WorkspaceFolderProps) {
  const { path, name, list, readGit, describeError, git, onRemove } = props;
  const t = useT();
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
    <section className="workspace-folder" role="group" aria-label={name}>
      <div className="workspace-folder__header" title={path}>
        <button type="button" className="workspace-folder__toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          <span className="workspace-folder__name">{name}</span>
        </button>
        <button
          type="button"
          className="workspace-folder__remove"
          aria-label={t("sftp.panel.workspace.remove")}
          title={t("sftp.panel.workspace.remove")}
          onClick={onRemove}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {open &&
        (error ? (
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
        ))}
    </section>
  );
}
