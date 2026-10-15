import type { AppKey } from "../../i18n/catalogs";
import { useT } from "../../i18n/i18n";
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

const STATE_LABEL: Record<TunnelStatus["state"], AppKey> = {
  stopped: "tunnels.state.stopped",
  starting: "tunnels.state.starting",
  running: "tunnels.state.running",
  error: "tunnels.state.error",
};

export function TunnelsPanel(props: TunnelsPanelProps) {
  const t = useT();
  const { list, status, saveError, sessions, statusOf } = props;
  const editable = status.state === "ready";
  const sessionName = (id: string) => sessions.find((s) => s.id === id)?.name ?? t("tunnels.panel.missingSession");

  return (
    <div className="sidebar__panel">
      <div className="sidebar__header">
        <span>{t("tunnels.panel.title")}</span>
        {editable && (
          <span className="sidebar__actions">
            <button className="btn btn--small" onClick={props.onNew}>
              {t("tunnels.panel.new")}
            </button>
          </span>
        )}
      </div>
      {list.tunnels.length > 0 && (
        <div className="sidebar__actions">
          <button className="btn btn--small" onClick={props.onStartAll}>
            {t("tunnels.panel.startAll")}
          </button>
          <button className="btn btn--small" onClick={props.onStopAll}>
            {t("tunnels.panel.stopAll")}
          </button>
        </div>
      )}
      {status.state === "loading" && <p className="sidebar__note">{t("common.loading")}</p>}
      {status.state === "error" && (
        <p className="sidebar__note form-error">{t("tunnels.panel.readError", { message: status.message })}</p>
      )}
      {saveError && <p className="sidebar__note form-error">{t("tunnels.panel.saveError", { error: saveError })}</p>}
      {status.state === "ready" && list.tunnels.length === 0 && <p className="sidebar__note">{t("tunnels.panel.empty")}</p>}
      <ul className="tree">
        {list.tunnels.map((tunnel) => {
          const current = statusOf(tunnel.id);
          const active = current.state === "starting" || current.state === "running";
          return (
            <li key={tunnel.id} className="tunnel">
              <div className="tree-row" title={t("tunnels.panel.via", { tunnel: describeTunnel(tunnel), session: sessionName(tunnel.sessionId) })}>
                <span
                  className={`tunnel__dot tunnel__dot--${current.state}`}
                  role="img"
                  aria-label={t(STATE_LABEL[current.state])}
                />
                <span className="tree-row__label" dir="auto">{tunnel.name}</span>
                {editable && (
                  <span className="tree-row__actions">
                    <button title={t("common.edit")} onClick={() => props.onEdit(tunnel)}>✎</button>
                    <button title={t("common.delete")} onClick={() => props.onDelete(tunnel)}>🗑</button>
                  </span>
                )}
                <button className="btn btn--small" onClick={() => props.onToggle(tunnel)}>
                  {active ? t("common.stop") : t("common.start")}
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
      <p className="sidebar__hint">{t("tunnels.panel.hint")}</p>
    </div>
  );
}
