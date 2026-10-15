import type { Tab } from "./tabs";

interface TabBarProps {
  tabs: Tab[];
  activeKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}

export function TabBar({ tabs, activeKey, onActivate, onClose, onNew }: TabBarProps) {
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
