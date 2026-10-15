import { ArrowLeftRight, FolderTree, Keyboard, Star, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../i18n/i18n";

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
  const t = useT();
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
          ? t("app.sidebar.sftpUnavailable")
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
        aria-label={t("app.sidebar.label")}
        aria-orientation={collapsed ? "vertical" : "horizontal"}
      >
        {tab("sessions", t("app.sidebar.sessions"), Star)}
        {tab("sftp", "SFTP", FolderTree, !sftpAvailable)}
        {tab("tunnels", t("app.sidebar.tunnels"), ArrowLeftRight)}
        {tab("macros", t("app.sidebar.macros"), Keyboard)}
      </div>
      {!collapsed && panels[shown]}
    </aside>
  );
}
