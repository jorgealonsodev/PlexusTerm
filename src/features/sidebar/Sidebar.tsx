import { ArrowLeftRight, FolderTree, Keyboard, Star, type LucideIcon } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useT } from "../../i18n/i18n";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from "../settings/settings";

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
  /** Width in px dragged by the user; null keeps the default width of each tab. */
  width: number | null;
  /** Called with the new width when a drag of the edge ends, or null when the edge is double-clicked. */
  onWidthChange: (width: number | null) => void;
}

/**
 * Left sidebar with the "Sessions", "SFTP", "Tunnels" and "Macros" tabs; SFTP falls back to Sessions
 * when unavailable. Its edge can be dragged to change the width (kept within the sidebar's limits).
 */
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
  width,
  onWidthChange,
}: SidebarProps) {
  const t = useT();
  const asideRef = useRef<HTMLElement>(null);
  /** Width while the edge is being dragged; the setting is written only when the drag ends. */
  const [dragged, setDragged] = useState<number | null>(null);
  const dragging = useRef(false);
  const shown: SidebarView = view === "sftp" && !sftpAvailable ? "sessions" : view;
  const shownWidth = dragged ?? width;

  const widthAt = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = asideRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const rtl = document.documentElement.dir === "rtl";
    return clampSidebarWidth(rtl ? bounds.right - e.clientX : e.clientX - bounds.left);
  };
  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const next = widthAt(e);
    if (next !== null) setDragged(next);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (dragged !== null) onWidthChange(dragged);
    setDragged(null);
  };

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
    <>
      <aside
        ref={asideRef}
        className={`sidebar${collapsed ? " sidebar--collapsed" : shown === "sessions" ? "" : " sidebar--wide"}`}
        style={!collapsed && shownWidth !== null ? { width: shownWidth } : undefined}
      >
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
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("app.sidebar.resize")}
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={shownWidth ?? undefined}
          title={t("app.sidebar.resizeHint")}
          className="sidebar__resizer"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => onWidthChange(null)}
        />
      )}
    </>
  );
}
