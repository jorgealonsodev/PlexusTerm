import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { MacroProgress, NameMacroDialog, RecordingIndicator } from "./features/macros/MacroBars";
import { MacroEditDialog } from "./features/macros/MacroEditDialog";
import { MacrosPanel } from "./features/macros/MacrosPanel";
import { hotkeyLabel, recordedSteps, recorderReduce, type Macro, type Step } from "./features/macros/macros";
import { createTargetRegistry, playMacro, type MacroRun, type MacroTarget } from "./features/macros/player";
import { useMacros } from "./features/macros/useMacros";
import { broadcastTargets, createWriterRegistry, multiExecGroup, type PaneInfo } from "./features/panes/multiExec";
import { MoshDialog } from "./features/mosh/MoshDialog";
import { PlatformProvider, usePlatform } from "./features/platform/usePlatform";
import { MultiExecBanner } from "./features/panes/MultiExecBanner";
import { PaneCloseButton } from "./features/panes/PaneCloseButton";
import { DialogProvider, useDialogs } from "./features/dialogs/DialogProvider";
import { EditUploads } from "./features/sftp/EditUploads";
import { writeText } from "./features/terminal/clipboard";
import { PaneGrid } from "./features/panes/PaneGrid";
import { MAX_PANES, paneIds } from "./features/panes/paneLayout";
import { shortcutFor } from "./features/panes/shortcuts";
import { SerialDialog } from "./features/serial/SerialDialog";
import { stepFontSize } from "./features/settings/settings";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { TelnetDialog } from "./features/telnet/TelnetDialog";
import { useSettings } from "./features/settings/useSettings";
import { chainTarget, collectLogins } from "./features/sessions/jumpHosts";
import {
  isMoshSession,
  isSshSession,
  jumpUsers,
  resolveChain,
  toTarget,
  type LibraryAction,
  type LibrarySession,
  type SavedSession,
} from "./features/sessions/library";
import { removedSshSessions, secretToForgetOnEdit } from "./features/sessions/passwordFlow";
import { forgetSecrets } from "./features/sessions/secrets";
import { SessionEditDialog } from "./features/sessions/SessionEditDialog";
import { SessionsPanel } from "./features/sessions/SessionsPanel";
import { SftpPanel } from "./features/sftp/SftpPanel";
import { Sidebar, type SidebarView } from "./features/sidebar/Sidebar";
import type { SessionTarget, SshTarget } from "./features/sessions/types";
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
import wordmarkUrl from "./assets/plexusterm-wordmark.svg";
import wordmarkLightUrl from "./assets/plexusterm-wordmark-light.svg";
import { applyUiTheme } from "./features/settings/uiTheme";
import { useCompactToolbar } from "./features/toolbar/compact";
import { DropdownMenu } from "./features/menu/DropdownMenu";
import { WakeOnLanDialog } from "./features/tools/WakeOnLanDialog";
import { KeyGenDialog } from "./features/tools/keygen/KeyGenDialog";
import { NetworkScannerDialog } from "./features/tools/scan/NetworkScannerDialog";
import { PortScannerDialog } from "./features/tools/scan/PortScannerDialog";
import { RemoteMonitorBar } from "./features/tools/monitor/RemoteMonitorBar";
import {
  ChevronDown,
  Circle,
  Activity,
  Columns2,
  KeySquare,
  Network,
  Power,
  ScanSearch,
  Wrench,
  KeyRound,
  Radio,
  Rows2,
  Settings as SettingsIcon,
  SquareTerminal,
  Usb,
} from "lucide-react";
import { themeById } from "./features/terminal/themes";
import "./App.css";

const LOCAL: SessionTarget = { type: "local" };

type Modal =
  | { kind: "quickConnect" }
  | { kind: "serial" }
  | { kind: "telnet" }
  | { kind: "mosh" }
  | { kind: "editSession"; session: LibrarySession; isNew: boolean }
  | { kind: "editTunnel"; tunnel: Tunnel; isNew: boolean }
  | { kind: "settings" }
  | { kind: "wakeOnLan" }
  | { kind: "keyGen" }
  | { kind: "portScan" }
  | { kind: "networkScan" }
  | { kind: "editMacro"; macro: Macro; isNew: boolean }
  /** A recording just stopped: name it or discard it (S16.2). */
  | { kind: "nameMacro"; steps: Step[] }
  | null;

/** The macro playing now and its progress (S16.3). */
interface RunningMacro {
  name: string;
  step: number;
  total: number;
}

/** What a terminal pane reported about its backend session, plus its multi-execution exclusion. */
interface PaneMeta {
  sessionId: number | null;
  cwd: string | null;
  excluded: boolean;
  /** The pane's output is being logged to a file (S15.5). */
  logging: boolean;
}

const NO_SESSION: PaneMeta = { sessionId: null, cwd: null, excluded: false, logging: false };

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

/** Toolbar menu for the less common session types (S17.3). */
function MoreMenu({ onTelnet, onMosh }: { onTelnet: () => void; onMosh: () => void }) {
  // Mosh has no Windows client (S18.2).
  const offerMosh = usePlatform() !== "windows";
  const items = [{ label: "Telnet…", onSelect: onTelnet }];
  if (offerMosh) items.push({ label: "Mosh…", onSelect: onMosh });
  return (
    <DropdownMenu
      title="More"
      items={items}
      button={
        <>
          <span className="btn__label">More</span>
          <ChevronDown size={14} />
        </>
      }
    />
  );
}

/** Tools menu: network and SSH utilities (S1). */
function ToolsMenu(props: {
  monitorOn: boolean;
  onKeyGen: () => void;
  onPortScan: () => void;
  onNetworkScan: () => void;
  onWakeOnLan: () => void;
  onToggleMonitor: () => void;
}) {
  return (
    <DropdownMenu
      title="Tools"
      items={[
        { label: "SSH key generator…", icon: <KeySquare size={15} />, onSelect: props.onKeyGen },
        { label: "Port scanner…", icon: <ScanSearch size={15} />, onSelect: props.onPortScan },
        { label: "Network scanner…", icon: <Network size={15} />, onSelect: props.onNetworkScan },
        { label: "Wake On LAN…", icon: <Power size={15} />, onSelect: props.onWakeOnLan },
        {
          label: props.monitorOn ? "Hide remote monitor" : "Show remote monitor",
          icon: <Activity size={15} />,
          onSelect: props.onToggleMonitor,
        },
      ]}
      button={
        <>
          <Wrench size={16} />
          <span className="btn__label">Tools</span>
        </>
      }
    />
  );
}

function AppContent() {
  // Start with one local terminal open.
  const [state, dispatch] = useReducer(tabsReducer, initialTabs, (s) =>
    tabsReducer(s, { type: "open", target: LOCAL }),
  );
  const [modal, setModal] = useState<Modal>(null);
  const terminalSettings = useSettings();
  const dialogs = useDialogs();
  // The whole window follows the terminal colour scheme, like an editor theme.
  const scheme = themeById(terminalSettings.settings.theme);
  useLayoutEffect(() => applyUiTheme(scheme), [scheme]);
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
  const macros = useMacros();
  const [macroTargets] = useState(() => createTargetRegistry<MacroTarget>());
  // Refs too: keystrokes can arrive before the next render.
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const recorded = useRef<string[]>([]);
  const [running, setRunning] = useState<RunningMacro | null>(null);
  const runRef = useRef<MacroRun | null>(null);

  const updatePane = useCallback((paneId: string, patch: Partial<PaneMeta>) => {
    setPaneMeta((prev) => {
      const current = prev[paneId] ?? NO_SESSION;
      const next = { ...current, ...patch };
      return next.sessionId === current.sessionId &&
        next.cwd === current.cwd &&
        next.excluded === current.excluded &&
        next.logging === current.logging
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
  const loggingTabs = new Set(
    state.tabs.filter((t) => paneIds(t.layout).some((id) => paneMeta[id]?.logging)).map((t) => t.key),
  );

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

  /** Records what is typed in the focused pane of the active tab while recording (S16.2). */
  const record = (paneId: string, data: string) => {
    if (recordingRef.current && activeTab?.focusedPane === paneId) recorded.current = recorderReduce(recorded.current, data);
  };

  const toggleRecording = () => {
    if (!recordingRef.current) {
      if (macros.status.state !== "ready") return setNotice("Macros cannot be saved: the macros file could not be read.");
      recorded.current = [];
      recordingRef.current = true;
      setRecording(true);
      return;
    }
    recordingRef.current = false;
    setRecording(false);
    const steps = recordedSteps(recorded.current);
    recorded.current = [];
    if (steps.length === 0) setNotice("Nothing was recorded.");
    else setModal({ kind: "nameMacro", steps });
  };

  /** Plays a macro into the focused pane of the active tab, through its normal input path (S16.3). */
  const startMacro = (macro: Macro) => {
    if (runRef.current) return setNotice("A macro is already running.");
    const paneId = activeTab?.focusedPane;
    const target = paneId ? macroTargets.get(paneId) : undefined;
    if (!target) return setNotice("No terminal to play the macro in.");
    setRunning({ name: macro.name, step: 0, total: macro.steps.length });
    let current: MacroRun | null = null;
    const run = playMacro(macro, target, {
      onProgress: (step, total) => {
        // The first step starts before playMacro returns.
        if (current === null || runRef.current === current) setRunning({ name: macro.name, step, total });
      },
    });
    current = run;
    runRef.current = run;
    void run.done.then((result) => {
      if (runRef.current === run) {
        runRef.current = null;
        setRunning(null);
      }
      if (result.status === "failed") target.notice(result.message);
    });
  };

  const stopMacro = () => runRef.current?.stop();

  const playHotkey = (hotkey: number) => {
    const macro = macros.list.macros.find((m) => m.hotkey === hotkey);
    if (macro) startMacro(macro);
    else setNotice(`No macro uses ${hotkeyLabel(hotkey)}.`);
  };

  // Reached from the window key listener without re-subscribing it on every render.
  const macroKeys = useRef({ toggleRecording, playHotkey });
  macroKeys.current = { toggleRecording, playHotkey };

  // Escape stops a running macro; captured before the terminal sees it.
  const isRunning = running !== null;
  useEffect(() => {
    if (!isRunning) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      runRef.current?.stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isRunning]);

  const open = useCallback((target: SessionTarget) => dispatch({ type: "open", target }), []);
  const openLocal = useCallback(() => open(LOCAL), [open]);

  /**
   * The login of a saved SSH session, through its jump hosts (S14). Password hops connect
   * first (the backend tries the SSH agent and default keys, then the saved password); the
   * terminal asks for a password only when the server still needs one. Null when the chain
   * is invalid (a notice says why).
   */
  const sshLoginFor = async (session: SavedSession): Promise<SshTarget | null> => {
    const chain = resolveChain(sessions.library, session);
    if (!chain.ok) {
      setNotice(chain.error);
      return null;
    }
    const hops = [...chain.jumps, session];
    const logins = await collectLogins(hops);
    return logins && chainTarget(hops, logins);
  };

  /** Mosh starts its server with the login of a saved SSH session (S17.2). */
  const openMosh = async (sshSessionId: string, serverCommand: string | undefined, name?: string) => {
    const ssh = sessions.library.sessions.find((s) => s.id === sshSessionId);
    if (!ssh || !isSshSession(ssh)) {
      return setNotice(
        name
          ? `The SSH session of "${name}" no longer exists; edit it to choose another one.`
          : "That SSH session no longer exists.",
      );
    }
    const login = await sshLoginFor(ssh);
    if (login) open({ type: "mosh", ssh: login, ...(serverCommand ? { serverCommand } : {}) });
  };

  const openSaved = async (session: LibrarySession) => {
    if (isMoshSession(session)) return openMosh(session.sshSessionId, session.serverCommand, session.name);
    if (!isSshSession(session)) return open(toTarget(session));
    const login = await sshLoginFor(session);
    if (login) open(login);
  };

  /** Deletes sessions and the passwords saved for them; a keyring failure only shows a notice. */
  const deleteSessions = (action: LibraryAction) => {
    const ids = removedSshSessions(sessions.library, action).map((s) => s.id);
    sessions.dispatch(action);
    void forgetSecrets(ids).then((error) => error && setNotice(error));
  };

  /** Asks before deleting, naming the sessions that use the deleted ones as jump hosts (S14.5). */
  const confirmDelete = async (question: string, action: LibraryAction) => {
    const ids = removedSshSessions(sessions.library, action).map((s) => s.id);
    const users = jumpUsers(sessions.library, ids).map((s) => `"${s.name}"`);
    const note = users.length
      ? `\n\nUsed as a jump host by ${users.join(", ")}; it will be removed from their jump hosts.`
      : "";
    if (await dialogs.confirm({ message: question + note, confirmLabel: "Delete", danger: true })) deleteSessions(action);
  };

  const newFolder = async (parent: string) => {
    const name = await dialogs.prompt({
      message: parent ? `New folder inside "${parent}"` : "New folder",
      confirmLabel: "Create",
    });
    if (name?.trim()) sessions.dispatch({ type: "addFolder", path: parent ? `${parent}/${name}` : name });
  };

  const { updateWith: updateSettingsWith } = terminalSettings;

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
        case "fontSize":
          return updateSettingsWith((s) => ({ fontSize: stepFontSize(s.fontSize, shortcut.step) }));
        case "recordMacro":
          return macroKeys.current.toggleRecording();
        case "playMacro":
          return macroKeys.current.playHotkey(shortcut.hotkey);
        // Handled by the focused terminal itself.
        case "find":
        case "copy":
        case "paste":
          return;
      }
      if (!activeTab) return;
      const key = activeTab.key;
      if (shortcut.type === "closePane") dispatch({ type: "closePane", key, paneId: activeTab.focusedPane });
      else if (shortcut.type === "split") dispatch({ type: "split", key, direction: shortcut.direction });
      else dispatch({ type: "focusDirection", key, direction: shortcut.direction });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal, activeTab, updateSettingsWith]);

  const toolbarRef = useRef<HTMLElement>(null);
  const compactToolbar = useCompactToolbar(toolbarRef);

  const split = (direction: "row" | "column") => {
    if (activeTab) dispatch({ type: "split", key: activeTab.key, direction });
  };

  return (
    <div className="app">
      <header className={`toolbar${compactToolbar ? " toolbar--compact" : ""}`} ref={toolbarRef}>
        <img className="brand" src={scheme.dark ? wordmarkUrl : wordmarkLightUrl} alt="PlexusTerm" />
        <button className="btn btn--icon" title="Terminal (Ctrl+Shift+T)" onClick={openLocal}>
          <SquareTerminal size={16} />
          <span className="btn__label">Terminal</span>
        </button>
        <button className="btn btn--icon" title="SSH (Ctrl+Shift+S)" onClick={() => setModal({ kind: "quickConnect" })}>
          <KeyRound size={16} />
          <span className="btn__label">SSH</span>
        </button>
        <button className="btn btn--icon" title="Serial" onClick={() => setModal({ kind: "serial" })}>
          <Usb size={16} />
          <span className="btn__label">Serial</span>
        </button>
        <MoreMenu
          onTelnet={() => setModal({ kind: "telnet" })}
          onMosh={() => setModal({ kind: "mosh" })}
        />
        <ToolsMenu
          monitorOn={terminalSettings.settings.remoteMonitor}
          onKeyGen={() => setModal({ kind: "keyGen" })}
          onPortScan={() => setModal({ kind: "portScan" })}
          onNetworkScan={() => setModal({ kind: "networkScan" })}
          onWakeOnLan={() => setModal({ kind: "wakeOnLan" })}
          onToggleMonitor={() => terminalSettings.update({ remoteMonitor: !terminalSettings.settings.remoteMonitor })}
        />
        <button className="btn btn--icon" disabled={!canSplit} title="Split right (Ctrl+Shift+D)" onClick={() => split("row")}>
          <Columns2 size={16} />
          <span className="btn__label">Split right</span>
        </button>
        <button className="btn btn--icon" disabled={!canSplit} title="Split down (Ctrl+Shift+E)" onClick={() => split("column")}>
          <Rows2 size={16} />
          <span className="btn__label">Split down</span>
        </button>
        <button
          className={`btn btn--icon${multiExec ? " btn--pressed" : ""}`}
          aria-pressed={multiExec}
          title="Multi-exec (Ctrl+Shift+M)"
          onClick={() => setMultiExec((on) => !on)}
        >
          <Radio size={16} />
          <span className="btn__label">Multi-exec</span>
        </button>
        <button
          className={`btn btn--icon${recording ? " btn--pressed btn--recording" : ""}`}
          aria-pressed={recording}
          title="Record macro (Ctrl+Shift+R)"
          onClick={toggleRecording}
        >
          <Circle size={16} />
          <span className="btn__label">Record macro</span>
        </button>
        <button
          className="btn btn--icon toolbar__settings"
          aria-label="Settings"
          title="Settings"
          onClick={() => setModal({ kind: "settings" })}
        >
          <SettingsIcon size={16} />
        </button>
      </header>
      <EditUploads onNotice={setNotice} />
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {recording && <RecordingIndicator onStop={toggleRecording} />}
      {running && running.total > 0 && (
        <MacroProgress name={running.name} step={running.step} total={running.total} onStop={stopMacro} />
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
                onPathToTerminal={(text) => activePane && writers.write([activePane], text)}
                textEditor={terminalSettings.settings.textEditor}
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
              onDelete={async (tunnel) => {
                if (await dialogs.confirm({ message: `Delete tunnel "${tunnel.name}"?`, confirmLabel: "Delete", danger: true })) {
                  void launcher.stop(tunnel.id);
                  tunnels.dispatch({ type: "delete", id: tunnel.id });
                }
              }}
              onStartAll={() => void launcher.startAll(tunnels.list.tunnels)}
              onStopAll={() => void launcher.stopAll(tunnels.list.tunnels)}
            />
          }
          macros={
            <MacrosPanel
              list={macros.list}
              status={macros.status}
              saveError={macros.saveError}
              canPlay={activeTab !== null && running === null}
              onPlay={startMacro}
              onNew={() =>
                setModal({ kind: "editMacro", macro: { id: crypto.randomUUID(), name: "", steps: [] }, isNew: true })
              }
              onEdit={(macro) => setModal({ kind: "editMacro", macro, isNew: false })}
              onDuplicate={(macro) => macros.dispatch({ type: "duplicate", id: macro.id, newId: crypto.randomUUID() })}
              onDelete={async (macro) => {
                if (await dialogs.confirm({ message: `Delete macro "${macro.name}"?`, confirmLabel: "Delete", danger: true })) {
                  macros.dispatch({ type: "delete", id: macro.id });
                }
              }}
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
                void confirmDelete(`Delete session "${session.name}"?`, { type: "deleteSession", id: session.id })
              }
              onNewFolder={(parent) => void newFolder(parent)}
              onImport={(imported) => sessions.dispatch({ type: "saveSessions", sessions: imported })}
              onDuplicate={(session) =>
                sessions.dispatch({ type: "duplicateSession", id: session.id, newId: crypto.randomUUID() })
              }
              onDeleteFolder={(path) =>
                void confirmDelete(`Delete folder "${path}" and every session inside it?`, { type: "deleteFolder", path })
              }
            />
          }
        />
        <section className="main">
          <TabBar
            tabs={state.tabs}
            activeKey={state.activeKey}
            logging={loggingTabs}
            onActivate={(key) => dispatch({ type: "activate", key })}
            onClose={(key) => dispatch({ type: "close", key })}
            onNew={openLocal}
            onDuplicate={(key) => {
              const tab = state.tabs.find((t) => t.key === key);
              if (tab) dispatch({ type: "open", target: tab.target });
            }}
            onCloseOthers={(key) => dispatch({ type: "closeOthers", key })}
            onCloseRight={(key) => dispatch({ type: "closeRight", key })}
            onCloseAll={() => dispatch({ type: "closeAll" })}
            onCopyHost={(host) =>
              void writeText(host).catch(() => setNotice("Could not copy to the clipboard."))
            }
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
                        <div className="pane-stack">
                          <div className="pane-stack__terminal">
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
                            onInput={(data) => {
                              broadcast(paneId, data);
                              record(paneId, data);
                            }}
                            registerWriter={(write) => writers.register(paneId, write)}
                            registerMacroTarget={(target) => macroTargets.register(paneId, target)}
                            settings={terminalSettings.settings}
                            onSettingsChange={terminalSettings.update}
                            onLogging={(path) => updatePane(paneId, { logging: path !== null })}
                          />
                          {paneIds(tab.layout).length > 1 && (
                            <PaneCloseButton onClose={() => dispatch({ type: "closePane", key: tab.key, paneId })} />
                          )}
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
                          </div>
                          {tab.target.type === "ssh" && terminalSettings.settings.remoteMonitor && (
                            <RemoteMonitorBar sessionId={paneMeta[paneId]?.sessionId ?? null} active={active} />
                          )}
                        </div>
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
      {modal?.kind === "telnet" && (
        <TelnetDialog
          onCancel={() => setModal(null)}
          onConnect={(target) => {
            setModal(null);
            open(target);
          }}
        />
      )}
      {modal?.kind === "mosh" && (
        <MoshDialog
          sessions={sshSessions}
          onCancel={() => setModal(null)}
          onConnect={(sshSessionId, serverCommand) => {
            setModal(null);
            void openMosh(sshSessionId, serverCommand);
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
      {modal?.kind === "wakeOnLan" && <WakeOnLanDialog onClose={() => setModal(null)} />}
      {modal?.kind === "keyGen" && (
        <KeyGenDialog sessions={sessions.library.sessions.filter(isSshSession)} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "portScan" && <PortScannerDialog onClose={() => setModal(null)} />}
      {modal?.kind === "networkScan" && (
        <NetworkScannerDialog
          onClose={() => setModal(null)}
          onNewSshSession={(host) =>
            setModal({ kind: "editSession", session: { ...draftSession(""), name: host, host }, isNew: true })
          }
        />
      )}
      {modal?.kind === "settings" && (
        <SettingsDialog
          settings={terminalSettings.settings}
          onCancel={() => setModal(null)}
          onSave={(next) => {
            terminalSettings.update(next);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "editMacro" && (
        <MacroEditDialog
          macro={modal.macro}
          isNew={modal.isNew}
          macros={macros.list.macros}
          onCancel={() => setModal(null)}
          onSave={(macro) => {
            macros.dispatch({ type: "save", macro });
            setModal(null);
          }}
        />
      )}
      {modal?.kind === "nameMacro" && (
        <NameMacroDialog
          stepCount={modal.steps.length}
          onDiscard={() => setModal(null)}
          onSave={(name) => {
            macros.dispatch({ type: "save", macro: { id: crypto.randomUUID(), name, steps: modal.steps } });
            setModal(null);
          }}
        />
      )}
      {launcher.dialog}
    </div>
  );
}

/**
 * The app, with the platform (asked from the backend once) and the in-app confirmations and
 * prompts available to every component.
 */
export default function App() {
  return (
    <PlatformProvider>
      <DialogProvider>
        <AppContent />
      </DialogProvider>
    </PlatformProvider>
  );
}
