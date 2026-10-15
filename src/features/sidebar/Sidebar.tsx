import type { ReactNode } from "react";

export type SidebarView = "sessions" | "sftp";

interface SidebarProps {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  /** True while the active tab is a connected SSH session. */
  sftpAvailable: boolean;
  sessions: ReactNode;
  sftp: ReactNode;
}

/** Left sidebar with the "Sessions" and "SFTP" tabs; SFTP falls back to Sessions when unavailable. */
export function Sidebar({ view, onViewChange, sftpAvailable, sessions, sftp }: SidebarProps) {
  const shown: SidebarView = view === "sftp" && sftpAvailable ? "sftp" : "sessions";
  const tab = (id: SidebarView, label: string, disabled = false) => (
    <button
      role="tab"
      aria-selected={shown === id}
      className={`sidebar__tab${shown === id ? " sidebar__tab--active" : ""}`}
      disabled={disabled}
      title={disabled ? "Available when the active tab is a connected SSH session" : undefined}
      onClick={() => onViewChange(id)}
    >
      {label}
    </button>
  );
  return (
    <aside className={`sidebar${shown === "sftp" ? " sidebar--wide" : ""}`}>
      <div className="sidebar__tabs" role="tablist">
        {tab("sessions", "Sessions")}
        {tab("sftp", "SFTP", !sftpAvailable)}
      </div>
      {shown === "sessions" ? sessions : sftp}
    </aside>
  );
}
