import { useCallback, useEffect, useMemo, useRef, useState, type LiHTMLAttributes } from "react";
import { ToolButton } from "../files/ToolButton";
import { GitBranch, Laptop } from "lucide-react";
import { ChevronsDownUp, FilePlus, FolderInput, FolderOpen, FolderPlus, Pencil, Save, Trash2, RefreshCw } from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useDialogs } from "../dialogs/DialogProvider";
import { useT } from "../../i18n/i18n";
import { startPathDrag, type DirDrop } from "../drop/pathDrag";
import { movesInto } from "../drop/dirDrop";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { writeText } from "../terminal/clipboard";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { PermissionsDialog } from "../sftp/PermissionsDialog";
import { PropertiesDialog } from "../sftp/PropertiesDialog";
import type { OpenWith, SftpEntry } from "../sftp/sftpClient";
import { describeLocalError, local } from "./localClient";
import { basename, isRoot, joinPath, parentPath, validName } from "./localPath";
import { HelpTip } from "../sidebar/HelpTip";
import { FileTree } from "../files/FileTree";
import { FlatFileList } from "../files/FlatFileList";
import { indexGitStatus, rootDecoration } from "../files/gitStatus";
import { useGitStatus, type GitStatusOptions } from "../files/useGitStatus";
import { WorkspaceFolder, WorkspaceRoot } from "../files/WorkspaceFolder";
import { parseWorkspaceFile, WORKSPACE_EXTENSION, workspaceFileText } from "../files/workspaceFile";

interface LocalPanelProps {
  /** Folder of the active local terminal (OSC 7 or read from its shell); null while unknown. */
  cwd: string | null;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Types a path into the focused terminal pane, quoted for its shell; without it the item is disabled. */
  onPathToTerminal?: (path: string) => void;
  /** Text editor chosen in Settings; empty or missing uses the system's default one. */
  textEditor?: string;
  /** Called with the folder the user opened (path bar, a folder, Up, Home), never when following. */
  onUserNavigate?: (path: string) => void;
  /** Show each entry's size and date (Settings → Files); hidden when missing. */
  details?: boolean;
  /** Colour entries by their git status (Settings → Files), refreshed with the terminal; off when missing. */
  git?: Omit<GitStatusOptions, "loads">;
  /**
   * DEV mode's look: a VS Code-like tree with file-type icons and git status colours. Off (the
   * default), the plain list, which never reads git.
   */
  devStyle?: boolean;
  /** Where the list starts when it does not follow the terminal (DEV mode's project); home otherwise. */
  startAt?: string | null;
  /** Opens a new terminal tab in a folder ("Open in terminal"); without it the item is disabled. */
  onOpenInTerminal?: (path: string) => void;
  /** Shows a file in the file viewer next to the terminal; without it there is no View item. */
  onView?: (path: string) => void;
  /** DEV mode's workspace: folders added under the main one, as roots of their own (like VS Code's). */
  workspace?: Workspace;
}

export interface Workspace {
  folders: readonly string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  /** Opens the folders a workspace file lists (the first one is the main folder). */
  onOpenFolders: (folders: string[]) => void;
}

/** File browser of the local disk (S3), optionally following the active local terminal's folder. */
export function LocalPanel({ cwd, follow, onFollowChange, onPathToTerminal, textEditor, details = false, onUserNavigate, git, onOpenInTerminal, devStyle = false, startAt = null, onView, workspace }: LocalPanelProps) {
  const t = useT();
  const dialogs = useDialogs();
  const platform = usePlatform();
  const [path, setPath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<SftpEntry | null>(null);
  const selected = selectedEntry?.path ?? null;
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "properties" | "permissions"; entry: SftpEntry } | null>(null);
  /** Counts listings, so the git status is read again after each one. */
  const [loads, setLoads] = useState(0);
  /** Bumped by Collapse Folders (DEV mode): every open folder of the tree closes. */
  const [collapse, setCollapse] = useState(0);
  const onUserNavigateRef = useRef(onUserNavigate);
  onUserNavigateRef.current = onUserNavigate;
  // Only the latest listing request may update the view.
  const listSeq = useRef(0);
  const current = useRef({ path, entries });
  current.current = { path, entries };

  const navigate = useCallback(async (target: string, user = false) => {
    const seq = ++listSeq.current;
    try {
      const list = await local.list(target);
      if (seq !== listSeq.current) return true;
      setPath(target);
      setInput(target);
      setEntries(list ?? []);
      setLoads((n) => n + 1);
      setSelectedEntry(null);
      setError(null);
      if (user) onUserNavigateRef.current?.(target);
      return true;
    } catch (err) {
      if (seq === listSeq.current) {
        setError(describeLocalError(err));
        setInput(current.current.path ?? "");
      }
      return false;
    }
  }, []);

  const goHome = useCallback(async (user = false) => {
    try {
      await navigate(await local.home(), user);
    } catch (err) {
      setError(describeLocalError(err));
    }
  }, [navigate]);

  /** Runs one operation, reporting progress and errors inline. */
  const act = async (busy: string, operation: () => Promise<unknown>, done: string | null = null) => {
    setStatus(busy);
    setError(null);
    try {
      await operation();
      setStatus(done);
      return true;
    } catch (err) {
      setStatus(null);
      setError(describeLocalError(err));
      return false;
    }
  };

  const refresh = () => current.current.path !== null && void navigate(current.current.path);

  /** Opens a file in a desktop program; the file itself is edited, no copy is made. */
  const openWith = (entry: SftpEntry, how: OpenWith) =>
    void act(t("sftp.status.opening", { name: entry.name }), () => local.open(entry.path, how), t("sftp.status.opened", { name: entry.name }));

  const openEntry = async (entry: SftpEntry) => {
    if (entry.kind === "dir") void navigate(entry.path, true);
    // In DEV mode a file opens in the viewer, as in VS Code.
    else if (entry.kind === "file") devStyle && onView ? onView(entry.path) : openWith(entry, { kind: "default" });
    // A symlink may point to a folder or a file: try to enter it first.
    else if (!(await navigate(entry.path, true))) {
      setError(null);
      openWith(entry, { kind: "default" });
    }
  };

  const newEntry = async (kind: "folder" | "file") => {
    const dir = current.current.path;
    const message = kind === "folder" ? t("sftp.dialog.newFolderName") : t("sftp.dialog.newFileName");
    const name = (await dialogs.prompt({ message, confirmLabel: t("sftp.dialog.create") }))?.trim();
    if (dir === null || !name) return;
    if (!validName(name)) {
      return setError(kind === "folder" ? t("sftp.error.invalidFolderName", { name }) : t("sftp.error.invalidFileName", { name }));
    }
    const target = joinPath(dir, name);
    const create = () => (kind === "folder" ? local.mkdir(target) : local.createFile(target));
    if (await act(t("sftp.status.creating", { name }), create)) await navigate(dir);
  };

  const renameEntry = async (entry: SftpEntry | null) => {
    const dir = current.current.path;
    if (!entry || dir === null) return;
    const name = (
      await dialogs.prompt({
        message: t("sftp.dialog.renameTo", { name: entry.name }),
        defaultValue: entry.name,
        confirmLabel: t("common.rename"),
      })
    )?.trim();
    if (!name || name === entry.name) return;
    if (!validName(name)) return setError(t("sftp.error.invalidName", { name }));
    if (await act(t("sftp.status.renaming", { name: entry.name }), () => local.rename(entry.path, joinPath(parentPath(entry.path), name)))) {
      await navigate(dir);
    }
  };

  const deleteEntry = async (entry: SftpEntry | null) => {
    const dir = current.current.path;
    if (!entry || dir === null) return;
    const isDir = entry.kind === "dir";
    const question = isDir
      ? t("sftp.local.deleteFolder", { name: entry.name })
      : t("sftp.dialog.deleteFile", { name: entry.name });
    if (!(await dialogs.confirm({ message: question, confirmLabel: t("common.delete"), danger: true }))) return;
    if (await act(t("sftp.status.deleting", { name: entry.name }), () => local.remove(entry.path, isDir))) {
      await navigate(dir);
    }
  };

  /** Entries dragged onto a folder of the tree move there, once confirmed (S2, S3). */
  const moveDropped = async ({ drag, dir }: DirDrop) => {
    if (drag.origin.kind !== "local") return;
    const moving = movesInto(drag, dir, parentPath);
    if (moving.length === 0) return;
    const name = moving.map((item) => basename(item.path)).join(", ");
    const question = t("sftp.dialog.moveInto", { name, folder: basename(dir) });
    if (!(await dialogs.confirm({ message: question, confirmLabel: t("sftp.dialog.move") }))) return;
    const move = async () => {
      try {
        for (const item of moving) await local.move(item.path, dir);
      } finally {
        // Whatever moved before a failure is shown where it went; the failure is said after.
        if (current.current.path !== null) await navigate(current.current.path);
      }
    };
    await act(t("sftp.status.moving", { name }), move);
  };

  const pathToTerminal = (entry: SftpEntry) => {
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(entry.path)) return setError(t("sftp.error.unsafePath"));
    onPathToTerminal?.(entry.path);
  };

  const copyPath = (entry: SftpEntry) =>
    void act(t("sftp.status.copyingPath"), () => writeText(entry.path), t("sftp.status.copied", { path: entry.path }));

  const openWithProgram = async (entry: SftpEntry) => {
    try {
      const program = await open({
        title: t("sftp.dialog.openWithTitle", { name: entry.name }),
        multiple: false,
        directory: false,
        defaultPath: programsDir(platform),
      });
      if (typeof program === "string") openWith(entry, { kind: "program", path: program });
    } catch (err) {
      setError(describeLocalError(err));
    }
  };

  const changePermissions = async (entry: SftpEntry, mode: number) => {
    await local.chmod(entry.path, mode);
    if (current.current.path !== null) await navigate(current.current.path);
  };

  const menuItems = (entry: SftpEntry): ContextMenuItem[] => {
    const isFile = entry.kind !== "dir";
    const fileItems: ContextMenuItem[] = isFile
      ? [
          ...(onView ? [{ label: t("sftp.menu.view"), onSelect: () => onView(entry.path) }] : []),
          {
            label: t("sftp.menu.openTextEditor"),
            onSelect: () => openWith(entry, textEditor ? { kind: "textEditor", command: textEditor } : { kind: "textEditor" }),
          },
          { label: t("sftp.menu.openWith"), onSelect: () => void openWithProgram(entry) },
        ]
      : [];
    return [
      { label: t("common.open"), onSelect: () => void openEntry(entry) },
      ...(isFile ? [] : [{ label: t("sftp.menu.openInTerminal"), onSelect: () => onOpenInTerminal?.(entry.path), disabled: !onOpenInTerminal }]),
      ...fileItems,
      { separator: true },
      { label: t("sftp.menu.rename"), onSelect: () => void renameEntry(entry) },
      { label: t("common.delete"), onSelect: () => void deleteEntry(entry), danger: true },
      { separator: true },
      { label: t("sftp.menu.copyPath"), onSelect: () => copyPath(entry) },
      { label: t("sftp.menu.copyPathToTerminal"), onSelect: () => pathToTerminal(entry), disabled: !onPathToTerminal },
      { separator: true },
      { label: t("sftp.menu.properties"), onSelect: () => setDialog({ kind: "properties", entry }) },
      ...(platform === "windows"
        ? []
        : [{ label: t("sftp.menu.permissions"), onSelect: () => setDialog({ kind: "permissions" as const, entry }) }]),
    ];
  };

  // Start in the terminal folder when following it, otherwise in the home folder.
  const start = useRef({ follow, cwd, startAt });
  useEffect(() => {
    const { follow, cwd, startAt } = start.current;
    if (follow && cwd) return;
    void (startAt ? navigate(startAt) : goHome());
  }, [goHome, navigate]);

  useEffect(() => {
    if (follow && cwd) void navigate(cwd);
  }, [cwd, follow, navigate]);

  const listFolder = useCallback((dir: string) => local.list(dir), []);
  const readGit = useCallback((root: string) => local.gitStatus(root), []);
  const gitEntries = useGitStatus(readGit, path, {
    enabled: devStyle && (git?.enabled ?? false),
    visible: git?.visible ?? false,
    prompt: git?.prompt ?? 0,
    loads,
    subscribeOutput: git?.subscribeOutput,
  });
  const gitIndex = useMemo(() => indexGitStatus(gitEntries), [gitEntries]);
  const gitOptions: GitStatusOptions = {
    enabled: devStyle && (git?.enabled ?? false),
    visible: git?.visible ?? false,
    prompt: git?.prompt ?? 0,
    loads,
    subscribeOutput: git?.subscribeOutput,
  };
  const showWorkspace = devStyle && workspace !== undefined;

  // The repository of the selected entry, as VS Code's status bar shows it (DEV mode, git status on).
  const [repo, setRepo] = useState<{ root: string; branch: string; dirty: boolean } | null>(null);
  const readRepo = devStyle && (git?.enabled ?? false) && selected !== null;
  // Another entry (or none) clears it; reading the same entry again keeps it until the answer.
  useEffect(() => setRepo(null), [readRepo, selected]);
  useEffect(() => {
    if (!readRepo || selected === null) return;
    let live = true;
    local
      .repoInfo(selected)
      .then((info) => live && setRepo(info))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [readRepo, selected, git?.prompt, loads]);
  /** With added folders, every folder shows as a root, as in a VS Code workspace. */
  const asRoots = showWorkspace && workspace.folders.length > 0;
  const [mainOpen, setMainOpen] = useState(true);

  /** Collapse Folders: every open folder closes, and with several roots the roots too (as VS Code's). */
  const collapseAll = () => {
    setCollapse((n) => n + 1);
    if (asRoots) setMainOpen(false);
  };

  /** Adds a folder chosen in the system dialog to the workspace, once. */
  const addFolder = async () => {
    if (!workspace) return;
    const dir = await open({ title: t("sftp.panel.workspace.choose"), multiple: false, directory: true }).catch(() => null);
    if (typeof dir !== "string" || workspace.folders.includes(dir)) return;
    workspace.onAdd(dir);
  };

  const workspaceFilters = () => [{ name: t("sftp.panel.workspace.fileType"), extensions: [WORKSPACE_EXTENSION] }];

  /** Saves the main folder and the added ones to a VS Code workspace file. */
  const saveWorkspace = async () => {
    if (!workspace || path === null) return;
    const file = await save({
      defaultPath: joinPath(path, `${basename(path)}.${WORKSPACE_EXTENSION}`),
      filters: workspaceFilters(),
    }).catch(() => null);
    if (!file) return;
    // Over an existing workspace file only its folders change, as in VS Code.
    const existing = await local.readText(file).catch(() => null);
    await local
      .saveText(file, workspaceFileText([path, ...workspace.folders.filter((f) => f !== path)], file, existing))
      .then(() => setStatus(t("sftp.panel.workspace.saved", { file: basename(file) })))
      .catch((err) => setError(describeLocalError(err)));
  };

  /** Opens the folders of a workspace file (VS Code's or one saved here). */
  const openWorkspace = async () => {
    if (!workspace) return;
    const file = await open({ multiple: false, filters: workspaceFilters() }).catch(() => null);
    if (typeof file !== "string") return;
    try {
      const folders = parseWorkspaceFile(await local.readText(file), file);
      if (folders.length === 0) return setError(t("sftp.panel.workspace.noFolders", { file: basename(file) }));
      setError(null);
      workspace.onOpenFolders(folders);
    } catch (err) {
      setError(describeLocalError(err));
    }
  };

  /** A row's own handlers in either list style: menu, drag onto a terminal, middle click. */
  const rowProps = (entry: SftpEntry): LiHTMLAttributes<HTMLLIElement> => ({
    onContextMenu: (e) => {
      e.preventDefault();
      setSelectedEntry(entry);
      setMenu({ x: e.clientX, y: e.clientY, entry });
    },
    // Dragged onto a terminal it changes to the folder or types the path (S4).
    onPointerDown: (e) => startPathDrag(e, { origin: { kind: "local" }, paths: [{ path: entry.path, isDir: entry.kind === "dir" }] }, entry.name),
    // Middle click types the path into the terminal (and never starts autoscroll).
    onMouseDown: (e) => e.button === 1 && e.preventDefault(),
    onAuxClick: (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pathToTerminal(entry);
    },
  });

  const busy = path === null;
  const mainTree = (
    <FileTree
      key={path ?? ""}
      entries={entries}
      list={listFolder}
      describeError={describeLocalError}
      loads={loads}
      selected={selected}
      onSelect={setSelectedEntry}
      onOpen={(entry) => void openEntry(entry)}
      details={details}
      gitIndex={gitIndex}
      rowProps={rowProps}
      collapse={collapse}
      dropDir={path ?? undefined}
      onDirDrop={(drop) => void moveDropped(drop)}
    />
  );

  return (
    <div className="sidebar__panel sftp">
      {/* The path bar and the actions stay at the top: only the list below them scrolls. */}
      <div className="sftp__head">
        <form
          className="sftp__pathbar"
          onSubmit={(e) => {
            e.preventDefault();
            const target = input.trim();
            if (target) void navigate(target, true);
          }}
        >
          <button
            type="button"
            className="btn btn--small"
            title={t("sftp.panel.up")}
            disabled={busy || (path !== null && isRoot(path))}
            onClick={() => path && void navigate(parentPath(path), true)}
          >
            ↑
          </button>
          <button type="button" className="btn btn--small" title={t("sftp.panel.homeFolder")} onClick={() => void goHome(true)}>
            ⌂
          </button>
          <button type="button" className="btn btn--small" title={t("common.refresh")} disabled={busy} onClick={refresh}>
            ⟳
          </button>
          <input
            className="sidebar__search sftp__path"
            aria-label={t("sftp.local.path")}
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </form>
        <div className="sftp__toolbar">
          <ToolButton icon={FolderPlus} label={t("sftp.panel.newFolder")} disabled={busy} onClick={() => void newEntry("folder")} />
          <ToolButton icon={FilePlus} label={t("sftp.panel.newFile")} disabled={busy} onClick={() => void newEntry("file")} />
          <ToolButton icon={Pencil} label={t("common.rename")} disabled={!selectedEntry} onClick={() => void renameEntry(selectedEntry)} />
          <ToolButton icon={Trash2} label={t("common.delete")} disabled={!selectedEntry} onClick={() => void deleteEntry(selectedEntry)} />
          {showWorkspace && (
            <>
              <ToolButton icon={FolderInput} label={t("sftp.panel.workspace.add")} onClick={() => void addFolder()} />
              <ToolButton icon={Save} label={t("sftp.panel.workspace.save")} disabled={busy} onClick={() => void saveWorkspace()} />
              <ToolButton icon={FolderOpen} label={t("sftp.panel.workspace.open")} onClick={() => void openWorkspace()} />
            </>
          )}
          {devStyle && (
            <>
              <ToolButton icon={RefreshCw} label={t("sftp.panel.refreshAll")} disabled={busy} onClick={refresh} />
              <ToolButton icon={ChevronsDownUp} label={t("sftp.panel.collapseAll")} onClick={collapseAll} />
            </>
          )}
        </div>
        <label className="sftp__follow">
          <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
          {t("sftp.panel.follow")}
        </label>
      </div>
      <div className="sftp__body">
        {error && (
          <p className="sidebar__note form-error" role="alert">
            {error}
          </p>
        )}
        {status && <p className="sidebar__note">{status}</p>}
        {path !== null && entries.length === 0 && !error && <p className="sidebar__note">{t("sftp.panel.empty")}</p>}
        {devStyle ? (
          asRoots && path !== null ? (
            <WorkspaceRoot
              name={basename(path)}
              path={path}
              open={mainOpen}
              onToggle={() => setMainOpen((v) => !v)}
              decoration={rootDecoration(gitEntries)}
            >
              {mainTree}
            </WorkspaceRoot>
          ) : (
            mainTree
          )
        ) : (
          <FlatFileList
            entries={entries}
            selected={selected}
            onSelect={setSelectedEntry}
            onOpen={(entry) => void openEntry(entry)}
            details={details}
            rowProps={rowProps}
          />
        )}
        {showWorkspace &&
          workspace.folders.map((folder) => (
            <WorkspaceFolder
              key={folder}
              path={folder}
              name={basename(folder)}
              list={listFolder}
              readGit={readGit}
              describeError={describeLocalError}
              git={gitOptions}
              selected={selected}
              onSelect={setSelectedEntry}
              onOpen={(entry) => void openEntry(entry)}
              details={details}
              rowProps={rowProps}
              onRemove={() => workspace.onRemove(folder)}
              collapse={collapse}
              onDirDrop={(drop) => void moveDropped(drop)}
            />
          ))}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
        {dialog?.kind === "properties" && <PropertiesDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
        {dialog?.kind === "permissions" && (
          <PermissionsDialog
            entry={dialog.entry}
            onApply={(mode) => changePermissions(dialog.entry, mode)}
            describeError={describeLocalError}
            onClose={() => setDialog(null)}
          />
        )}
      </div>
      <div className="sidebar__help">
        {repo && (
          <div className="explorer-repo">
            <span className="explorer-repo__item" title={repo.root}>
              <Laptop size={13} aria-hidden="true" />
              {basename(repo.root)}
            </span>
            <span
              className="explorer-repo__item"
              title={t(repo.dirty ? "sftp.panel.branchDirty" : "sftp.panel.branch", { branch: repo.branch })}
            >
              <GitBranch size={13} aria-hidden="true" />
              {repo.branch}
              {repo.dirty && "*"}
            </span>
          </div>
        )}
        <HelpTip text={t("sftp.local.hint")} />
      </div>
    </div>
  );
}
