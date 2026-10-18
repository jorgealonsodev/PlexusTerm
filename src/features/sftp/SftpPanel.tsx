import { useCallback, useEffect, useMemo, useRef, useState, type LiHTMLAttributes } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useDialogs } from "../dialogs/DialogProvider";
import { useT } from "../../i18n/i18n";
import { startPathDrag } from "../drop/pathDrag";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { writeText } from "../terminal/clipboard";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { PermissionsDialog } from "./PermissionsDialog";
import { PropertiesDialog } from "./PropertiesDialog";
import { basename, joinPath, parentPath, terminalPath } from "./remotePath";
import { describeSftpError, sftp, type OpenWith, type SftpEntry } from "./sftpClient";
import { HelpTip } from "../sidebar/HelpTip";
import { FileTree } from "../files/FileTree";
import { FlatFileList } from "../files/FlatFileList";
import { indexGitStatus } from "../files/gitStatus";
import { useGitStatus, type GitStatusOptions } from "../files/useGitStatus";

interface SftpPanelProps {
  /** Backend id of the connected SSH session. */
  sessionId: number;
  /** Folder last reported by the terminal through OSC 7. */
  cwd: string | null;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Types text into the focused terminal pane; without it "Copy file path to terminal" is disabled. */
  onPathToTerminal?: (text: string) => void;
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
  /** Opens a new terminal tab in a folder ("Open in terminal"); without it the item is disabled. */
  onOpenInTerminal?: (path: string) => void;
}

const validName = (name: string) => name !== "" && name !== "." && name !== ".." && !name.includes("/");

/** Remote file browser for one SSH session (S7.4), optionally following the terminal folder (S7.5). */
export function SftpPanel({ sessionId, cwd, follow, onFollowChange, onPathToTerminal, textEditor, details = false, onUserNavigate, git, onOpenInTerminal, devStyle = false }: SftpPanelProps) {
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
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "properties" | "permissions"; entry: SftpEntry } | null>(null);
  /** Counts listings, so the git status is read again after each one. */
  const [loads, setLoads] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const onUserNavigateRef = useRef(onUserNavigate);
  onUserNavigateRef.current = onUserNavigate;
  // Only the latest listing request may update the view.
  const listSeq = useRef(0);
  const current = useRef({ path, entries });
  current.current = { path, entries };

  const navigate = useCallback(
    async (target: string, user = false) => {
      const seq = ++listSeq.current;
      try {
        const list = await sftp.list(sessionId, target);
        if (seq !== listSeq.current) return true;
        setPath(target);
        setInput(target);
        setEntries(list);
        setLoads((n) => n + 1);
        setSelectedEntry(null);
        setError(null);
        if (user) onUserNavigateRef.current?.(target);
        return true;
      } catch (err) {
        if (seq === listSeq.current) {
          setError(describeSftpError(err));
          setInput(current.current.path ?? "");
        }
        return false;
      }
    },
    [sessionId],
  );

  const goHome = useCallback(async (user = false) => {
    try {
      await navigate(await sftp.home(sessionId), user);
    } catch (err) {
      setError(describeSftpError(err));
    }
  }, [navigate, sessionId]);

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
      setError(describeSftpError(err));
      return false;
    }
  };

  const refresh = () => current.current.path !== null && void navigate(current.current.path);

  const uploadPaths = async (paths: string[]) => {
    const dir = current.current.path;
    if (dir === null || paths.length === 0) return;
    const existing = new Set(current.current.entries.map((e) => e.name));
    const clashes = paths.map(basename).filter((name) => existing.has(name));
    if (
      clashes.length &&
      !(await dialogs.confirm({ message: t("sftp.dialog.replaceQuestion", { names: clashes.join(", "), dir }), confirmLabel: t("sftp.dialog.replace"), danger: true }))
    ) {
      return;
    }
    const what = paths.length === 1 ? basename(paths[0]) : t("sftp.status.fileCount", { count: paths.length });
    await act(
      t("sftp.status.uploading", { what }),
      async () => {
        for (const local of paths) await sftp.upload(sessionId, local, dir);
      },
      t("sftp.status.uploaded", { what }),
    );
    if (current.current.path === dir) await navigate(dir);
  };
  const uploadRef = useRef(uploadPaths);
  uploadRef.current = uploadPaths;

  const download = async (entry: SftpEntry) => {
    try {
      const local = await save({ title: t("sftp.dialog.downloadTitle", { name: entry.name }), defaultPath: entry.name });
      if (!local) return;
      await act(
        t("sftp.status.downloading", { name: entry.name }),
        () => sftp.download(sessionId, entry.path, local),
        t("sftp.status.downloaded", { name: entry.name }),
      );
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const openEntry = async (entry: SftpEntry) => {
    if (entry.kind === "dir") void navigate(entry.path, true);
    else if (entry.kind === "file") void download(entry);
    // A symlink may point to a folder or a file: try to enter it first.
    else if (!(await navigate(entry.path, true))) {
      setError(null);
      void download(entry);
    }
  };

  const pickUploads = async () => {
    try {
      const picked = await open({ title: t("sftp.dialog.uploadTitle"), multiple: true, directory: false });
      if (picked) await uploadPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const newFolder = async () => {
    const dir = current.current.path;
    const name = (await dialogs.prompt({ message: t("sftp.dialog.newFolderName"), confirmLabel: t("sftp.dialog.create") }))?.trim();
    if (dir === null || !name) return;
    if (!validName(name)) return setError(t("sftp.error.invalidFolderName", { name }));
    if (await act(t("sftp.status.creating", { name }), () => sftp.mkdir(sessionId, joinPath(dir, name)))) await navigate(dir);
  };

  const newFile = async () => {
    const dir = current.current.path;
    const name = (await dialogs.prompt({ message: t("sftp.dialog.newFileName"), confirmLabel: t("sftp.dialog.create") }))?.trim();
    if (dir === null || !name) return;
    if (!validName(name)) return setError(t("sftp.error.invalidFileName", { name }));
    if (await act(t("sftp.status.creating", { name }), () => sftp.createFile(sessionId, joinPath(dir, name)))) await navigate(dir);
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
    // A nested entry (an open folder of the tree) is renamed in its own folder.
    const target = joinPath(parentPath(entry.path), name);
    if (await act(t("sftp.status.renaming", { name: entry.name }), () => sftp.rename(sessionId, entry.path, target))) {
      await navigate(dir);
    }
  };

  const deleteEntry = async (entry: SftpEntry | null) => {
    const dir = current.current.path;
    if (!entry || dir === null) return;
    const isDir = entry.kind === "dir";
    const question = isDir
      ? t("sftp.dialog.deleteFolder", { name: entry.name })
      : t("sftp.dialog.deleteFile", { name: entry.name });
    if (!(await dialogs.confirm({ message: question, confirmLabel: t("common.delete"), danger: true }))) return;
    if (await act(t("sftp.status.deleting", { name: entry.name }), () => sftp.remove(sessionId, entry.path, isDir))) {
      await navigate(dir);
    }
  };

  const pathToTerminal = (entry: SftpEntry) => {
    const text = terminalPath(entry.path);
    if (text === null) return setError(t("sftp.error.unsafePath"));
    onPathToTerminal?.(text);
  };

  const copyPath = (entry: SftpEntry) =>
    void act(t("sftp.status.copyingPath"), () => writeText(entry.path), t("sftp.status.copied", { path: entry.path }));

  /** Opens a temporary copy of a file; saving it later offers to upload it back. */
  const editWith = (entry: SftpEntry, openWith: OpenWith) =>
    void act(
      t("sftp.status.opening", { name: entry.name }),
      () => sftp.edit(sessionId, entry.path, openWith),
      t("sftp.status.opened", { name: entry.name }),
    );

  const openWithProgram = async (entry: SftpEntry) => {
    try {
      const program = await open({
        title: t("sftp.dialog.openWithTitle", { name: entry.name }),
        multiple: false,
        directory: false,
        defaultPath: programsDir(platform),
      });
      if (typeof program === "string") editWith(entry, { kind: "program", path: program });
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const compareWith = async (entry: SftpEntry) => {
    try {
      const local = await open({ title: t("sftp.dialog.compareWithTitle", { name: entry.name }), multiple: false, directory: false });
      if (typeof local !== "string") return;
      await act(t("sftp.status.comparing", { name: entry.name }), () => sftp.compare(sessionId, entry.path, local));
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const changePermissions = async (entry: SftpEntry, mode: number) => {
    await sftp.chmod(sessionId, entry.path, mode);
    if (current.current.path !== null) await navigate(current.current.path);
  };

  const menuItems = (entry: SftpEntry): ContextMenuItem[] => {
    const isFile = entry.kind !== "dir";
    const fileItems: ContextMenuItem[] = isFile
      ? [
          {
            label: t("sftp.menu.openTextEditor"),
            onSelect: () => editWith(entry, textEditor ? { kind: "textEditor", command: textEditor } : { kind: "textEditor" }),
          },
          { label: t("sftp.menu.openDefaultProgram"), onSelect: () => editWith(entry, { kind: "default" }) },
          { label: t("sftp.menu.openWith"), onSelect: () => void openWithProgram(entry) },
          { label: t("sftp.menu.compareWith"), onSelect: () => void compareWith(entry) },
        ]
      : [];
    return [
      // A folder opens in the browser; a file opens in its default program (saves upload back).
      { label: t("common.open"), onSelect: () => (isFile ? editWith(entry, { kind: "default" }) : void openEntry(entry)) },
      ...(isFile ? [] : [{ label: t("sftp.menu.openInTerminal"), onSelect: () => onOpenInTerminal?.(entry.path), disabled: !onOpenInTerminal }]),
      ...fileItems,
      { label: t("sftp.menu.download"), onSelect: () => void download(entry), disabled: !isFile },
      { separator: true },
      { label: t("sftp.menu.rename"), onSelect: () => void renameEntry(entry) },
      { label: t("common.delete"), onSelect: () => void deleteEntry(entry), danger: true },
      { separator: true },
      { label: t("sftp.menu.copyPath"), onSelect: () => copyPath(entry) },
      { label: t("sftp.menu.copyPathToTerminal"), onSelect: () => pathToTerminal(entry), disabled: !onPathToTerminal },
      { separator: true },
      { label: t("sftp.menu.properties"), onSelect: () => setDialog({ kind: "properties", entry }) },
      { label: t("sftp.menu.permissions"), onSelect: () => setDialog({ kind: "permissions", entry }) },
    ];
  };

  // Start in the terminal folder when following it, otherwise in the home folder.
  const start = useRef({ follow, cwd });
  useEffect(() => {
    if (!(start.current.follow && start.current.cwd)) void goHome();
  }, [goHome]);

  useEffect(() => {
    if (follow && cwd) void navigate(cwd);
  }, [cwd, follow, navigate]);

  // Files dropped from the desktop onto the panel are uploaded to the current folder.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const inside = ({ x, y }: { x: number; y: number }) => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return false;
      const [cx, cy] = [x / window.devicePixelRatio, y / window.devicePixelRatio];
      return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    };
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") setDragOver(inside(payload.position));
          else if (payload.type === "drop") {
            setDragOver(false);
            if (inside(payload.position)) void uploadRef.current(payload.paths);
          } else setDragOver(false);
        })
        .then((stop) => (disposed ? stop() : (unlisten = stop)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri (e.g. tests): no drag and drop.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const listFolder = useCallback((dir: string) => sftp.list(sessionId, dir), [sessionId]);
  const readGit = useCallback((root: string) => sftp.gitStatus(sessionId, root), [sessionId]);
  const gitEntries = useGitStatus(readGit, path, {
    enabled: devStyle && (git?.enabled ?? false),
    visible: git?.visible ?? false,
    prompt: git?.prompt ?? 0,
    loads,
    subscribeOutput: git?.subscribeOutput,
  });
  const gitIndex = useMemo(() => indexGitStatus(gitEntries), [gitEntries]);

  /** A row's own handlers in either list style: menu, drag onto a terminal, middle click. */
  const rowProps = (entry: SftpEntry): LiHTMLAttributes<HTMLLIElement> => ({
    onContextMenu: (e) => {
      e.preventDefault();
      setSelectedEntry(entry);
      setMenu({ x: e.clientX, y: e.clientY, entry });
    },
    // Dragged onto a terminal it changes to the folder or types the path (S4).
    onPointerDown: (e) => startPathDrag(e, { origin: { kind: "sftp", sessionId }, paths: [{ path: entry.path, isDir: entry.kind === "dir" }] }, entry.name),
    // Middle click types the path into the terminal (and never starts autoscroll).
    onMouseDown: (e) => e.button === 1 && e.preventDefault(),
    onAuxClick: (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pathToTerminal(entry);
    },
  });

  const busy = path === null;

  return (
    <div className={`sidebar__panel sftp${dragOver ? " sftp--drop" : ""}`} ref={panelRef}>
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
          disabled={busy || path === "/"}
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
          aria-label={t("sftp.panel.remotePath")}
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
      <div className="sftp__toolbar">
        <button className="btn btn--small" disabled={busy} onClick={() => void pickUploads()}>
          {t("sftp.panel.upload")}
        </button>
        <button className="btn btn--small" disabled={busy} onClick={() => void newFolder()}>
          {t("sftp.panel.newFolder")}
        </button>
        <button className="btn btn--small" disabled={busy} onClick={() => void newFile()}>
          {t("sftp.panel.newFile")}
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void renameEntry(selectedEntry)}>
          {t("common.rename")}
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void deleteEntry(selectedEntry)}>
          {t("common.delete")}
        </button>
        <button
          className="btn btn--small"
          disabled={!selectedEntry || selectedEntry.kind === "dir"}
          onClick={() => selectedEntry && void download(selectedEntry)}
        >
          {t("sftp.panel.download")}
        </button>
      </div>
      {/* DEV mode keeps the list at the project folder: following the terminal does not apply. */}
      {!devStyle && (
        <label className="sftp__follow">
          <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
          {t("sftp.panel.follow")}
        </label>
      )}
      {error && (
        <p className="sidebar__note form-error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="sidebar__note">{status}</p>}
      {path !== null && entries.length === 0 && !error && <p className="sidebar__note">{t("sftp.panel.empty")}</p>}
      {devStyle ? (
        <FileTree
          key={path ?? ""}
          entries={entries}
          list={listFolder}
          describeError={describeSftpError}
          loads={loads}
          selected={selected}
          onSelect={setSelectedEntry}
          onOpen={(entry) => void openEntry(entry)}
          details={details}
          gitIndex={gitIndex}
          rowProps={rowProps}
        />
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
      {dialog?.kind === "properties" && <PropertiesDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
      {dialog?.kind === "permissions" && (
        <PermissionsDialog
          entry={dialog.entry}
          onApply={(mode) => changePermissions(dialog.entry, mode)}
          onClose={() => setDialog(null)}
        />
      )}
      <div className="sidebar__help">
        <HelpTip text={t("sftp.panel.hint")} />
      </div>
    </div>
  );
}
