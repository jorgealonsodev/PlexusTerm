import type { SavedSession } from "../sessions/library";
import type { LibraryStatus } from "../sessions/useSessionLibrary";
import { describeTunnel, type Tunnel, type TunnelList, type TunnelStatus } from "./tunnels";

interface TunnelsPanelProps {
  list: TunnelList;
  status: LibraryStatus;
  saveError: string | null;
  sessions: SavedSession[];
  statusOf: (id: string) => TunnelStatus;
  onToggle: (tunnel: Tunnel) => void;
  onNew: () => void;
  onEdit: (tunnel: Tunnel) => void;
  onDelete: (tunnel: Tunnel) => void;
  onStartAll: () => void;
  onStopAll: () => void;
}

const STATE_LABEL: Record<TunnelStatus["state"], string> = {
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  error: "Error",
};

export function TunnelsPanel(props: TunnelsPanelProps) {
  const { list, status, saveError, sessions, statusOf } = props;
  const editable = status.state === "ready";
  const sessionName = (id: string) => sessions.find((s) => s.id === id)?.name ?? "missing session";

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>SSH tunnels</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={props.onNew}>
              New
            </button>
          </span>
        )}
      </div>
      {list.tunnels.length > 0 && (
        <div className="sidebar__actions">
          <button className="btn btn--small" onClick={props.onStartAll}>
            Start all
          </button>
          <button className="btn btn--small" onClick={props.onStopAll}>
            Stop all
          </button>
        </div>
      )}
      {status.state === "loading" && <p className="sidebar__note">Loading…</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">
          Could not read saved tunnels: {status.message}. Editing is disabled to protect the file.
        </p>
      )}
      {saveError && <p className="sidebar__note form-error">Could not save tunnels: {saveError}</p>}
      {status.state === "ready" && list.tunnels.length === 0 && <p className="sidebar__note">No tunnels yet.</p>}
      <ul className="tree">
        {list.tunnels.map((tunnel) => {
          const current = statusOf(tunnel.id);
          const active = current.state === "starting" || current.state === "running";
          return (
            <li key={tunnel.id} className="tunnel">
              <div className="tree-row" title={`${describeTunnel(tunnel)} via ${sessionName(tunnel.sessionId)}`}>
                <span
                  className={`tunnel__dot tunnel__dot--${current.state}`}
                  role="img"
                  aria-label={STATE_LABEL[current.state]}
                />
                <span className="tree-row__label">{tunnel.name}</span>
                {editable && (
                  <span className="tree-row__actions">
                    <button title="Edit" onClick={() => props.onEdit(tunnel)}>✎</button>
                    <button title="Delete" onClick={() => props.onDelete(tunnel)}>🗑</button>
                  </span>
                )}
                <button className="btn btn--small" onClick={() => props.onToggle(tunnel)}>
                  {active ? "Stop" : "Start"}
                </button>
              </div>
              <div className="tunnel__detail">
                {describeTunnel(tunnel)} · {sessionName(tunnel.sessionId)}
              </div>
              {current.state === "running" && current.warning && (
                <div className="tunnel__detail" role="status" style={{ color: "var(--warning)" }}>
                  {current.warning}
                </div>
              )}
              {current.state === "error" && (
                <div className="tunnel__detail form-error" role="alert">
                  {current.message}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="sidebar__hint">Tunnels listen on 127.0.0.1 unless you choose another address.</p>
    </div>
  );
}
