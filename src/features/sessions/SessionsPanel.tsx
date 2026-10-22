import { Folder, FolderOpen, Globe, KeyRound, SquareTerminal, Usb, Waypoints } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  buildTree,
  isLocalSession,
  isMoshSession,
  isSerialSession,
  isSshSession,
  sshCommandOf,
  isTelnetSession,
  type LibrarySession,
  type SessionLibrary,
  type TreeNode,
} from "./library";
import { IniImportDialog, type ImportResult } from "./IniImportDialog";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { decodeIni, parseSessionsIni, planImport, type ParsedImport } from "./iniImport";
import { parseSshConfig } from "./sshConfigImport";
import { EXPORT_FILE_NAME, exportLibrary, planLibraryImport } from "./sessionsExport";
import type { LibraryStatus } from "./useSessionLibrary";
import { t, useT } from "../../i18n/i18n";
import { HelpTip } from "../sidebar/HelpTip";
import { writeText } from "../terminal/clipboard";

interface SessionsPanelProps {
  library: SessionLibrary;
  status: LibraryStatus;
  saveError: string | null;
  onOpen: (session: LibrarySession) => void;
  onNewSession: (folder: string) => void;
  onEdit: (session: LibrarySession) => void;
  onDelete: (session: LibrarySession) => void;
  onNewFolder: (parent: string) => void;
  onDeleteFolder: (path: string) => void;
  /** Saves the sessions confirmed in the import preview. */
  onImport: (sessions: LibrarySession[]) => void;
  /** Saves a copy of the session next to it. */
  onDuplicate: (session: LibrarySession) => void;
}

type Menu =
  | { kind: "session"; session: LibrarySession; x: number; y: number }
  | { kind: "folder"; path: string; x: number; y: number };

/** Every session inside a folder, subfolders included, in tree order. */
function sessionsUnder(node: TreeNode): LibrarySession[] {
  return node.kind === "session" ? [node.session] : node.children.flatMap(sessionsUnder);
}

/** Tooltip of a session row: where it connects. */
function sessionTooltip(session: LibrarySession, library: SessionLibrary): string {
  if (isSerialSession(session)) return `${session.path} @ ${session.baud}`;
  if (isTelnetSession(session)) return `telnet ${session.host}:${session.port}`;
  if (isLocalSession(session)) {
    const shell = session.program ?? t("sessions.panel.localDefaultShell");
    return session.cwd ? t("sessions.panel.localTooltip", { shell, dir: session.cwd }) : shell;
  }
  if (isMoshSession(session)) {
    const ssh = library.sessions.find((s) => s.id === session.sshSessionId);
    return ssh ? t("sessions.panel.moshTooltip", { name: ssh.name }) : t("sessions.panel.moshOrphanTooltip");
  }
  return `${session.username}@${session.host}:${session.port}`;
}

const KIND_ICONS = { ssh: KeyRound, serial: Usb, telnet: Globe, mosh: Waypoints, local: SquareTerminal } as const;

/** The session's type as an icon coloured by type (SSH, serial, Telnet, Mosh or local). */
function SessionIcon({ session }: { session: LibrarySession }) {
  const kind = session.kind ?? "ssh";
  const Icon = KIND_ICONS[kind];
  return <Icon size={15} className={`tree-row__icon tree-row__icon--${kind}`} data-kind={kind} />;
}

/** The folder node at `path`, searching the whole tree. */
function findFolder(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.path === path) return node;
    const inner = findFolder(node.children, path);
    if (inner) return inner;
  }
  return null;
}

export function SessionsPanel(props: SessionsPanelProps) {
  const { library, status, saveError } = props;
  const t = useT();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(library, filter), [library, filter]);
  const editable = status.state === "ready";
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [importMenu, setImportMenu] = useState<{ x: number; y: number } | null>(null);
  /** The result of the last export, shown under the search box. */
  const [exportNote, setExportNote] = useState<{ error: boolean; text: string } | null>(null);
  const openMenu = (
    e: ReactMouseEvent,
    target: { kind: "session"; session: LibrarySession } | { kind: "folder"; path: string },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...target, x: e.clientX, y: e.clientY });
  };

  const menuItems = (m: Menu): ContextMenuItem[] => {
    if (m.kind === "session") {
      const { session } = m;
      const connect = { label: t("common.connect"), onSelect: () => props.onOpen(session) };
      const copy = isSshSession(session)
        ? [{ label: t("sessions.menu.copySshCommand"), onSelect: () => void writeText(sshCommandOf(session)).catch(() => {}) }]
        : [];
      if (!editable) return [connect, ...copy];
      return [
        connect,
        ...copy,
        { label: t("sessions.menu.edit"), onSelect: () => props.onEdit(session) },
        { label: t("sessions.menu.duplicate"), onSelect: () => props.onDuplicate(session) },
        { separator: true },
        { label: t("common.delete"), onSelect: () => props.onDelete(session), danger: true },
      ];
    }
    const folder = findFolder(tree, m.path);
    const inside = folder ? sessionsUnder(folder) : [];
    const connectAll = {
      label: t("sessions.menu.connectAll", { count: inside.length }),
      onSelect: () => inside.forEach((session) => props.onOpen(session)),
      disabled: inside.length === 0,
    };
    if (!editable) return [connectAll];
    return [
      { label: t("sessions.menu.newSessionHere"), onSelect: () => props.onNewSession(m.path) },
      { label: t("sessions.menu.newFolderHere"), onSelect: () => props.onNewFolder(m.path) },
      connectAll,
      { separator: true },
      { label: t("sessions.menu.deleteFolder"), onSelect: () => props.onDeleteFolder(m.path), danger: true },
    ];
  };

  const previewImport = async (read: () => Promise<ParsedImport | null>) => {
    try {
      const parsed = await read();
      if (parsed) setImportResult({ ok: true, plan: planImport(library, parsed, () => crypto.randomUUID()) });
    } catch (err) {
      setImportResult({ ok: false, error: String(err) });
    }
  };

  const readBytes = async (path: string) => new Uint8Array(await invoke<number[]>("import_read_file", { path }));

  // Native dialog + bounded backend read: the same path as SFTP uploads, which works in WebKitGTK.
  const importIniFile = () =>
    previewImport(async () => {
      const path = await open({
        title: t("sessions.panel.importTitle"),
        multiple: false,
        directory: false,
        filters: [{ name: t("sessions.panel.importFilter"), extensions: ["ini"] }],
      });
      if (typeof path !== "string") return null;
      return parseSessionsIni(decodeIni(await readBytes(path)));
    });

  /** A file written by Export: its sessions are previewed like any other import. */
  const importExport = async () => {
    const path = await open({
      title: t("sessions.panel.importJsonTitle"),
      multiple: false,
      directory: false,
      filters: [{ name: t("sessions.panel.exportFilter"), extensions: ["json"] }],
    }).catch(() => null);
    if (typeof path !== "string") return;
    try {
      const json = new TextDecoder().decode(await readBytes(path));
      setImportResult({ ok: true, plan: planLibraryImport(library, json, () => crypto.randomUUID()) });
    } catch (err) {
      setImportResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };

  /** Saves every session and folder to a file the user picks; no passwords are in it. */
  const exportSessions = async () => {
    setExportNote(null);
    const path = await save({
      title: t("sessions.panel.exportTitle"),
      defaultPath: EXPORT_FILE_NAME,
      filters: [{ name: t("sessions.panel.exportFilter"), extensions: ["json"] }],
    }).catch(() => null);
    if (!path) return;
    try {
      await invoke("save_text_file", { path, contents: exportLibrary(library) });
      setExportNote({ error: false, text: t("sessions.panel.exported", { count: library.sessions.length, file: path }) });
    } catch (err) {
      setExportNote({ error: true, text: t("sessions.panel.exportError", { error: String(err) }) });
    }
  };

  const importSshConfig = () =>
    previewImport(async () => {
      const home = await invoke<string>("local_home");
      const bytes = await readBytes(`${home}/.ssh/config`);
      return parseSshConfig(new TextDecoder().decode(bytes));
    });

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number) => {
    const indent = { paddingLeft: 8 + depth * 14 };
    if (node.kind === "folder") {
      // While filtering, every matching folder is shown expanded.
      const open = filter.trim() !== "" || !collapsed.has(node.path);
      return (
        <li key={`f:${node.path}`}>
          <div
            className="tree-row tree-row--folder"
            style={indent}
            onClick={() => toggle(node.path)}
            onContextMenu={(e) => openMenu(e, { kind: "folder", path: node.path })}
          >
            <span className="tree-row__chevron">{open ? "▾" : "▸"}</span>
            {open ? (
              <FolderOpen size={15} className="tree-row__icon" data-kind="folder" />
            ) : (
              <Folder size={15} className="tree-row__icon" data-kind="folder" />
            )}
            <span className="tree-row__label" dir="auto">{node.name}</span>
            {editable && (
              <span className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
                <button title={t("sessions.panel.newSessionHere")} onClick={() => props.onNewSession(node.path)}>+</button>
                <button title={t("sessions.panel.newSubfolder")} onClick={() => props.onNewFolder(node.path)}>⊞</button>
                <button title={t("sessions.panel.deleteFolder")} onClick={() => props.onDeleteFolder(node.path)}>🗑</button>
              </span>
            )}
          </div>
          {open && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
        </li>
      );
    }
    const { session } = node;
    return (
      <li key={`s:${session.id}`}>
        <div
          className="tree-row"
          style={indent}
          tabIndex={0}
          title={sessionTooltip(session, props.library)}
          onDoubleClick={() => props.onOpen(session)}
          onKeyDown={(e) => e.key === "Enter" && props.onOpen(session)}
          onContextMenu={(e) => openMenu(e, { kind: "session", session })}
        >
          <SessionIcon session={session} />
          <span className="tree-row__label" dir="auto">{session.name}</span>
          {editable && (
            <span className="tree-row__actions">
              <button title={t("common.edit")} onClick={() => props.onEdit(session)}>✎</button>
              <button title={t("common.delete")} onClick={() => props.onDelete(session)}>🗑</button>
            </span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>{t("sessions.panel.title")}</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={() => props.onNewSession("")}>{t("sessions.panel.new")}</button>
            <button className="btn btn--small" onClick={() => props.onNewFolder("")}>{t("sessions.panel.folder")}</button>
            <button
              className="btn btn--small"
              aria-haspopup="menu"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setImportMenu({ x: rect.left, y: rect.bottom });
              }}
            >
              {t("sessions.panel.import")}
            </button>
            <button
              className="btn btn--small"
              disabled={status.state !== "ready" || library.sessions.length === 0}
              title={t("sessions.panel.exportHint")}
              onClick={() => void exportSessions()}
            >
              {t("sessions.panel.export")}
            </button>
          </span>
        )}
      </div>
      <input
        className="sidebar__search"
        placeholder={t("sessions.panel.search")}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {status.state === "loading" && <p className="sidebar__note">{t("common.loading")}</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">
          {t("sessions.panel.readError", { error: status.message })}
        </p>
      )}
      {saveError && <p className="sidebar__note form-error">{t("sessions.panel.saveError", { error: saveError })}</p>}
      {exportNote && (
        <p className={`sidebar__note${exportNote.error ? " form-error" : ""}`} role="status">
          {exportNote.text}
        </p>
      )}
      {status.state === "ready" && tree.length === 0 && (
        <p className="sidebar__note">{filter ? t("sessions.panel.noMatches") : t("sessions.panel.empty")}</p>
      )}
      <ul className="tree">{tree.map((node) => renderNode(node, 0))}</ul>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />}
      {importMenu && (
        <ContextMenu
          x={importMenu.x}
          y={importMenu.y}
          items={[
            { label: t("sessions.panel.importIni"), onSelect: () => void importIniFile() },
            { label: t("sessions.panel.importSshConfig"), onSelect: () => void importSshConfig() },
            { label: t("sessions.panel.importJson"), onSelect: () => void importExport() },
          ]}
          onClose={() => setImportMenu(null)}
        />
      )}
      {importResult && (
        <IniImportDialog
          result={importResult}
          onConfirm={(sessions) => {
            props.onImport(sessions);
            setImportResult(null);
          }}
          onClose={() => setImportResult(null)}
        />
      )}
      <div className="sidebar__help">
        <HelpTip text={t("sessions.panel.hint")} />
      </div>
    </div>
  );
}
