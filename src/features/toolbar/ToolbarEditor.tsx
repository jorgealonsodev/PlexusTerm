import {
  Activity,
  Cable,
  Circle,
  Columns2,
  GripVertical,
  KeyRound,
  KeySquare,
  Link,
  Network,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  Power,
  Radio,
  RotateCcw,
  Rows2,
  ScanSearch,
  Smartphone,
  SquareTerminal,
  Trash2,
  Usb,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import { DRAG_THRESHOLD } from "../drop/pathDrag";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { usePlatform } from "../platform/usePlatform";
import { useGroupName } from "./ToolbarButtons";
import {
  DEFAULT_TOOLBAR_LAYOUT,
  addGroup,
  moveAction,
  moveGroup,
  removeGroup,
  renameGroup,
  whereIs,
  type ToolbarAction,
  type ToolbarGroup,
  type ToolbarLayout,
  type ToolbarPlace,
} from "./toolbarLayout";

/** How each action is named and drawn in the editor (the toolbar itself names some by their state). */
const ACTIONS: Record<ToolbarAction, { label: AppKey | string; icon: LucideIcon }> = {
  sidebar: { label: "settings.toolbar.sidebar", icon: PanelLeftClose },
  terminal: { label: "app.toolbar.terminal", icon: SquareTerminal },
  ssh: { label: "SSH", icon: KeyRound },
  serial: { label: "app.toolbar.serial", icon: Usb },
  telnet: { label: "Telnet…", icon: Cable },
  mosh: { label: "Mosh…", icon: Smartphone },
  openShared: { label: "share.view.open", icon: Link },
  keyGen: { label: "app.tools.keyGenerator", icon: KeySquare },
  portScan: { label: "app.tools.portScanner", icon: ScanSearch },
  networkScan: { label: "app.tools.networkScanner", icon: Network },
  wakeOnLan: { label: "app.tools.wakeOnLan", icon: Power },
  remoteMonitor: { label: "settings.toolbar.remoteMonitor", icon: Activity },
  splitRight: { label: "app.toolbar.splitRight", icon: Columns2 },
  splitDown: { label: "app.toolbar.splitDown", icon: Rows2 },
  multiExec: { label: "app.toolbar.multiExec", icon: Radio },
  recordMacro: { label: "app.toolbar.recordMacro", icon: Circle },
  devColumn: { label: "settings.toolbar.devColumn", icon: PanelRightClose },
};

/** What is being dragged: an action, or a group (which only moves along the bar). */
type Dragged = { kind: "action"; id: ToolbarAction } | { kind: "group"; id: string };
const itemKey = (item: Dragged) => `${item.kind === "action" ? "a" : "g"}:${item.id}`;

/** Where a drop would go: the zone, the index there, and the item it lands before (null: at the end). */
interface Drop extends ToolbarPlace {
  before: string | null;
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How many of a zone's items (wrapped in rows) come before the pointer: those on earlier rows,
 * and those on its row whose middle is before it in the reading direction.
 */
export function dropIndex(boxes: readonly Box[], x: number, y: number, rtl: boolean): number {
  return boxes.filter((box) => {
    if (box.bottom < y) return true;
    if (box.top > y) return false;
    const middle = (box.left + box.right) / 2;
    return rtl ? middle > x : middle < x;
  }).length;
}

interface ToolbarEditorProps {
  /** null is the default layout. */
  layout: ToolbarLayout | null;
  /** The new layout, or null after Reset. */
  onChange: (layout: ToolbarLayout | null) => void;
}

/**
 * Settings → Toolbar: the bar's buttons and groups, and the hidden ones. Each button and group is
 * dragged to its new place; a click on one opens a menu that does the same without dragging.
 */
export function ToolbarEditor({ layout: saved, onChange }: ToolbarEditorProps) {
  const t = useT();
  const groupName = useGroupName();
  const offerMosh = usePlatform() !== "windows";
  const layout = saved ?? DEFAULT_TOOLBAR_LAYOUT;
  const barRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ item: Dragged; drop: Drop | null } | null>(null);
  /** A drag ends with a click on what was dragged: that click must not open its menu. */
  const dragged = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const label = (id: ToolbarAction) => {
    const key = ACTIONS[id].label;
    return key.includes(".") ? t(key as AppKey) : key;
  };
  const groups = layout.bar.filter((entry): entry is ToolbarGroup => entry.kind === "group");

  /** Where the pointer would drop `item`, or null outside every zone that takes it. */
  const locate = (item: Dragged, x: number, y: number): Drop | null => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-zone]");
    if (!target || !rootRef.current?.contains(target)) return null;
    // A group goes on the bar only, wherever over the bar it is dropped.
    const zone = item.kind === "group" ? (barRef.current?.contains(target) ? barRef.current : null) : target;
    if (!zone) return null;
    const key = itemKey(item);
    const items = [...zone.querySelectorAll<HTMLElement>(":scope > [data-item]")].filter((el) => el.dataset.item !== key);
    const index = dropIndex(
      items.map((el) => el.getBoundingClientRect()),
      x,
      y,
      document.documentElement.dir === "rtl",
    );
    return { zone: zone.dataset.zone!, index, before: items[index]?.dataset.item ?? null };
  };

  const startDrag = (e: ReactPointerEvent<HTMLElement>, item: Dragged) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let drop: Drop | null = null;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        dragged.current = true;
        document.body.classList.add("is-dragging-toolbar-item");
      }
      drop = locate(item, ev.clientX, ev.clientY);
      setDrag({ item, drop });
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("is-dragging-toolbar-item");
      setDrag(null);
    };
    const finish = () => {
      end();
      if (!started || !drop) return;
      onChange(item.kind === "action" ? moveAction(layout, item.id, drop) : moveGroup(layout, item.id, drop.index));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", end);
  };

  const openMenu = (el: HTMLElement, items: ContextMenuItem[]) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const box = el.getBoundingClientRect();
    setMenu({ x: box.left, y: box.bottom, items });
  };

  const zoneLength = (zone: string) =>
    zone === "bar"
      ? layout.bar.length
      : zone === "hidden"
        ? layout.hidden.length
        : (groups.find((g) => g.id === zone)?.items.length ?? 0);

  const actionMenu = (id: ToolbarAction): ContextMenuItem[] => {
    const place = whereIs(layout, id)!;
    const items: ContextMenuItem[] = [
      {
        label: t("settings.toolbar.moveLeft"),
        disabled: place.index === 0,
        onSelect: () => onChange(moveAction(layout, id, { ...place, index: place.index - 1 })),
      },
      {
        label: t("settings.toolbar.moveRight"),
        disabled: place.index === zoneLength(place.zone) - 1,
        onSelect: () => onChange(moveAction(layout, id, { ...place, index: place.index + 1 })),
      },
      { separator: true },
    ];
    if (place.zone !== "bar")
      items.push({
        label: t("settings.toolbar.moveToBar"),
        onSelect: () => onChange(moveAction(layout, id, { zone: "bar", index: layout.bar.length })),
      });
    for (const group of groups)
      if (group.id !== place.zone)
        items.push({
          label: t("settings.toolbar.moveToGroup", { name: groupName(group) }),
          onSelect: () => onChange(moveAction(layout, id, { zone: group.id, index: group.items.length })),
        });
    if (place.zone !== "hidden")
      items.push({
        label: t("settings.toolbar.hide"),
        onSelect: () => onChange(moveAction(layout, id, { zone: "hidden", index: layout.hidden.length })),
      });
    return items;
  };

  const groupMenu = (group: ToolbarGroup): ContextMenuItem[] => {
    const index = layout.bar.indexOf(group);
    return [
      {
        label: t("settings.toolbar.moveLeft"),
        disabled: index === 0,
        onSelect: () => onChange(moveGroup(layout, group.id, index - 1)),
      },
      {
        label: t("settings.toolbar.moveRight"),
        disabled: index === layout.bar.length - 1,
        onSelect: () => onChange(moveGroup(layout, group.id, index + 1)),
      },
    ];
  };

  const dropClass = (key: string) =>
    drag?.drop?.before === key ? " toolbar-editor__item--drop-before" : drag && itemKey(drag.item) === key ? " toolbar-editor__item--dragging" : "";
  const zoneClass = (zone: string) =>
    drag?.drop?.zone === zone ? ` toolbar-editor__zone--over${drag.drop.before === null ? " toolbar-editor__zone--drop-end" : ""}` : "";

  const chip = (id: ToolbarAction) => {
    if (id === "mosh" && !offerMosh) return null;
    const Icon = ACTIONS[id].icon;
    const key = `a:${id}`;
    return (
      <button
        key={key}
        type="button"
        data-item={key}
        className={`toolbar-editor__chip${dropClass(key)}`}
        aria-label={t("settings.toolbar.options", { name: label(id) })}
        aria-haspopup="menu"
        title={t("settings.toolbar.chipHint")}
        onPointerDown={(e) => startDrag(e, { kind: "action", id })}
        onClick={(e) => openMenu(e.currentTarget, actionMenu(id))}
      >
        <Icon size={14} />
        {label(id)}
      </button>
    );
  };

  const groupBox = (group: ToolbarGroup) => {
    const key = `g:${group.id}`;
    const name = groupName(group);
    return (
      <div key={key} data-item={key} role="group" aria-label={name} className={`toolbar-editor__group${dropClass(key)}`}>
        <div className="toolbar-editor__group-head">
          <button
            type="button"
            className="toolbar-editor__handle"
            aria-label={t("settings.toolbar.moveGroup", { name })}
            aria-haspopup="menu"
            title={t("settings.toolbar.chipHint")}
            onPointerDown={(e) => startDrag(e, { kind: "group", id: group.id })}
            onClick={(e) => openMenu(e.currentTarget, groupMenu(group))}
          >
            <GripVertical size={14} />
          </button>
          <input
            className="toolbar-editor__name"
            aria-label={t("settings.toolbar.groupName")}
            value={group.name}
            placeholder={groupName({ id: group.id, name: "" })}
            onChange={(e) => onChange(renameGroup(layout, group.id, e.target.value))}
          />
          <button
            type="button"
            className="btn btn--icon toolbar-editor__delete"
            aria-label={t("settings.toolbar.deleteGroup", { name })}
            title={t("settings.toolbar.deleteGroup", { name })}
            onClick={() => onChange(removeGroup(layout, group.id))}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div data-zone={group.id} className={`toolbar-editor__zone toolbar-editor__zone--group${zoneClass(group.id)}`}>
          {group.items.map(chip)}
          {group.items.length === 0 && <span className="toolbar-editor__empty">{t("settings.toolbar.emptyGroup")}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="toolbar-editor" ref={rootRef}>
      <p className="muted">{t("settings.toolbar.intro")}</p>
      <h3 className="settings__group">{t("settings.toolbar.bar")}</h3>
      <div
        ref={barRef}
        role="group"
        aria-label={t("settings.toolbar.bar")}
        data-zone="bar"
        className={`toolbar-editor__zone toolbar-editor__zone--bar${zoneClass("bar")}`}
      >
        {layout.bar.map((entry) => (entry.kind === "action" ? chip(entry.id) : groupBox(entry)))}
      </div>
      <h3 className="settings__group">{t("settings.toolbar.hidden")}</h3>
      <div
        role="group"
        aria-label={t("settings.toolbar.hidden")}
        data-zone="hidden"
        className={`toolbar-editor__zone${zoneClass("hidden")}`}
      >
        {layout.hidden.map(chip)}
        {layout.hidden.length === 0 && <span className="toolbar-editor__empty">{t("settings.toolbar.nothingHidden")}</span>}
      </div>
      <div className="toolbar-editor__actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            onChange(
              addGroup(layout, `g-${crypto.randomUUID().slice(0, 8)}`, t("settings.toolbar.newGroupName", { n: groups.length + 1 })),
            )
          }
        >
          <Plus size={14} /> {t("settings.toolbar.newGroup")}
        </button>
        <button type="button" className="btn" disabled={saved === null} onClick={() => onChange(null)}>
          <RotateCcw size={14} /> {t("settings.toolbar.reset")}
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
