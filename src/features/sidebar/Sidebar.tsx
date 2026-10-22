import { ArrowLeftRight, FolderTree, HardDrive, Keyboard, Star, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "../../i18n/i18n";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from "../settings/settings";

export const SIDEBAR_VIEWS = ["sessions", "sftp", "explorer", "tunnels", "macros"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

interface SidebarProps {
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  /** True while the focused pane of the active tab is a connected SSH session. */
  sftpAvailable: boolean;
  /** True while the active tab is a local terminal. */
  localAvailable: boolean;
  sessions: ReactNode;
  sftp: ReactNode;
  local: ReactNode;
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
 * Left sidebar with the "Sessions", "SFTP", "Explorer", "Tunnels" and "Macros" tabs; SFTP and Explorer fall
 * back to Sessions when unavailable. Its edge can be dragged to change the width (kept within the sidebar's limits).
 */
export function Sidebar({
  view,
  onViewChange,
  sftpAvailable,
  localAvailable,
  sessions,
  sftp,
  local,
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
  /** Ends the drag in progress (removes its window listeners); null when not dragging. */
  const stopDrag = useRef<(() => void) | null>(null);
  // A file browser that does not fit the active tab gives way to the one that does (SFTP for SSH,
  // Explorer for a local terminal), otherwise to Sessions.
  const fileView: SidebarView = sftpAvailable ? "sftp" : localAvailable ? "explorer" : "sessions";
  const shown: SidebarView =
    (view === "sftp" && !sftpAvailable) || (view === "explorer" && !localAvailable) ? fileView : view;
  const shownWidth = dragged ?? width;
  // An unmount in the middle of a drag must not leave listeners or the no-selection class behind.
  useEffect(() => () => stopDrag.current?.(), []);

  /**
   * Follows the pointer over the whole window, not just the thin handle: a fast move leaves the
   * handle, and WebKitGTK may give the events to a text selection instead. Text selection is
   * blocked while dragging; the setting is written once, when the button is released.
   */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    stopDrag.current?.();
    let latest: number | null = null;
    const widthAt = (clientX: number) => {
      const bounds = asideRef.current?.getBoundingClientRect();
      if (!bounds) return null;
      const rtl = document.documentElement.dir === "rtl";
      return clampSidebarWidth(rtl ? bounds.right - clientX : clientX - bounds.left);
    };
    const move = (ev: PointerEvent) => {
      const next = widthAt(ev.clientX);
      if (next === null) return;
      latest = next;
      setDragged(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-resizing");
      stopDrag.current = null;
      setDragged(null);
    };
    const finish = () => {
      const width = latest;
      end();
      if (width !== null) onWidthChange(width);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    document.body.classList.add("is-resizing");
    stopDrag.current = end;
  };

  const tab = (id: SidebarView, label: string, Icon: LucideIcon, unavailable: string | null = null) => (
    <button
      role="tab"
      aria-selected={shown === id}
      aria-label={label}
      className={`sidebar__tab${shown === id ? " sidebar__tab--active" : ""}`}
      disabled={unavailable !== null}
      title={unavailable ?? label}
      onClick={() => {
        onViewChange(id);
        if (collapsed) onExpand();
      }}
    >
      <Icon size={16} />
      {!collapsed && <span className="sidebar__tab-label">{label}</span>}
    </button>
  );
  const panels: Record<SidebarView, ReactNode> = { sessions, sftp, explorer: local, tunnels, macros };
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
          {tab("explorer", t("app.sidebar.explorer"), HardDrive, localAvailable ? null : t("app.sidebar.explorerUnavailable"))}
          {tab("sessions", t("app.sidebar.sessions"), Star)}
          {tab("sftp", "SFTP", FolderTree, sftpAvailable ? null : t("app.sidebar.sftpUnavailable"))}
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
          onDoubleClick={() => onWidthChange(null)}
        />
      )}
    </>
  );
}
