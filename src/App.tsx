import { useCallback, useEffect, useReducer, useState } from "react";
import type { SessionTarget } from "./features/sessions/types";
import { QuickConnectDialog } from "./features/ssh/QuickConnectDialog";
import { TabBar } from "./features/tabs/TabBar";
import { initialTabs, tabsReducer } from "./features/tabs/tabs";
import { TerminalView } from "./features/terminal/TerminalView";
import "./App.css";

const LOCAL: SessionTarget = { type: "local" };

export default function App() {
  // Start with one local terminal open.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs, (s) =>
    tabsReducer(s, { type: "open", target: LOCAL }),
  );
  const [quickConnect, setQuickConnect] = useState(false);

  const open = useCallback((target: SessionTarget) => dispatch({ type: "open", target }), []);
  const openLocal = useCallback(() => open(LOCAL), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      if (e.key === "T") {
        e.preventDefault();
        openLocal();
      } else if (e.key === "S") {
        e.preventDefault();
        setQuickConnect(true);
      } else if (e.key === "W" && state.activeKey) {
        e.preventDefault();
        dispatch({ type: "close", key: state.activeKey });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal, state.activeKey]);

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">NexusTerm</span>
        <button className="btn" onClick={openLocal}>
          Terminal
        </button>
        <button className="btn" onClick={() => setQuickConnect(true)}>
          SSH
        </button>
      </header>
      <TabBar
        tabs={state.tabs}
        activeKey={state.activeKey}
        onActivate={(key) => dispatch({ type: "activate", key })}
        onClose={(key) => dispatch({ type: "close", key })}
        onNew={openLocal}
      />
      <main className="workspace">
        {state.tabs.map((tab) => (
          <TerminalView
            key={tab.key}
            target={tab.target}
            active={tab.key === state.activeKey}
            onTitle={(title) => dispatch({ type: "rename", key: tab.key, title })}
            onExit={() => dispatch({ type: "close", key: tab.key })}
          />
        ))}
        {state.tabs.length === 0 && (
          <div className="empty">
            <p>No open sessions.</p>
            <div className="empty__actions">
              <button className="btn" onClick={openLocal}>
                Start local terminal
              </button>
              <button className="btn" onClick={() => setQuickConnect(true)}>
                New SSH session
              </button>
            </div>
          </div>
        )}
      </main>
      {quickConnect && (
        <QuickConnectDialog
          onCancel={() => setQuickConnect(false)}
          onConnect={(target) => {
            setQuickConnect(false);
            open(target);
          }}
        />
      )}
    </div>
  );
}
