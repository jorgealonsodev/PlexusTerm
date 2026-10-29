import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type LiHTMLAttributes } from "react";
import { DEFAULT_ICON_PACKS, type FileIconPacks } from "../files/iconPacks";
import { ToolButton } from "../files/ToolButton";
import { GitBranch, Laptop } from "lucide-react";
import { ChevronsDownUp, FilePlus, History, FolderInput, FolderOpen, FolderPlus, Pencil, Save, Trash2, RefreshCw, LocateFixed, Pin, type LucideIcon } from "lucide-react";
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
import { FileTree, isInside, type Reveal } from "../files/FileTree";
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
  /**
   * DEV mode's Pin Explorer view: on, the Explorer keeps this tab's folders while other terminals
   * open or are active. Without `onPinnedChange` there is no option.
   */
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  /** Types a path into the focused terminal pane, quoted for its shell; without it the item is disabled. */
  onPathToTerminal?: (path: string) => void;
  /** Text editor chosen in Settings; empty or missing uses the system's default one. */
  textEditor?: string;
  /** Called with the folder the user opened (path bar, a folder, Up, Home), never when following. */
  onUserNavigate?: (path: string) => void;
  /** Show each entry's size and date (Settings → Files); hidden when missing. */
  details?: boolean;
  /** The icon packs of the plain list and of DEV mode's tree (Settings → Files). */
  iconPacks?: FileIconPacks;
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
  /**
   * DEV mode's recent folders and workspace files: the toolbar lists them (the workspace files
   * first) and opens the one chosen in a new terminal tab.
   */
  /** A file to show (Ctrl+click on a path in the terminal): selected, its folders opened. */
  reveal?: Reveal;
  recent?: {
    folders: readonly string[];
    onOpen: (folder: string) => void;
    workspaces?: readonly string[];
    onOpenWorkspace?: (file: string) => void;
  };
}

/** The recent workspace files, then the recent folders, a separator between them. */
export function recentItems({ folders, onOpen, workspaces = [], onOpenWorkspace }: NonNullable<LocalPanelProps["recent"]>): ContextMenuItem[] {
  const files: ContextMenuItem[] = onOpenWorkspace ? workspaces.map((file) => ({ label: file, onSelect: () => onOpenWorkspace(file) })) : [];
  const dirs: ContextMenuItem[] = folders.map((folder) => ({ label: folder, onSelect: () => onOpen(folder) }));
  return files.length > 0 && dirs.length > 0 ? [...files, { separator: true }, ...dirs] : [...files, ...dirs];
}

/**
 * How often, at most, a visible list reads its folders again while the terminal prints (an AI tool
 * creating files); the first read waits a moment so the files are written.
 */
export const FILE_LIST_REFRESH_MS = 1500;

const sameList = (a: SftpEntry[], b: SftpEntry[]) =>
  a.length === b.length &&
  a.every((x, i) => x.path === b[i].path && x.kind === b[i].kind && x.size === b[i].size && x.modified === b[i].modified);

export interface Workspace {
  folders: readonly string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  /** Opens the folders a workspace file lists (the first one is the main folder). */
  onOpenFolders: (folders: string[]) => void;
  /** A workspace file opened or saved here, for the recent ones. */
  onFile?: (file: string) => void;
  /** The terminal's folder right now, where Add Folder's dialog opens; null when unknown. */
  terminalDir?: () => Promise<string | null>;
}

/** One of DEV mode's on/off options: a compact chip around a real checkbox, lit while it is on. */
function OptionChip({ icon: Icon, label, short, help, checked, onChange }: {
  icon: LucideIcon;
  /** The checkbox's name; the chip shows `short`. */
  label: string;
  short: string;
  help?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="sftp__chip" title={help ?? label}>
      <input type="checkbox" className="sftp__chip-box" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <Icon size={13} aria-hidden="true" />
      <span aria-hidden="true">{short}</span>
    </label>
  );
}

/** File browser of the local disk (S3), optionally following the active local terminal's folder. */
export function LocalPanel({ cwd, follow, onFollowChange, pinned = false, onPinnedChange, onPathToTerminal, textEditor, details = false, iconPacks = DEFAULT_ICON_PACKS, onUserNavigate, git, onOpenInTerminal, devStyle = false, startAt = null, onView, workspace, recent, reveal }: LocalPanelProps) {
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
  /** The open right-click menu; `onRemove` for the root of a folder added to the workspace. */
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry; onRemove?: () => void } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "properties" | "permissions"; entry: SftpEntry } | null>(null);
  /** Where the recent folders' menu opens (under its button), or null while closed. */
  const [recentMenu, setRecentMenu] = useState<{ x: number; y: number } | null>(null);
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
      const seq = listSeq.current;
      const home = await local.home();
      // A folder asked for meanwhile (the terminal's, arriving after the panel opened) wins.
      if (seq !== listSeq.current) return;
      await navigate(home, user);
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

  /**
   * Lists the folders again without leaving them: the selection stays, the open folders of the
   * tree and the added ones are read again too; a navigation started meanwhile wins.
   */
  const reloadQuietly = useCallback(async () => {
    const dir = current.current.path;
    if (dir === null) return;
    const seq = listSeq.current;
    const list = await local.list(dir).catch(() => null);
    if (list === null || seq !== listSeq.current || current.current.path !== dir) return;
    setEntries((prev) => (sameList(prev, list ?? []) ? prev : (list ?? [])));
    setLoads((n) => n + 1);
  }, []);

  // The terminal at work (an AI tool writing files) or its prompt back: the list follows, at most
  // every FILE_LIST_REFRESH_MS, only while it is on screen.
  const visible = git?.visible ?? true;
  const subscribeOutput = git?.subscribeOutput;
  useEffect(() => {
    if (!visible || !subscribeOutput) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = subscribeOutput((_text, echo) => {
      if (echo || timer) return;
      timer = setTimeout(() => {
        timer = null;
        void reloadQuietly();
      }, FILE_LIST_REFRESH_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [visible, subscribeOutput, reloadQuietly]);
  const prompt = git?.prompt ?? 0;
  const promptSeen = useRef(prompt);
  useEffect(() => {
    if (prompt === promptSeen.current) return;
    promptSeen.current = prompt;
    if (visible) void reloadQuietly();
  }, [prompt, visible, reloadQuietly]);

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
    if (name) await renameTo(entry, name);
  };

  /** Renames an entry (from the dialog, or typed in place in the tree) in its own folder. */
  const renameTo = async (entry: SftpEntry, name: string) => {
    const dir = current.current.path;
    if (dir === null || name === entry.name) return;
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

  /** An entry cut or copied in DEV mode's tree, until it is pasted (a cut one only once). */
  const [clipboard, setClipboard] = useState<{ mode: "cut" | "copy"; entry: SftpEntry } | null>(null);
  /** The folder an action on `entry` happens in: the folder itself, or a file's folder. */
  const folderOf = (entry: SftpEntry) => (entry.kind === "dir" ? entry.path : parentPath(entry.path));

  /** Pastes the cut or copied entry into the folder of `entry`: a cut one moves, a copy is named "… copy" on a clash. */
  const paste = async (entry: SftpEntry) => {
    const dir = current.current.path;
    if (!clipboard || dir === null) return;
    const target = folderOf(entry);
    const { mode, entry: from } = clipboard;
    if (mode === "cut") {
      setClipboard(null);
      if (parentPath(from.path) === target) return;
      if (await act(t("sftp.status.moving", { name: from.name }), () => local.move(from.path, target))) await navigate(dir);
    } else if (await act(t("sftp.status.copying", { name: from.name }), () => local.copy(from.path, target))) {
      await navigate(dir);
    }
  };

  /** The path of `entry` from the workspace folder it is in (the listed one or an added one). */
  const relativePath = (entry: SftpEntry) => {
    const roots = [current.current.path, ...(workspace?.folders ?? [])].filter((r): r is string => r !== null);
    const root = roots.find((r) => isInside(entry.path, r));
    return root ? entry.path.slice(root.length).replace(/^[\\/]+/, "") : entry.name;
  };
  const copyText = (text: string) =>
    void act(t("sftp.status.copyingPath"), () => writeText(text), t("sftp.status.copied", { path: text }));

  const openToSide = (entry: SftpEntry) => (entry.kind === "dir" ? undefined : onView?.(entry.path));
  const openContainingFolder = (entry: SftpEntry) => {
    const folder = parentPath(entry.path);
    openWith({ ...entry, kind: "dir", path: folder, name: basename(folder) }, { kind: "default" });
  };

  /** The Explorer's shortcuts on a selected row in DEV mode, as in VS Code; true when one ran. */
  const onRowKey = (entry: SftpEntry, e: KeyboardEvent<HTMLLIElement>): boolean => {
    const ctrl = e.ctrlKey || e.metaKey;
    const keys = `${ctrl ? "Ctrl+" : ""}${e.shiftKey ? "Shift+" : ""}${e.altKey ? "Alt+" : ""}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
    const actions: Record<string, () => void> = {
      "Ctrl+Alt+R": () => openContainingFolder(entry),
      "Ctrl+Shift+Alt+C": () => copyText(relativePath(entry)),
      "Ctrl+Alt+C": () => copyPath(entry),
      "Ctrl+X": () => setClipboard({ mode: "cut", entry }),
      "Ctrl+C": () => setClipboard({ mode: "copy", entry }),
      "Ctrl+V": () => void paste(entry),
      Delete: () => void deleteEntry(entry),
    };
    if (entry.kind !== "dir" && onView) actions["Ctrl+Enter"] = () => openToSide(entry);
    const action = actions[keys];
    action?.();
    return action !== undefined;
  };

  /** DEV mode's menu: VS Code's Explorer menu, then PlexusTerm's own items. */
  const devMenuItems = (entry: SftpEntry, onRemove?: () => void): ContextMenuItem[] => {
    const isFile = entry.kind !== "dir";
    return [
      ...(isFile && onView ? [{ label: t("sftp.menu.openToSide"), shortcut: "Ctrl+Enter", onSelect: () => openToSide(entry) }] : []),
      { label: t("sftp.menu.openContainingFolder"), shortcut: "Ctrl+Alt+R", onSelect: () => openContainingFolder(entry) },
      ...(isFile ? [{ label: t("sftp.menu.openWith"), onSelect: () => void openWithProgram(entry) }] : []),
      {
        label: t("sftp.menu.openInIntegratedTerminal"),
        onSelect: () => onOpenInTerminal?.(folderOf(entry)),
        disabled: !onOpenInTerminal,
      },
      { separator: true },
      { label: t("sftp.menu.cut"), shortcut: "Ctrl+X", onSelect: () => setClipboard({ mode: "cut", entry }) },
      { label: t("sftp.menu.copy"), shortcut: "Ctrl+C", onSelect: () => setClipboard({ mode: "copy", entry }) },
      { label: t("sftp.menu.paste"), shortcut: "Ctrl+V", onSelect: () => void paste(entry), disabled: !clipboard },
      { separator: true },
      { label: t("sftp.menu.copyPath"), shortcut: "Ctrl+Alt+C", onSelect: () => copyPath(entry) },
      { label: t("sftp.menu.copyRelativePath"), shortcut: "Ctrl+Shift+Alt+C", onSelect: () => copyText(relativePath(entry)) },
      { separator: true },
      { label: t("sftp.menu.rename"), shortcut: "F2", onSelect: () => void renameEntry(entry) },
      { label: t("common.delete"), shortcut: "Del", onSelect: () => void deleteEntry(entry), danger: true },
      { separator: true },
      ...(isFile ? [{ label: t("sftp.menu.openTextEditor"), onSelect: () => openWith(entry, textEditor ? { kind: "textEditor", command: textEditor } : { kind: "textEditor" }) }] : []),
      { label: t("sftp.menu.copyPathToTerminal"), onSelect: () => pathToTerminal(entry), disabled: !onPathToTerminal },
      { label: t("sftp.menu.properties"), onSelect: () => setDialog({ kind: "properties", entry }) },
      ...(platform === "windows"
        ? []
        : [{ label: t("sftp.menu.permissions"), onSelect: () => setDialog({ kind: "permissions" as const, entry }) }]),
      ...(onRemove ? [{ separator: true as const }, { label: t("sftp.panel.workspace.remove"), onSelect: onRemove }] : []),
    ];
  };

  const menuItems = (entry: SftpEntry, onRemove?: () => void): ContextMenuItem[] => {
    if (devStyle) return devMenuItems(entry, onRemove);
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
      ...(onRemove ? [{ separator: true as const }, { label: t("sftp.panel.workspace.remove"), onSelect: onRemove }] : []),
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
    // A prompt coming back lists the folders again, which bumps `loads`.
  }, [readRepo, selected, loads]);
  /** In DEV mode every folder shows as a root, the main one first, as in a VS Code workspace. */
  const asRoots = devStyle;
  const [mainOpen, setMainOpen] = useState(true);

  /** Collapse Folders: every open folder closes, and with several roots the roots too (as VS Code's). */
  const collapseAll = () => {
    setCollapse((n) => n + 1);
    // With added folders the roots close too; alone, the main one stays open.
    if (showWorkspace && workspace.folders.length > 0) setMainOpen(false);
  };

  /** Adds a folder chosen in the system dialog to the workspace, once. */
  const addFolder = async () => {
    if (!workspace) return;
    // The dialog opens where the terminal is now, else at the folder listed here.
    const here = (await workspace.terminalDir?.().catch(() => null)) ?? cwd ?? path;
    const dir = await open({
      title: t("sftp.panel.workspace.choose"),
      multiple: false,
      directory: true,
      ...(here ? { defaultPath: here } : {}),
    }).catch(() => null);
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
      .then(() => {
        setStatus(t("sftp.panel.workspace.saved", { file: basename(file) }));
        workspace.onFile?.(file);
      })
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
      workspace.onFile?.(file);
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

  /**
   * A workspace root's title, as a folder row: the same menu (plus Remove folder from workspace
   * for an added folder), drag onto a terminal and middle click.
   */
  const rootProps = (folder: string, onRemove?: () => void): HTMLAttributes<HTMLDivElement> => {
    const asEntry = (): SftpEntry => ({
      name: basename(folder),
      path: folder,
      kind: "dir",
      size: 0,
      modified: null,
      permissions: null,
      uid: null,
      gid: null,
      user: null,
      group: null,
    });
    return {
      onContextMenu: (e) => {
        e.preventDefault();
        const { clientX: x, clientY: y } = e;
        // Its details for Properties and Permissions, when the folder can be read.
        void Promise.resolve()
          .then(() => local.stat(folder))
          .catch(() => null)
          .then((found) => setMenu({ x, y, entry: found ?? asEntry(), onRemove }));
      },
      onPointerDown: (e) => startPathDrag(e, { origin: { kind: "local" }, paths: [{ path: folder, isDir: true }] }, basename(folder)),
      onMouseDown: (e) => e.button === 1 && e.preventDefault(),
      onAuxClick: (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        pathToTerminal(asEntry());
      },
    };
  };

  /**
   * A file to show: selected; under a folder of the tree, its folders open down to it; elsewhere
   * the list goes to the file's folder.
   */
  const [treeReveal, setTreeReveal] = useState<Reveal | null>(null);
  const revealId = reveal?.id;
  const revealed = useRef<number | null>(null);
  // A panel opened by the request first lists its own folder, then shows the file.
  const listed = path !== null;
  useEffect(() => {
    if (!reveal || !listed || revealed.current === reveal.id) return;
    revealed.current = reveal.id;
    const file = reveal.path;
    const dir = parentPath(file);
    const main = current.current.path;
    const added = devStyle && workspace ? workspace.folders : [];
    const select = () =>
      void Promise.resolve()
        .then(() => local.stat(file))
        .catch(() => null)
        .then((found) =>
          setSelectedEntry(
            found ?? { name: basename(file), path: file, kind: "file", size: 0, modified: null, permissions: null, uid: null, gid: null, user: null, group: null },
          ),
        );
    const roots = [...(main !== null ? [main] : []), ...added];
    if (devStyle && roots.some((root) => root === dir || isInside(file, root))) {
      if (main !== null && (main === dir || isInside(file, main))) setMainOpen(true);
      setTreeReveal(reveal);
      select();
    } else void navigate(dir).then((ok) => ok && select());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, listed]);

  /** The main folder leaves the workspace: the first added folder becomes the main one, as in VS Code. */
  const removeMain = async () => {
    const next = workspace?.folders[0];
    if (next && (await navigate(next, true))) workspace?.onRemove(next);
  };

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
      onRename={(entry, name) => void renameTo(entry, name)}
      onRowKey={onRowKey}
      details={details}
      iconPack={iconPacks.tree}
      gitIndex={gitIndex}
      rowProps={rowProps}
      collapse={collapse}
      reveal={treeReveal ?? undefined}
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
              {recent && (
                <ToolButton
                  icon={History}
                  label={t("sftp.panel.recent")}
                  disabled={recent.folders.length === 0 && (recent.workspaces?.length ?? 0) === 0}
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    setRecentMenu({ x: box.left, y: box.bottom });
                  }}
                />
              )}
            </>
          )}
        </div>
        <div className="sftp__chips">
          <OptionChip icon={LocateFixed} label={t("sftp.panel.follow")} short={t("sftp.panel.followShort")} checked={follow} onChange={onFollowChange} />
          {devStyle && onPinnedChange && (
            <OptionChip
              icon={Pin}
              label={t("sftp.panel.pin")}
              short={t("sftp.panel.pinShort")}
              help={t("sftp.panel.pinHelp")}
              checked={pinned}
              onChange={onPinnedChange}
            />
          )}
        </div>
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
              // Alone, the main folder cannot leave the workspace.
              titleProps={rootProps(path, showWorkspace && workspace.folders.length > 0 ? () => void removeMain() : undefined)}
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
            iconPack={iconPacks.list}
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
              onRename={(entry, name) => void renameTo(entry, name)}
              onRowKey={onRowKey}
              details={details}
              iconPack={iconPacks.tree}
              rowProps={rowProps}
              titleProps={rootProps(folder, () => workspace.onRemove(folder))}
              reveal={treeReveal ?? undefined}
              collapse={collapse}
              onDirDrop={(drop) => void moveDropped(drop)}
            />
          ))}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry, menu.onRemove)} onClose={() => setMenu(null)} />}
        {recentMenu && recent && (
          <ContextMenu
            x={recentMenu.x}
            y={recentMenu.y}
            items={recentItems(recent)}
            onClose={() => setRecentMenu(null)}
          />
        )}
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
