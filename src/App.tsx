import { useCallback, useEffect, useReducer } from "react";
import { TabBar } from "./features/tabs/TabBar";
import { initialTabs, tabsReducer } from "./features/tabs/tabs";
import { TerminalView } from "./features/terminal/TerminalView";
import "./App.css";

const LOCAL_TITLE = "Local shell";

export default function App() {
  // Start with one local terminal open.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs, (s) =>
    tabsReducer(s, { type: "open", title: LOCAL_TITLE }),
  );

  const openLocal = useCallback(() => dispatch({ type: "open", title: LOCAL_TITLE }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      if (e.key === "T") {
        e.preventDefault();
        openLocal();
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
        <button className="toolbar__btn" onClick={openLocal}>
          New terminal
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
            active={tab.key === state.activeKey}
            onTitle={(title) => dispatch({ type: "rename", key: tab.key, title })}
            onExit={() => dispatch({ type: "close", key: tab.key })}
          />
        ))}
        {state.tabs.length === 0 && (
          <div className="empty">
            <p>No open sessions.</p>
            <button className="toolbar__btn" onClick={openLocal}>
              Start local terminal
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
