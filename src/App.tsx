import { useCallback, useEffect, useReducer, useState } from "react";
import { toTarget, type SavedSession } from "./features/sessions/library";
import { PasswordPrompt } from "./features/sessions/PasswordPrompt";
import { SessionEditDialog } from "./features/sessions/SessionEditDialog";
import { SessionsPanel } from "./features/sessions/SessionsPanel";
import { SftpPanel } from "./features/sftp/SftpPanel";
import { Sidebar, type SidebarView } from "./features/sidebar/Sidebar";
import type { SessionTarget } from "./features/sessions/types";
import { useSessionLibrary } from "./features/sessions/useSessionLibrary";
import { QuickConnectDialog } from "./features/ssh/QuickConnectDialog";
import { TabBar } from "./features/tabs/TabBar";
import { initialTabs, tabsReducer } from "./features/tabs/tabs";
import { TerminalView } from "./features/terminal/TerminalView";
import { TunnelEditDialog } from "./features/tunnels/TunnelEditDialog";
import { TunnelsPanel } from "./features/tunnels/TunnelsPanel";
import type { Tunnel } from "./features/tunnels/tunnels";
import { useTunnelLauncher } from "./features/tunnels/useTunnelLauncher";
import { useTunnels } from "./features/tunnels/useTunnels";
import "./App.css";

const LOCAL: SessionTarget = { type: "local" };

type Modal =
  | { kind: "quickConnect" }
  | { kind: "editSession"; session: SavedSession; isNew: boolean }
  | { kind: "password"; session: SavedSession }
  | { kind: "editTunnel"; tunnel: Tunnel; isNew: boolean }
  | null;

/** What a terminal tab reported about its backend session. */
interface TabSession {
  sessionId: number | null;
  cwd: string | null;
}

const NO_SESSION: TabSession = { sessionId: null, cwd: null };

const draftSession = (folder: string): SavedSession => ({
  id: crypto.randomUUID(),
  name: "",
  folder,
  host: "",
  port: 22,
  username: "",
  auth: { method: "password" },
});

const draftTunnel = (): Tunnel => ({
  id: crypto.randomUUID(),
  name: "",
  type: "local",
  sessionId: "",
  listenHost: "127.0.0.1",
  listenPort: 8080,
  destHost: "localhost",
  destPort: 80,
});

export default function App() {
  // Start with one local terminal open.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs, (s) =>
    tabsReducer(s, { type: "open", target: LOCAL }),
  );
  const [modal, setModal] = useState<Modal>(null);
  const sessions = useSessionLibrary();
  const tunnels = useTunnels();
  const launcher = useTunnelLauncher(
    sessions.library.sessions,
    tunnels.statusOf,
    tunnels.reportError,
    tunnels.list.tunnels,
  );
  const [tabSessions, setTabSessions] = useState<Record<string, TabSession>>({});
  const [sidebarView, setSidebarView] = useState<SidebarView>("sessions");
  const [followCwd, setFollowCwd] = useState(true);

  const updateTabSession = useCallback((key: string, patch: Partial<TabSession>) => {
    setTabSessions((prev) => {
      const current = prev[key] ?? NO_SESSION;
      const next = { ...current, ...patch };
      return next.sessionId === current.sessionId && next.cwd === current.cwd ? prev : { ...prev, [key]: next };
    });
  }, []);

  // Forget what closed tabs reported.
  useEffect(() => {
    setTabSessions((prev) => {
      const keys = Object.keys(prev).filter((key) => state.tabs.some((t) => t.key === key));
      return keys.length === Object.keys(prev).length ? prev : Object.fromEntries(keys.map((k) => [k, prev[k]]));
    });
  }, [state.tabs]);

  const activeTab = state.tabs.find((t) => t.key === state.activeKey) ?? null;
  const activeSession = (activeTab && tabSessions[activeTab.key]) ?? NO_SESSION;
  const sftpSessionId = activeTab?.target.type === "ssh" ? activeSession.sessionId : null;

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
        <Sidebar
          view={sidebarView}
          onViewChange={setSidebarView}
          sftpAvailable={sftpSessionId !== null}
          sftp={
            activeTab &&
            sftpSessionId !== null && (
              <SftpPanel
                key={`${activeTab.key}:${sftpSessionId}`}
                sessionId={sftpSessionId}
                cwd={activeSession.cwd}
                follow={followCwd}
                onFollowChange={setFollowCwd}
              />
            )
          }
          tunnels={
            <TunnelsPanel
              list={tunnels.list}
              status={tunnels.status}
              saveError={tunnels.saveError}
              sessions={sessions.library.sessions}
              statusOf={tunnels.statusOf}
              onToggle={(tunnel) => {
                if (launcher.isActive(tunnels.statusOf(tunnel.id))) void launcher.stop(tunnel.id);
                else void launcher.start(tunnel);
              }}
              onNew={() => setModal({ kind: "editTunnel", tunnel: draftTunnel(), isNew: true })}
              onEdit={(tunnel) => setModal({ kind: "editTunnel", tunnel, isNew: false })}
              onDelete={(tunnel) => {
                if (window.confirm(`Delete tunnel "${tunnel.name}"?`)) {
                  void launcher.stop(tunnel.id);
                  tunnels.dispatch({ type: "delete", id: tunnel.id });
                }
              }}
              onStartAll={() => void launcher.startAll(tunnels.list.tunnels)}
              onStopAll={() => void launcher.stopAll(tunnels.list.tunnels)}
            />
          }
          sessions={
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
              onImport={(imported) => sessions.dispatch({ type: "saveSessions", sessions: imported })}
              onDeleteFolder={(path) => {
                if (window.confirm(`Delete folder "${path}" and every session inside it?`)) {
                  sessions.dispatch({ type: "deleteFolder", path });
                }
              }}
            />
          }
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
                onCwd={(cwd) => updateTabSession(tab.key, { cwd })}
                onSession={(sessionId) => {
                  updateTabSession(tab.key, { sessionId });
                  // A new SSH connection brings its file browser to the front.
                  if (sessionId !== null && tab.target.type === "ssh") setSidebarView("sftp");
                }}
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
      {modal?.kind === "editTunnel" && (
        <TunnelEditDialog
          tunnel={modal.tunnel}
          isNew={modal.isNew}
          sessions={sessions.library.sessions}
          onCancel={() => setModal(null)}
          onSave={(tunnel) => {
            tunnels.dispatch({ type: "save", tunnel });
            setModal(null);
          }}
        />
      )}
      {launcher.dialog}
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
