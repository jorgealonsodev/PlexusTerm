import { useMemo, useState } from "react";
import { buildTree, type SavedSession, type SessionLibrary, type TreeNode } from "./library";
import type { LibraryStatus } from "./useSessionLibrary";

interface SessionsPanelProps {
  library: SessionLibrary;
  status: LibraryStatus;
  saveError: string | null;
  onOpen: (session: SavedSession) => void;
  onNewSession: (folder: string) => void;
  onEdit: (session: SavedSession) => void;
  onDelete: (session: SavedSession) => void;
  onNewFolder: (parent: string) => void;
  onDeleteFolder: (path: string) => void;
}

export function SessionsPanel(props: SessionsPanelProps) {
  const { library, status, saveError } = props;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildTree(library, filter), [library, filter]);
  const editable = status.state === "ready";

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
          title={`${session.username}@${session.host}:${session.port}`}
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
    <aside className="sidebar">
      <div className="sidebar__header">
        <span>Sessions</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={() => props.onNewSession("")}>New</button>
            <button className="btn btn--small" onClick={() => props.onNewFolder("")}>Folder</button>
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
    </aside>
  );
}
