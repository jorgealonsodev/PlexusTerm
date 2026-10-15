import type { Tab } from "./tabs";

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | null;
  /** Tabs whose output is being logged to a file. */
  logging?: ReadonlySet<string>;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, activeKey, logging, onActivate, onClose, onNew }: TabBarProps) {
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
        >
          {logging?.has(tab.key) && (
            <span className="tab__log" role="img" aria-label="Logging to file" title="Logging to file">
              ●
            </span>
          )}
          <span className="tab__title">{tab.title}</span>
          <button
            className="tab__close"
            aria-label={`Close ${tab.title}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onClose(tab.key)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tabbar__new" aria-label="New local terminal" onClick={onNew}>
        +
      </button>
    </div>
  );
}
