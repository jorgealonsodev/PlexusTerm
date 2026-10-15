import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { basename, joinPath, parentPath } from "./remotePath";
import { describeSftpError, sftp, type SftpEntry } from "./sftpClient";

interface SftpPanelProps {
  /** Backend id of the connected SSH session. */
  sessionId: number;
  /** Folder last reported by the terminal through OSC 7. */
  cwd: string | null;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}

const ICONS: Record<SftpEntry["kind"], string> = { dir: "📁", file: "📄", symlink: "🔗" };

function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

const formatDate = (secs: number) =>
  new Date(secs * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

const validName = (name: string) => name !== "" && name !== "." && name !== ".." && !name.includes("/");

/** Remote file browser for one SSH session (S7.4), optionally following the terminal folder (S7.5). */
export function SftpPanel({ sessionId, cwd, follow, onFollowChange }: SftpPanelProps) {
  const [path, setPath] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Only the latest listing request may update the view.
  const listSeq = useRef(0);
  const current = useRef({ path, entries });
  current.current = { path, entries };

  const navigate = useCallback(
    async (target: string) => {
      const seq = ++listSeq.current;
      try {
        const list = await sftp.list(sessionId, target);
        if (seq !== listSeq.current) return true;
        setPath(target);
        setInput(target);
        setEntries(list);
        setSelected(null);
        setError(null);
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

  const goHome = useCallback(async () => {
    try {
      await navigate(await sftp.home(sessionId));
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
    if (clashes.length && !window.confirm(`Replace ${clashes.join(", ")} in ${dir}?`)) return;
    const count = paths.length === 1 ? basename(paths[0]) : `${paths.length} files`;
    await act(
      `Uploading ${count}…`,
      async () => {
        for (const local of paths) await sftp.upload(sessionId, local, dir);
      },
      `Uploaded ${count}.`,
    );
    if (current.current.path === dir) await navigate(dir);
  };
  const uploadRef = useRef(uploadPaths);
  uploadRef.current = uploadPaths;

  const download = async (entry: SftpEntry) => {
    try {
      const local = await save({ title: `Download ${entry.name}`, defaultPath: entry.name });
      if (!local) return;
      await act(`Downloading ${entry.name}…`, () => sftp.download(sessionId, entry.path, local), `Downloaded ${entry.name}.`);
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const openEntry = async (entry: SftpEntry) => {
    if (entry.kind === "dir") void navigate(entry.path);
    else if (entry.kind === "file") void download(entry);
    // A symlink may point to a folder or a file: try to enter it first.
    else if (!(await navigate(entry.path))) {
      setError(null);
      void download(entry);
    }
  };

  const pickUploads = async () => {
    try {
      const picked = await open({ title: "Upload files", multiple: true, directory: false });
      if (picked) await uploadPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (err) {
      setError(describeSftpError(err));
    }
  };

  const newFolder = async () => {
    const dir = current.current.path;
    const name = window.prompt("New folder name")?.trim();
    if (dir === null || !name) return;
    if (!validName(name)) return setError(`"${name}" is not a valid folder name.`);
    if (await act(`Creating ${name}…`, () => sftp.mkdir(sessionId, joinPath(dir, name)))) await navigate(dir);
  };

  const selectedEntry = entries.find((e) => e.path === selected) ?? null;

  const renameSelected = async () => {
    const dir = current.current.path;
    if (!selectedEntry || dir === null) return;
    const name = window.prompt(`Rename "${selectedEntry.name}" to`, selectedEntry.name)?.trim();
    if (!name || name === selectedEntry.name) return;
    if (!validName(name)) return setError(`"${name}" is not a valid name.`);
    const target = joinPath(dir, name);
    if (await act(`Renaming ${selectedEntry.name}…`, () => sftp.rename(sessionId, selectedEntry.path, target))) {
      await navigate(dir);
    }
  };

  const deleteSelected = async () => {
    const dir = current.current.path;
    if (!selectedEntry || dir === null) return;
    const isDir = selectedEntry.kind === "dir";
    const question = isDir
      ? `Delete folder "${selectedEntry.name}"? Only empty folders can be deleted.`
      : `Delete "${selectedEntry.name}"?`;
    if (!window.confirm(question)) return;
    if (await act(`Deleting ${selectedEntry.name}…`, () => sftp.remove(sessionId, selectedEntry.path, isDir))) {
      await navigate(dir);
    }
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

  const busy = path === null;

  return (
    <div className={`sidebar__panel sftp${dragOver ? " sftp--drop" : ""}`} ref={panelRef}>
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
          title="Up"
          disabled={busy || path === "/"}
          onClick={() => path && void navigate(parentPath(path))}
        >
          ↑
        </button>
        <button type="button" className="btn btn--small" title="Home folder" onClick={() => void goHome()}>
          ⌂
        </button>
        <button type="button" className="btn btn--small" title="Refresh" disabled={busy} onClick={refresh}>
          ⟳
        </button>
        <input
          className="sidebar__search sftp__path"
          aria-label="Remote path"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </form>
      <div className="sftp__toolbar">
        <button className="btn btn--small" disabled={busy} onClick={() => void pickUploads()}>
          Upload
        </button>
        <button className="btn btn--small" disabled={busy} onClick={() => void newFolder()}>
          New folder
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void renameSelected()}>
          Rename
        </button>
        <button className="btn btn--small" disabled={!selectedEntry} onClick={() => void deleteSelected()}>
          Delete
        </button>
        <button
          className="btn btn--small"
          disabled={!selectedEntry || selectedEntry.kind === "dir"}
          onClick={() => selectedEntry && void download(selectedEntry)}
        >
          Download
        </button>
      </div>
      <label className="sftp__follow">
        <input type="checkbox" checked={follow} onChange={(e) => onFollowChange(e.target.checked)} />
        Follow terminal folder
      </label>
      {error && (
        <p className="sidebar__note form-error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="sidebar__note">{status}</p>}
      {path !== null && entries.length === 0 && !error && <p className="sidebar__note">This folder is empty.</p>}
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
          >
            <span className="sftp-row__icon">{ICONS[entry.kind]}</span>
            <span className="sftp-row__name">{entry.name}</span>
            <span className="sftp-row__size">{entry.kind === "dir" ? "" : formatSize(entry.size)}</span>
            <span className="sftp-row__date">{entry.modified ? formatDate(entry.modified) : ""}</span>
          </li>
        ))}
      </ul>
      <p className="sidebar__hint">Double-click a folder to open it or a file to download it. Drop files here to upload them.</p>
    </div>
  );
}
