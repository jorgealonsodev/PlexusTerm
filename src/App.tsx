import { useCallback, useEffect, useReducer, useState } from "react";
import { toTarget, type SavedSession } from "./features/sessions/library";
import { PasswordPrompt } from "./features/sessions/PasswordPrompt";
import { SessionEditDialog } from "./features/sessions/SessionEditDialog";
import { SessionsPanel } from "./features/sessions/SessionsPanel";
import type { SessionTarget } from "./features/sessions/types";
import { useSessionLibrary } from "./features/sessions/useSessionLibrary";
import { QuickConnectDialog } from "./features/ssh/QuickConnectDialog";
import { TabBar } from "./features/tabs/TabBar";
import { initialTabs, tabsReducer } from "./features/tabs/tabs";
import { TerminalView } from "./features/terminal/TerminalView";
import "./App.css";

const LOCAL: SessionTarget = { type: "local" };

type Modal =
  | { kind: "quickConnect" }
  | { kind: "editSession"; session: SavedSession; isNew: boolean }
  | { kind: "password"; session: SavedSession }
  | null;

const draftSession = (folder: string): SavedSession => ({
  id: crypto.randomUUID(),
  name: "",
  folder,
  host: "",
  port: 22,
  username: "",
  auth: { method: "password" },
});

export default function App() {
  // Start with one local terminal open.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs, (s) =>
    tabsReducer(s, { type: "open", target: LOCAL }),
  );
  const [modal, setModal] = useState<Modal>(null);
  const sessions = useSessionLibrary();

  const open = useCallback((target: SessionTarget) => dispatch({ type: "open", target }), []);
  const openLocal = useCallback(() => open(LOCAL), [open]);

  const openSaved = (session: SavedSession) => {
    if (session.auth.method === "password") setModal({ kind: "password", session });
    else open(toTarget(session));
  };

  const newFolder = (parent: string) => {
    const name = window.prompt(parent ? `New folder inside "${parent}"` : "New folder");
    if (name?.trim()) sessions.dispatch({ type: "addFolder", path: parent ? `${parent}/${name}` : name });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      if (e.key === "T") {
        e.preventDefault();
        openLocal();
      } else if (e.key === "S") {
        e.preventDefault();
        setModal({ kind: "quickConnect" });
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
        <button className="btn" onClick={() => setModal({ kind: "quickConnect" })}>
          SSH
        </button>
      </header>
      <div className="body">
        <SessionsPanel
          library={sessions.library}
          status={sessions.status}
          saveError={sessions.saveError}
          onOpen={openSaved}
          onNewSession={(folder) => setModal({ kind: "editSession", session: draftSession(folder), isNew: true })}
          onEdit={(session) => setModal({ kind: "editSession", session, isNew: false })}
          onDelete={(session) => {
            if (window.confirm(`Delete session "${session.name}"?`)) {
              sessions.dispatch({ type: "deleteSession", id: session.id });
            }
          }}
          onNewFolder={newFolder}
          onDeleteFolder={(path) => {
            if (window.confirm(`Delete folder "${path}" and every session inside it?`)) {
              sessions.dispatch({ type: "deleteFolder", path });
            }
          }}
        />
        <section className="main">
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
                  <button className="btn" onClick={() => setModal({ kind: "quickConnect" })}>
                    New SSH session
                  </button>
                </div>
              </div>
            )}
          </main>
        </section>
      </div>

      {modal?.kind === "quickConnect" && (
        <QuickConnectDialog
          onCancel={() => setModal(null)}
          onConnect={(target) => {
            setModal(null);
            open(target);
          }}
        />
      )}
      {modal?.kind === "editSession" && (
        <SessionEditDialog
          session={modal.session}
          isNew={modal.isNew}
          folders={sessions.library.folders}
          onCancel={() => setModal(null)}
          onSave={(session) => {
            sessions.dispatch({ type: "saveSession", session });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "password" && (
        <PasswordPrompt
          label={`${modal.session.username}@${modal.session.host}`}
          onCancel={() => setModal(null)}
          onSubmit={(password) => {
            const session = modal.session;
            setModal(null);
            open(toTarget(session, password));
          }}
        />
      )}
    </div>
  );
}
