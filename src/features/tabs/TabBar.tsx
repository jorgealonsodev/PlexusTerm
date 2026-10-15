import { useState } from "react";
import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import type { Tab } from "./tabs";

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | null;
  /** Tabs whose output is being logged to a file. */
  logging?: ReadonlySet<string>;
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

/** The host a tab connects to, or null for local and serial terminals. */
function hostOf(tab: Tab): string | null {
  const t = tab.target;
  if (t.type === "ssh" || t.type === "telnet") return t.host;
  if (t.type === "mosh") return t.ssh.host;
  return null;
}

export function TabBar(props: TabBarProps) {
  const { tabs, activeKey, logging, onActivate, onClose, onNew } = props;
  const t = useT();
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
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
    <div className="tabbar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tab"
          aria-selected={tab.key === activeKey}
          className={`tab ${tab.key === activeKey ? "tab--active" : ""}`}
          onMouseDown={(e) => {
            if (e.button === 1) onClose(tab.key);
            else if (e.button === 0) onActivate(tab.key);
          }}
          title={tab.title}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ key: tab.key, x: e.clientX, y: e.clientY });
          }}
        >
          {logging?.has(tab.key) && (
            <span className="tab__log" role="img" aria-label={t("app.tabs.logging")} title={t("app.tabs.logging")}>
              ●
            </span>
          )}
          <span className="tab__title">{tab.title}</span>
          <button
            className="tab__close"
            aria-label={t("app.tabs.closeNamed", { title: tab.title })}
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
  );
}
