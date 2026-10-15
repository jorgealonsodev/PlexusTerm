import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { broadcastTargets, createWriterRegistry, multiExecGroup, type PaneInfo } from "./features/panes/multiExec";
import { MultiExecBanner } from "./features/panes/MultiExecBanner";
import { PaneGrid } from "./features/panes/PaneGrid";
import { MAX_PANES, paneIds } from "./features/panes/paneLayout";
import { shortcutFor } from "./features/panes/shortcuts";
import { SerialDialog } from "./features/serial/SerialDialog";
import { chainTarget, collectLogins, hopLabel, type PasswordAnswer } from "./features/sessions/jumpHosts";
import {
  isSshSession,
  jumpUsers,
  resolveChain,
  toTarget,
  type LibraryAction,
  type LibrarySession,
  type SavedSession,
} from "./features/sessions/library";
import { removedSshSessions, secretToForgetOnEdit } from "./features/sessions/passwordFlow";
import { PasswordPrompt } from "./features/sessions/PasswordPrompt";
import { forgetSecrets, secretExists } from "./features/sessions/secrets";
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
import markUrl from "./assets/nexusterm-mark.svg";
import "./App.css";

const LOCAL: SessionTarget = { type: "local" };

type Modal =
  | { kind: "quickConnect" }
  | { kind: "serial" }
  | { kind: "editSession"; session: LibrarySession; isNew: boolean }
  /** Password of one hop of a saved session (jump hosts first, then the target). */
  | { kind: "password"; label: string; resolve: (answer: PasswordAnswer | null) => void }
  | { kind: "editTunnel"; tunnel: Tunnel; isNew: boolean }
  | null;

/** What a terminal pane reported about its backend session, plus its multi-execution exclusion. */
interface PaneMeta {
  sessionId: number | null;
  cwd: string | null;
  excluded: boolean;
}

const NO_SESSION: PaneMeta = { sessionId: null, cwd: null, excluded: false };

const draftSession = (folder: string): SavedSession => ({
  kind: "ssh",
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
  // Tunnels run over SSH, so they only see SSH sessions.
  const sshSessions = useMemo(() => sessions.library.sessions.filter(isSshSession), [sessions.library.sessions]);
  const tunnels = useTunnels();
  const launcher = useTunnelLauncher(
    sessions.library.sessions,
    tunnels.statusOf,
    tunnels.reportError,
    tunnels.list.tunnels,
  );
  const [paneMeta, setPaneMeta] = useState<Record<string, PaneMeta>>({});
  const [sidebarView, setSidebarView] = useState<SidebarView>("sessions");
  const [followCwd, setFollowCwd] = useState(true);
  // Multi-execution is off at start and never persisted (S11.4).
  const [multiExec, setMultiExec] = useState(false);
  const [writers] = useState(createWriterRegistry);
  /** Non-blocking message, e.g. a saved password the keyring refused to delete. */
  const [notice, setNotice] = useState<string | null>(null);

  const updatePane = useCallback((paneId: string, patch: Partial<PaneMeta>) => {
    setPaneMeta((prev) => {
      const current = prev[paneId] ?? NO_SESSION;
      const next = { ...current, ...patch };
      return next.sessionId === current.sessionId && next.cwd === current.cwd && next.excluded === current.excluded
        ? prev
        : { ...prev, [paneId]: next };
    });
  }, []);

  // Forget what closed panes reported.
  useEffect(() => {
    const open = new Set(state.tabs.flatMap((t) => paneIds(t.layout)));
    setPaneMeta((prev) => {
      const ids = Object.keys(prev).filter((id) => open.has(id));
      return ids.length === Object.keys(prev).length ? prev : Object.fromEntries(ids.map((id) => [id, prev[id]]));
    });
  }, [state.tabs]);

  const activeTab = state.tabs.find((t) => t.key === state.activeKey) ?? null;
  // SFTP and the followed folder belong to the focused pane of the active tab (S11.5).
  const activePane = activeTab?.focusedPane ?? null;
  const activeSession = (activePane && paneMeta[activePane]) || NO_SESSION;
  const sftpSessionId = activeTab?.target.type === "ssh" ? activeSession.sessionId : null;
  const canSplit = activeTab !== null && paneIds(activeTab.layout).length < MAX_PANES;

  const allPanes: PaneInfo[] = state.tabs.flatMap((t) =>
    paneIds(t.layout).map((id) => ({
      id,
      sessionId: paneMeta[id]?.sessionId ?? null,
      excluded: paneMeta[id]?.excluded ?? false,
    })),
  );

  /** Mirrors what is typed in the focused pane of the active tab to the other panes of the group. */
  const broadcast = (paneId: string, data: string) => {
    if (!multiExec || !activeTab || activeTab.focusedPane !== paneId) return;
    writers.write(broadcastTargets(allPanes, paneId), data);
  };

  const open = useCallback((target: SessionTarget) => dispatch({ type: "open", target }), []);
  const openLocal = useCallback(() => open(LOCAL), [open]);

  /**
   * SSH sessions go through their jump hosts (S14). Every password hop uses the password
   * saved in the keyring when there is one, otherwise it is asked, one hop at a time.
   */
  const openSaved = async (session: LibrarySession) => {
    if (!isSshSession(session)) return open(toTarget(session));
    const chain = resolveChain(sessions.library, session);
    if (!chain.ok) return setNotice(chain.error);
    const hops = [...chain.jumps, session];
    const logins = await collectLogins(hops, {
      secretExists,
      askPassword: (index) =>
        new Promise((resolve) => setModal({ kind: "password", label: hopLabel(hops, index), resolve })),
    });
    if (logins) open(chainTarget(hops, logins));
  };

  /** Deletes sessions and the passwords saved for them; a keyring failure only shows a notice. */
  const deleteSessions = (action: LibraryAction) => {
    const ids = removedSshSessions(sessions.library, action).map((s) => s.id);
    sessions.dispatch(action);
    void forgetSecrets(ids).then((error) => error && setNotice(error));
  };

  /** Asks before deleting, naming the sessions that use the deleted ones as jump hosts (S14.5). */
  const confirmDelete = (question: string, action: LibraryAction) => {
    const ids = removedSshSessions(sessions.library, action).map((s) => s.id);
    const users = jumpUsers(sessions.library, ids).map((s) => `"${s.name}"`);
    const note = users.length
      ? `\n\nUsed as a jump host by ${users.join(", ")}; it will be removed from their jump hosts.`
      : "";
    if (window.confirm(question + note)) deleteSessions(action);
  };

  const newFolder = (parent: string) => {
    const name = window.prompt(parent ? `New folder inside "${parent}"` : "New folder");
    if (name?.trim()) sessions.dispatch({ type: "addFolder", path: parent ? `${parent}/${name}` : name });
  };

  // Terminals let these keys through unhandled (see TerminalView), so the window sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const shortcut = shortcutFor(e);
      if (!shortcut) return;
      e.preventDefault();
      switch (shortcut.type) {
        case "newTerminal":
          return openLocal();
        case "quickConnect":
          return setModal({ kind: "quickConnect" });
        case "toggleMultiExec":
          return setMultiExec((on) => !on);
      }
      if (!activeTab) return;
      const key = activeTab.key;
      if (shortcut.type === "closePane") dispatch({ type: "closePane", key, paneId: activeTab.focusedPane });
      else if (shortcut.type === "split") dispatch({ type: "split", key, direction: shortcut.direction });
      else dispatch({ type: "focusDirection", key, direction: shortcut.direction });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal, activeTab]);

  const split = (direction: "row" | "column") => {
    if (activeTab) dispatch({ type: "split", key: activeTab.key, direction });
  };

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">
          <img className="brand__mark" src={markUrl} alt="" aria-hidden="true" />
          NexusTerm
        </span>
        <button className="btn" onClick={openLocal}>
          Terminal
        </button>
        <button className="btn" onClick={() => setModal({ kind: "quickConnect" })}>
          SSH
        </button>
        <button className="btn" onClick={() => setModal({ kind: "serial" })}>
          Serial
        </button>
        <button className="btn" disabled={!canSplit} title="Ctrl+Shift+D" onClick={() => split("row")}>
          Split right
        </button>
        <button className="btn" disabled={!canSplit} title="Ctrl+Shift+E" onClick={() => split("column")}>
          Split down
        </button>
        <button
          className={`btn${multiExec ? " btn--pressed" : ""}`}
          aria-pressed={multiExec}
          title="Ctrl+Shift+M"
          onClick={() => setMultiExec((on) => !on)}
        >
          Multi-exec
        </button>
      </header>
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {multiExec && (
        <MultiExecBanner count={multiExecGroup(allPanes).length} onTurnOff={() => setMultiExec(false)} />
      )}
      <div className="body">
        <Sidebar
          view={sidebarView}
          onViewChange={setSidebarView}
          sftpAvailable={sftpSessionId !== null}
          sftp={
            activeTab &&
            sftpSessionId !== null && (
              <SftpPanel
                key={`${activePane}:${sftpSessionId}`}
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
              sessions={sshSessions}
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
              onOpen={(session) => void openSaved(session)}
              onNewSession={(folder) => setModal({ kind: "editSession", session: draftSession(folder), isNew: true })}
              onEdit={(session) => setModal({ kind: "editSession", session, isNew: false })}
              onDelete={(session) =>
                confirmDelete(`Delete session "${session.name}"?`, { type: "deleteSession", id: session.id })
              }
              onNewFolder={newFolder}
              onImport={(imported) => sessions.dispatch({ type: "saveSessions", sessions: imported })}
              onDeleteFolder={(path) =>
                confirmDelete(`Delete folder "${path}" and every session inside it?`, { type: "deleteFolder", path })
              }
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
            {state.tabs.map((tab) => {
              const active = tab.key === state.activeKey;
              return (
                <div key={tab.key} className="tab-panes" hidden={!active}>
                  <PaneGrid
                    layout={tab.layout}
                    focusedPane={tab.focusedPane}
                    onFocusPane={(paneId) => dispatch({ type: "focusPane", key: tab.key, paneId })}
                    onResize={(splitId, ratio) => dispatch({ type: "resizeSplit", key: tab.key, splitId, ratio })}
                    renderPane={(paneId) => {
                      const excluded = paneMeta[paneId]?.excluded ?? false;
                      return (
                        <>
                          <TerminalView
                            target={tab.target}
                            active={active}
                            focused={paneId === tab.focusedPane}
                            onTitle={(title) => {
                              if (paneId === tab.focusedPane) dispatch({ type: "rename", key: tab.key, title });
                            }}
                            onExit={() => dispatch({ type: "closePane", key: tab.key, paneId })}
                            onCwd={(cwd) => updatePane(paneId, { cwd })}
                            onSession={(sessionId) => {
                              updatePane(paneId, { sessionId });
                              // A new SSH connection brings its file browser to the front.
                              if (sessionId !== null && tab.target.type === "ssh") setSidebarView("sftp");
                            }}
                            onInput={(data) => broadcast(paneId, data)}
                            registerWriter={(write) => writers.register(paneId, write)}
                          />
                          {multiExec && (
                            <button
                              className={`pane__exclude${excluded ? " pane__exclude--on" : ""}`}
                              aria-pressed={excluded}
                              aria-label="Exclude from multi-execution"
                              title={excluded ? "Excluded from multi-execution" : "Exclude from multi-execution"}
                              // Keep the keyboard focus where it is.
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={() => updatePane(paneId, { excluded: !excluded })}
                            >
                              {excluded ? "excluded" : "exclude"}
                            </button>
                          )}
                        </>
                      );
                    }}
                  />
                </div>
              );
            })}
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
      {modal?.kind === "serial" && (
        <SerialDialog
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
          jumpCandidates={sshSessions}
          onCancel={() => setModal(null)}
          onSave={(session) => {
            const before = modal.session;
            sessions.dispatch({ type: "saveSession", session });
            // Switching away from password authentication drops the saved password too.
            if (isSshSession(before)) {
              const stale = secretToForgetOnEdit(before, session as SavedSession);
              if (stale) void forgetSecrets([stale]).then((error) => error && setNotice(error));
            }
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "editTunnel" && (
        <TunnelEditDialog
          tunnel={modal.tunnel}
          isNew={modal.isNew}
          sessions={sshSessions}
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
          label={modal.label}
          remember={{ initial: false }}
          onCancel={() => {
            setModal(null);
            modal.resolve(null);
          }}
          onSubmit={(password, remember) => {
            setModal(null);
            modal.resolve({ password, remember });
          }}
        />
      )}
    </div>
  );
}
