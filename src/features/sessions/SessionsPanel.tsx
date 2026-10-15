import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import {
  buildTree,
  isMoshSession,
  isSerialSession,
  isTelnetSession,
  type LibrarySession,
  type SessionLibrary,
  type TreeNode,
} from "./library";
import { IniImportDialog, type ImportResult } from "./IniImportDialog";
import { decodeIni, parseSessionsIni, planImport } from "./iniImport";
import type { LibraryStatus } from "./useSessionLibrary";

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
  /** Saves the sessions confirmed in the another app import preview. */
  onImport: (sessions: LibrarySession[]) => void;
}

/** Tooltip of a session row: where it connects. */
function sessionTooltip(session: LibrarySession, library: SessionLibrary): string {
  if (isSerialSession(session)) return `${session.path} @ ${session.baud}`;
  if (isTelnetSession(session)) return `telnet ${session.host}:${session.port}`;
  if (isMoshSession(session)) {
    const ssh = library.sessions.find((s) => s.id === session.sshSessionId);
    return ssh ? `mosh, logging in with "${ssh.name}"` : "mosh (its SSH session no longer exists)";
  }
  return `${session.username}@${session.host}:${session.port}`;
}

export function SessionsPanel(props: SessionsPanelProps) {
  const { library, status, saveError } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(library, filter), [library, filter]);
  const editable = status.state === "ready";
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Native dialog + bounded backend read: the same path as SFTP uploads, which works in WebKitGTK.
  const importFile = async () => {
    try {
      const path = await open({
        title: "Import sessions from sessions.ini",
        multiple: false,
        directory: false,
        filters: [{ name: "another app configuration", extensions: ["ini"] }],
      });
      if (typeof path !== "string") return;
      const bytes = await invoke<number[]>("import_read_file", { path });
      const parsed = parseSessionsIni(decodeIni(new Uint8Array(bytes)));
      setImportResult({ ok: true, plan: planImport(library, parsed, () => crypto.randomUUID()) });
    } catch (err) {
      setImportResult({ ok: false, error: String(err) });
    }
  };

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
          <div className="tree-row tree-row--folder" style={indent} onClick={() => toggle(node.path)}>
            <span className="tree-row__chevron">{open ? "▾" : "▸"}</span>
            <span className="tree-row__label">{node.name}</span>
            {editable && (
              <span className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
                <button title="New session here" onClick={() => props.onNewSession(node.path)}>+</button>
                <button title="New subfolder" onClick={() => props.onNewFolder(node.path)}>⊞</button>
                <button title="Delete folder" onClick={() => props.onDeleteFolder(node.path)}>🗑</button>
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
        >
          <span className="tree-row__chevron">›</span>
          <span className="tree-row__label">{session.name}</span>
          {editable && (
            <span className="tree-row__actions">
              <button title="Edit" onClick={() => props.onEdit(session)}>✎</button>
              <button title="Delete" onClick={() => props.onDelete(session)}>🗑</button>
            </span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>Saved sessions</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={() => props.onNewSession("")}>New</button>
            <button className="btn btn--small" onClick={() => props.onNewFolder("")}>Folder</button>
            <button className="btn btn--small" title="Import sessions from sessions.ini" onClick={() => void importFile()}>
              Import
            </button>
          </span>
        )}
      </div>
      <input
        className="sidebar__search"
        placeholder="Search sessions"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {status.state === "loading" && <p className="sidebar__note">Loading…</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">
          Could not read saved sessions: {status.message}. Editing is disabled to protect the file.
        </p>
      )}
      {saveError && <p className="sidebar__note form-error">Could not save sessions: {saveError}</p>}
      {status.state === "ready" && tree.length === 0 && (
        <p className="sidebar__note">{filter ? "No matches." : "No saved sessions yet."}</p>
      )}
      <ul className="tree">{tree.map((node) => renderNode(node, 0))}</ul>
      <p className="sidebar__hint">Double-click a session to connect.</p>
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
    </div>
  );
}
