import { ArrowLeftRight, FolderTree, Keyboard, Star, type LucideIcon } from "lucide-react";
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
  /** Folded: only the tab icons; a click on one opens the sidebar on that tab. */
  collapsed: boolean;
  onExpand: () => void;
}

/** Left sidebar with the "Sessions", "SFTP", "Tunnels" and "Macros" tabs; SFTP falls back to Sessions when unavailable. */
export function Sidebar({
  view,
  onViewChange,
  sftpAvailable,
  sessions,
  sftp,
  tunnels,
  macros,
  collapsed,
  onExpand,
}: SidebarProps) {
  const shown: SidebarView = view === "sftp" && !sftpAvailable ? "sessions" : view;
  const tab = (id: SidebarView, label: string, Icon: LucideIcon, disabled = false) => (
    <button
      role="tab"
      aria-selected={shown === id}
      aria-label={label}
      className={`sidebar__tab${shown === id ? " sidebar__tab--active" : ""}`}
      disabled={disabled}
      title={
        disabled
          ? "Available when the focused pane of the active tab is a connected SSH session"
          : collapsed
            ? label
            : undefined
      }
      onClick={() => {
        onViewChange(id);
        if (collapsed) onExpand();
      }}
    >
      <Icon size={16} />
      {!collapsed && label}
    </button>
  );
  const panels: Record<SidebarView, ReactNode> = { sessions, sftp, tunnels, macros };
  return (
    <aside className={`sidebar${collapsed ? " sidebar--collapsed" : shown === "sessions" ? "" : " sidebar--wide"}`}>
      <div
        className="sidebar__tabs"
        role="tablist"
        aria-label="Sidebar"
        aria-orientation={collapsed ? "vertical" : "horizontal"}
      >
        {tab("sessions", "Sessions", Star)}
        {tab("sftp", "SFTP", FolderTree, !sftpAvailable)}
        {tab("tunnels", "Tunnels", ArrowLeftRight)}
        {tab("macros", "Macros", Keyboard)}
      </div>
      {!collapsed && panels[shown]}
    </aside>
  );
}
