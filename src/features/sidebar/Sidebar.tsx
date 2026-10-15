import type { ReactNode } from "react";

export type SidebarView = "sessions" | "sftp" | "tunnels" | "macros";

interface SidebarProps {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  /** True while the focused pane of the active tab is a connected SSH session. */
  sftpAvailable: boolean;
  sessions: ReactNode;
  sftp: ReactNode;
  tunnels: ReactNode;
  macros: ReactNode;
}

/** Left sidebar with the "Sessions", "SFTP", "Tunnels" and "Macros" tabs; SFTP falls back to Sessions when unavailable. */
export function Sidebar({ view, onViewChange, sftpAvailable, sessions, sftp, tunnels, macros }: SidebarProps) {
  const shown: SidebarView = view === "sftp" && !sftpAvailable ? "sessions" : view;
  const tab = (id: SidebarView, label: string, disabled = false) => (
    <button
      role="tab"
      aria-selected={shown === id}
      className={`sidebar__tab${shown === id ? " sidebar__tab--active" : ""}`}
      disabled={disabled}
      title={disabled ? "Available when the focused pane of the active tab is a connected SSH session" : undefined}
      onClick={() => onViewChange(id)}
    >
      {label}
    </button>
  );
  const panels: Record<SidebarView, ReactNode> = { sessions, sftp, tunnels, macros };
  return (
    <aside className={`sidebar${shown === "sessions" ? "" : " sidebar--wide"}`}>
      <div className="sidebar__tabs" role="tablist">
        {tab("sessions", "Sessions")}
        {tab("sftp", "SFTP", !sftpAvailable)}
        {tab("tunnels", "Tunnels")}
        {tab("macros", "Macros")}
      </div>
      {panels[shown]}
    </aside>
  );
}
