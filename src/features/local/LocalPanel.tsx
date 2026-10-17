import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useDialogs } from "../dialogs/DialogProvider";
import { useT } from "../../i18n/i18n";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { writeText } from "../terminal/clipboard";
import { formatDate, formatSize } from "../sftp/format";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { PermissionsDialog } from "../sftp/PermissionsDialog";
import { PropertiesDialog } from "../sftp/PropertiesDialog";
import type { OpenWith, SftpEntry } from "../sftp/sftpClient";
import { describeLocalError, local } from "./localClient";
import { isRoot, joinPath, parentPath, validName } from "./localPath";

interface LocalPanelProps {
  /** Folder of the active local terminal (OSC 7 or read from its shell); null while unknown. */
  cwd: string | null;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Types a path into the focused terminal pane, quoted for its shell; without it the item is disabled. */
  onPathToTerminal?: (path: string) => void;
  /** Text editor chosen in Settings; empty or missing uses the system's default one. */
  textEditor?: string;
}

const ICONS: Record<SftpEntry["kind"], string> = { dir: "📁", file: "📄", symlink: "🔗" };

/** File browser of the local disk (S3), optionally following the active local terminal's folder. */
export function LocalPanel({ cwd, follow, onFollowChange, onPathToTerminal, textEditor }: LocalPanelProps) {
  const t = useT();
  const dialogs = useDialogs();
  const platform = usePlatform();
  const [path, setPath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "properties" | "permissions"; entry: SftpEntry } | null>(null);
  // Only the latest listing request may update the view.
  const listSeq = useRef(0);
  const current = useRef({ path, entries });
  current.current = { path, entries };

  const navigate = useCallback(async (target: string) => {
    const seq = ++listSeq.current;
    try {
      const list = await local.list(target);
      if (seq !== listSeq.current) return true;
      setPath(target);
      setInput(target);
      setEntries(list);
      setSelected(null);
      setError(null);
      return true;
    } catch (err) {
      if (seq === listSeq.current) {
        setError(describeLocalError(err));
        setInput(current.current.path ?? "");
      }
      return false;
    }
  }, []);

  const goHome = useCallback(async () => {
    try {
      await navigate(await local.home());
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
    if (entry.kind === "dir") void navigate(entry.path);
    else if (entry.kind === "file") openWith(entry, { kind: "default" });
    // A symlink may point to a folder or a file: try to enter it first.
    else if (!(await navigate(entry.path))) {
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

  const selectedEntry = entries.find((e) => e.path === selected) ?? null;

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
    if (await act(t("sftp.status.renaming", { name: entry.name }), () => local.rename(entry.path, joinPath(dir, name)))) {
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
          {
            label: t("sftp.menu.openTextEditor"),
            onSelect: () => openWith(entry, textEditor ? { kind: "textEditor", command: textEditor } : { kind: "textEditor" }),
          },
          { label: t("sftp.menu.openWith"), onSelect: () => void openWithProgram(entry) },
        ]
      : [];
    return [
      { label: t("common.open"), onSelect: () => void openEntry(entry) },
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
  const start = useRef({ follow, cwd });
  useEffect(() => {
    if (!(start.current.follow && start.current.cwd)) void goHome();
  }, [goHome]);

  useEffect(() => {
    if (follow && cwd) void navigate(cwd);
  }, [cwd, follow, navigate]);

  const busy = path === null;

  return (
    <div className="sidebar__panel sftp">
      <form
        className="sftp__pathbar"
        onSubmit={(e) => {
          e.preventDefault();
          const target = input.trim();
          if (target) void navigate(target);
        }}
      >
        <button
          type="button"
          className="btn btn--small"
          title={t("sftp.panel.up")}
          disabled={busy || (path !== null && isRoot(path))}
          onClick={() => path && void navigate(parentPath(path))}
        >
          ↑
        </button>
        <button type="button" className="btn btn--small" title={t("sftp.panel.homeFolder")} onClick={() => void goHome()}>
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
        <button className="btn btn--small" disabled={busy} onClick={() => void newEntry("folder")}>
          {t("sftp.panel.newFolder")}
        </button>
        <button className="btn btn--small" disabled={busy} onClick={() => void newEntry("file")}>
          {t("sftp.panel.newFile")}
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void renameEntry(selectedEntry)}>
          {t("common.rename")}
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void deleteEntry(selectedEntry)}>
          {t("common.delete")}
        </button>
      </div>
      <label className="sftp__follow">
        <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
        {t("sftp.panel.follow")}
      </label>
      {error && (
        <p className="sidebar__note form-error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="sidebar__note">{status}</p>}
      {path !== null && entries.length === 0 && !error && <p className="sidebar__note">{t("sftp.panel.empty")}</p>}
      <ul className="sftp__list">
        {entries.map((entry) => (
          <li
            key={entry.path}
            className={`sftp-row${entry.path === selected ? " sftp-row--selected" : ""}`}
            tabIndex={0}
            title={entry.path}
            onClick={() => setSelected(entry.path)}
            onDoubleClick={() => void openEntry(entry)}
            onKeyDown={(e) => e.key === "Enter" && void openEntry(entry)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected(entry.path);
              setMenu({ x: e.clientX, y: e.clientY, entry });
            }}
            // Middle click types the path into the terminal (and never starts autoscroll).
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              pathToTerminal(entry);
            }}
          >
            <span className="sftp-row__icon">{ICONS[entry.kind]}</span>
            <span className="sftp-row__name">{entry.name}</span>
            <span className="sftp-row__size">{entry.kind === "dir" ? "" : formatSize(entry.size)}</span>
            <span className="sftp-row__date">{entry.modified ? formatDate(entry.modified) : ""}</span>
          </li>
        ))}
      </ul>
      <p className="sidebar__hint">{t("sftp.local.hint")}</p>
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
  );
}
