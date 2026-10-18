import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import { Code } from "lucide-react";
import { CliIcon, cliName } from "../devmode/CliIcon";
import { titleWithoutCliMark } from "../devmode/devMode";
import { clampTabColumnWidth, TAB_COLUMN_MAX_WIDTH, TAB_COLUMN_MIN_WIDTH } from "../settings/settings";
import { tabTitle, type Tab } from "./tabs";

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | null;
  /** Tabs whose output is being logged to a file. */
  logging?: ReadonlySet<string>;
  /** Tabs where a program asked for attention (bell, desktop notification) out of sight. */
  attention?: ReadonlySet<string>;
  /** Tabs in DEV mode (S10). */
  dev?: ReadonlySet<string>;
  /** DEV mode's layout (S13): a column of rows, each with its CLI's icon and project folder. */
  column?: boolean;
  /** What the column shows of each tab: the CLI it runs (null for none) and its project folder's name. */
  details?: ReadonlyMap<string, { cli: string | null; folder: string | null }>;
  /** The column's width dragged by the user; null keeps the default width. */
  columnWidth?: number | null;
  /** The column's edge was dragged to a width, or double-clicked (null: back to the default). */
  onColumnWidthChange?: (width: number | null) => void;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
  /** Right-click menu actions (the menu leaves out the ones not given). */
  onDuplicate?: (key: string) => void;
  onCloseOthers?: (key: string) => void;
  onCloseRight?: (key: string) => void;
  onCloseAll?: () => void;
  /** Copies a tab's host address (SSH, Telnet and Mosh tabs). */
  onCopyHost?: (host: string) => void;
}

/** The title of a DEV column row with no folder: without the CLI's mark, or the CLI's name. */
function rowTitle(title: string, cli: string | null): string {
  if (!cli) return title;
  return titleWithoutCliMark(title, cli, "") || cliName(cli);
}

/** The host a tab connects to, or null for local and serial terminals. */
function hostOf(tab: Tab): string | null {
  const t = tab.target;
  if (t.type === "ssh" || t.type === "telnet") return t.host;
  if (t.type === "mosh") return t.ssh.host;
  return null;
}

export function TabBar(props: TabBarProps) {
  const { tabs, activeKey, logging, attention, dev, column = false, details, onActivate, onClose, onNew } = props;
  const t = useT();
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const shownWidth = dragged ?? props.columnWidth ?? null;
  // An unmount in the middle of a drag must not leave listeners or the no-selection class behind.
  useEffect(() => () => stopDrag.current?.(), []);

  /**
   * Drags the column's inner edge, as the sidebar's edge is dragged: the pointer is followed over
   * the whole window, text selection is blocked meanwhile, and the width is saved once on release.
   */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    stopDrag.current?.();
    let latest: number | null = null;
    const widthAt = (clientX: number) => {
      const bounds = listRef.current?.getBoundingClientRect();
      if (!bounds) return null;
      // The column sits at the end of the row: its inner edge is on the left (right in RTL).
      const rtl = document.documentElement.dir === "rtl";
      return clampTabColumnWidth(rtl ? clientX - bounds.left : bounds.right - clientX);
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
      if (width !== null) props.onColumnWidthChange?.(width);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    document.body.classList.add("is-resizing");
    stopDrag.current = end;
  };
  const menuIndex = menu ? tabs.findIndex((t) => t.key === menu.key) : -1;
  const menuItems = (key: string) => {
    const host = hostOf(tabs.find((t) => t.key === key)!);
    return [
      props.onCopyHost && host && { label: t("app.tabs.copyHost", { host }), onSelect: () => props.onCopyHost!(host) },
      props.onDuplicate && { label: t("app.tabs.duplicate"), onSelect: () => props.onDuplicate!(key) },
      { label: t("app.tabs.close"), onSelect: () => onClose(key) },
      props.onCloseOthers && {
        label: t("app.tabs.closeOthers"),
        onSelect: () => props.onCloseOthers!(key),
        disabled: tabs.length < 2,
      },
      props.onCloseRight && {
        label: t("app.tabs.closeRight"),
        onSelect: () => props.onCloseRight!(key),
        disabled: menuIndex === tabs.length - 1,
      },
      props.onCloseAll && { label: t("app.tabs.closeAll"), onSelect: props.onCloseAll },
    ].filter((item) => !!item);
  };
  return (
    <>
      <div
        ref={listRef}
        className={`tabbar${column ? " tabbar--column" : ""}`}
        role="tablist"
        aria-orientation={column ? "vertical" : undefined}
        style={column && shownWidth !== null ? { width: shownWidth } : undefined}
      >
        {tabs.map((tab) => (
          <div
            key={tab.key}
            role="tab"
            aria-selected={tab.key === activeKey}
            className={`tab ${tab.key === activeKey ? "tab--active" : ""}${attention?.has(tab.key) ? " tab--attention" : ""}${column ? " tab--row" : ""}`}
            onMouseDown={(e) => {
              if (e.button === 1) onClose(tab.key);
              else if (e.button === 0) onActivate(tab.key);
            }}
            title={tabTitle(tab)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
            }}
          >
            {column && <CliIcon cli={details?.get(tab.key)?.cli ?? null} />}
            {logging?.has(tab.key) && (
              <span className="tab__log" role="img" aria-label={t("app.tabs.logging")} title={t("app.tabs.logging")}>
                ●
              </span>
            )}
            {attention?.has(tab.key) && (
              <span className="tab__attention" role="img" aria-label={t("app.tabs.attention")} title={t("app.tabs.attention")} />
            )}
            <span className="tab__title" dir="auto">
              {/* A DEV row names its folder only: the icon already says which tool runs there. */}
              {column ? (details?.get(tab.key)?.folder ?? rowTitle(tabTitle(tab), details?.get(tab.key)?.cli ?? null)) : tabTitle(tab)}
            </span>
            {dev?.has(tab.key) && (
              <span className="tab__dev" role="img" aria-label={t("app.tabs.dev")} title={t("app.tabs.dev")}>
                <Code size={12} aria-hidden="true" />
              </span>
            )}
            <button
              className="tab__close"
              aria-label={t("app.tabs.closeNamed", { title: tabTitle(tab) })}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose(tab.key)}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tabbar__new" aria-label={t("app.tabs.newLocal")} onClick={onNew}>
          +
        </button>
        {menu && menuIndex !== -1 && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.key)} onClose={() => setMenu(null)} />
        )}
      </div>
      {column && (
        // After the column in the tree: DEV mode's row-reverse layout puts it between the terminals and the column.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("app.tabs.resizeColumn")}
          aria-valuemin={TAB_COLUMN_MIN_WIDTH}
          aria-valuemax={TAB_COLUMN_MAX_WIDTH}
          aria-valuenow={shownWidth ?? undefined}
          title={t("app.tabs.resizeColumnHint")}
          className="tabbar__resizer"
          onPointerDown={startDrag}
          onDoubleClick={() => props.onColumnWidthChange?.(null)}
        />
      )}
    </>
  );
}
