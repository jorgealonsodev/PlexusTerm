import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import { ColorMenu } from "../toolbar/ColorMenu";
import { Code } from "lucide-react";
import { CliIcon, cliName } from "../devmode/CliIcon";
import { titleWithoutCliMark } from "../devmode/devMode";
import { clampTabColumnWidth, TAB_COLUMN_MAX_WIDTH, TAB_COLUMN_MIN_WIDTH } from "../settings/settings";
import { DRAG_THRESHOLD } from "../drop/pathDrag";
import { tabTitle, type Tab } from "./tabs";

/** A terminal of a DEV tab that hides some, as the column lists it; `shown`: the one on screen. */
interface PaneRow {
  id: string;
  title: string;
  folder: string | null;
  shown: boolean;
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | null;
  /** Tabs whose output is being logged to a file. */
  logging?: ReadonlySet<string>;
  /** Tabs where a program asked for attention (bell, desktop notification) out of sight. */
  attention?: ReadonlySet<string>;
  /** Tabs in DEV mode (S10). */
  dev?: ReadonlySet<string>;
  /** Tabs whose AI CLI is working: a spinner shows it. */
  busy?: ReadonlySet<string>;
  /** DEV mode's layout (S13): a column of rows, each with its CLI's icon and project folder. */
  column?: boolean;
  /** The column folded to a narrow strip of its rows' icons, each titled with its tab's title. */
  collapsed?: boolean;
  /** What the column shows of each tab: the CLI it runs (null for none) and its project folder's name. */
  details?: ReadonlyMap<string, { cli: string | null; folder: string | null }>;
  /**
   * In the column: the terminals of a DEV tab that keeps some out of sight, listed under its row by
   * tab key; `shown` marks the one on screen.
   */
  hiddenPanes?: ReadonlyMap<string, readonly PaneRow[]>;
  /** A hidden terminal of the column was clicked: the tab shows it instead. */
  onShowPane?: (key: string, pane: string) => void;
  /** A hidden terminal's close button (or middle click). */
  onClosePane?: (key: string, pane: string) => void;
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
  /** Gives a tab a colour (null: none); without it the menu has no colour item. */
  onColor?: (key: string, color: string | null) => void;
  /** A tab dragged to another place: `to` is its index in the new order. Without it tabs do not drag. */
  onMove?: (key: string, to: number) => void;
}

/**
 * The title of a DEV column row: without the CLI's mark, and none at all when all that is left is
 * the CLI's own name (the icon says it) and the row shows a folder; the CLI's name otherwise.
 */
function rowTitle(title: string, cli: string | null, hasFolder: boolean): string | null {
  if (!cli) return title;
  const rest = titleWithoutCliMark(title, cli, "");
  const nameOnly = !rest || [cli, cliName(cli)].some((name) => name.toLowerCase() === rest.toLowerCase());
  if (!nameOnly) return rest;
  return hasFolder ? null : cliName(cli);
}

/** The host a tab connects to, or null for local and serial terminals. */
function hostOf(tab: Tab): string | null {
  const t = tab.target;
  if (t.type === "ssh" || t.type === "telnet") return t.host;
  if (t.type === "mosh") return t.ssh.host;
  return null;
}

export function TabBar(props: TabBarProps) {
  const { tabs, activeKey, logging, attention, dev, busy, column = false, details, onActivate, onClose, onNew } = props;
  const folded = column && (props.collapsed ?? false);
  const t = useT();
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [colorMenu, setColorMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const shownWidth = dragged ?? props.columnWidth ?? null;
  /** The tab being dragged to another place, and where it would land (before or after `at`). */
  const [moving, setMoving] = useState<{ key: string; at: string; after: boolean } | null>(null);
  const stopMove = useRef<(() => void) | null>(null);
  // An unmount in the middle of a drag must not leave listeners or the no-selection class behind.
  useEffect(
    () => () => {
      stopDrag.current?.();
      stopMove.current?.();
    },
    [],
  );

  /**
   * Drags a tab to another place along the bar, or up and down the column. The pointer is followed
   * over the whole window; a press that moves less than DRAG_THRESHOLD stays a click.
   */
  const startMove = (e: ReactPointerEvent<HTMLElement>, key: string) => {
    if (!props.onMove || e.button !== 0 || (e.target as Element).closest(".tab__close")) return;
    stopMove.current?.();
    const from = tabs.findIndex((tab) => tab.key === key);
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let to: number | null = null;
    /** Where the pointer drops the tab: its index among the other tabs, by their middles. */
    const place = (ev: PointerEvent) => {
      const others = tabs.filter((tab) => tab.key !== key);
      const middles = others.map((tab) => {
        const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(`[data-tab-key="${CSS.escape(tab.key)}"]`) ?? [])];
        const boxes = rows.map((row) => row.getBoundingClientRect());
        if (boxes.length === 0) return Infinity;
        return column
          ? (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2
          : (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
      });
      const at = column ? ev.clientY : ev.clientX;
      const rtl = !column && document.documentElement.dir === "rtl";
      const index = middles.filter((middle) => (rtl ? middle > at : middle < at)).length;
      to = index;
      if (others.length === 0) return setMoving(null);
      const after = index === others.length;
      setMoving({ key, at: others[after ? index - 1 : index].key, after });
    };
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        document.body.classList.add("is-moving-tab");
      }
      place(ev);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("is-moving-tab");
      stopMove.current = null;
      setMoving(null);
    };
    const finish = () => {
      end();
      if (started && to !== null && to !== from) props.onMove?.(key, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", end);
    stopMove.current = end;
  };
  /** The drag classes of one of a tab's rows: dragged, or where the dragged tab would land. */
  const moveClass = (key: string, first: boolean, last: boolean) => {
    if (!moving) return "";
    if (moving.key === key) return " tab--dragging";
    if (moving.at !== key) return "";
    if (moving.after) return last ? " tab--drop-after" : "";
    return first ? " tab--drop-before" : "";
  };

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
      props.onColor && menu && { label: t("app.tabs.colour"), onSelect: () => setColorMenu({ key, x: menu.x, y: menu.y }) },
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
        className={`tabbar${column ? " tabbar--column" : ""}${folded ? " tabbar--collapsed" : ""}`}
        role="tablist"
        aria-orientation={column ? "vertical" : undefined}
        style={column && !folded && shownWidth !== null ? { width: shownWidth } : undefined}
      >
        {tabs.map((tab) => {
          const paneRows = column ? props.hiddenPanes?.get(tab.key) : undefined;
          /**
           * The tab's row. When the tab lists its terminals, it stands for the one on screen (its
           * title, folder and close button), so each terminal has one row and no extra row repeats it.
           */
          const rowCount = paneRows?.length ? paneRows.length : 1;
          const tabRow = (pane?: PaneRow, n = 0) => {
            const close = () => (pane ? props.onClosePane?.(tab.key, pane.id) : onClose(tab.key));
            const label = pane?.title ?? tabTitle(tab);
            const folder = column ? (pane ? pane.folder : details?.get(tab.key)?.folder) : null;
            const shown = pane
              ? (rowTitle(pane.title, details?.get(tab.key)?.cli ?? null, !!pane.folder) ?? pane.title)
              : column
                ? rowTitle(tabTitle(tab), details?.get(tab.key)?.cli ?? null, !!details?.get(tab.key)?.folder)
                : tabTitle(tab);
            return (
              <div
                key={pane?.id ?? tab.key}
                role="tab"
                aria-selected={tab.key === activeKey}
                className={`tab ${tab.key === activeKey ? "tab--active" : ""}${attention?.has(tab.key) ? " tab--attention" : ""}${column ? " tab--row" : ""}${tab.color ? " tab--coloured" : ""}${moveClass(tab.key, n === 0, n === rowCount - 1)}`}
                style={tab.color ? ({ "--tab-color": tab.color } as CSSProperties) : undefined}
                data-tab-key={tab.key}
                onPointerDown={(e) => startMove(e, tab.key)}
                onMouseDown={(e) => {
                  if (e.button === 1) close();
                  else if (e.button === 0) onActivate(tab.key);
                }}
                title={label}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
                }}
              >
                {column && <CliIcon cli={details?.get(tab.key)?.cli ?? null} />}
                {busy?.has(tab.key) && (
                  <span className="tab__busy" role="img" aria-label={t("app.tabs.working")} title={t("app.tabs.working")} />
                )}
                {logging?.has(tab.key) && (
                  <span className="tab__log" role="img" aria-label={t("app.tabs.logging")} title={t("app.tabs.logging")}>
                    ●
                  </span>
                )}
                {attention?.has(tab.key) && (
                  <span className="tab__attention" role="img" aria-label={t("app.tabs.attention")} title={t("app.tabs.attention")} />
                )}
                {!folded && shown !== null && (
                  <span className="tab__title" dir="auto">
                    {shown}
                  </span>
                )}
                {!folded && folder && (
                  <span className="tab__folder" dir="auto">
                    {folder}
                  </span>
                )}
                {!folded && dev?.has(tab.key) && (
                  <span className="tab__dev" role="img" aria-label={t("app.tabs.dev")} title={t("app.tabs.dev")}>
                    <Code size={12} aria-hidden="true" />
                  </span>
                )}
                {!folded && (
                  <button
                    className="tab__close"
                    aria-label={t("app.tabs.closeNamed", { title: label })}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={close}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          };
          /** A terminal of the tab out of sight: the same row as a tab's; a click shows it. */
          const paneRow = (pane: PaneRow, n: number) => {
            const show = () => {
              onActivate(tab.key);
              props.onShowPane?.(tab.key, pane.id);
            };
            return (
              <div
                key={pane.id}
                className={`tab tab--row${moveClass(tab.key, n === 0, n === rowCount - 1)}`}
                data-tab-key={tab.key}
                onPointerDown={(e) => startMove(e, tab.key)}
                role="button"
                tabIndex={0}
                title={pane.title}
                onMouseDown={(e) => {
                  if (e.button === 1) props.onClosePane?.(tab.key, pane.id);
                  else if (e.button === 0) show();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") show();
                }}
              >
                <CliIcon cli={null} />
                {!folded && (
                  <>
                    <span className="tab__title" dir="auto">
                      {pane.title}
                    </span>
                    {pane.folder && (
                      <span className="tab__folder" dir="auto">
                        {pane.folder}
                      </span>
                    )}
                    <button
                      className="tab__close"
                      aria-label={t("app.tabs.closeNamed", { title: pane.title })}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => props.onClosePane?.(tab.key, pane.id)}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          };
          if (!paneRows?.length) return tabRow();
          return <Fragment key={tab.key}>{paneRows.map((pane, n) => (pane.shown ? tabRow(pane, n) : paneRow(pane, n)))}</Fragment>;
        })}
        <button className="tabbar__new" aria-label={t("app.tabs.newLocal")} onClick={onNew}>
          +
        </button>
        {colorMenu && props.onColor && (
          <ColorMenu
            x={colorMenu.x}
            y={colorMenu.y}
            current={tabs.find((tab) => tab.key === colorMenu.key)?.color ?? null}
            onPick={(color) => props.onColor!(colorMenu.key, color)}
            onClose={() => setColorMenu(null)}
          />
        )}
        {menu && menuIndex !== -1 && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.key)} onClose={() => setMenu(null)} />
        )}
      </div>
      {column && !folded && (
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
