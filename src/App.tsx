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
import { ShellsProvider, useShells } from "./features/platform/useShells";
import { localTargetOf, runningShellOf } from "./features/terminal/localShell";
import { UpdateNotice } from "./features/updates/UpdateNotice";
import { checkForUpdate, type Release } from "./features/updates/updates";
import { MultiExecBanner } from "./features/panes/MultiExecBanner";
import { resolveLocale, setLocale, systemLanguages, useT } from "./i18n/i18n";
import { forgetChatsExcept } from "./features/ai/chatMemory";
import { PaneCloseButton } from "./features/panes/PaneCloseButton";
import { DialogProvider, useDialogs } from "./features/dialogs/DialogProvider";
import { EditUploads } from "./features/sftp/EditUploads";
import { writeText } from "./features/terminal/clipboard";
import { PaneGrid } from "./features/panes/PaneGrid";
import { MAX_PANES, paneIds } from "./features/panes/paneLayout";
import { shortcutFor } from "./features/panes/shortcuts";
import { SerialDialog } from "./features/serial/SerialDialog";
import { LocalPanel } from "./features/local/LocalPanel";
import { useShellCwd } from "./features/local/useShellCwd";
import { quotePath, shellFlavor } from "./features/terminal/shellPath";
import { dropAction, sameMachine } from "./features/drop/dropAction";
import { dropTargetAt, setDropHandler, type PathDrag } from "./features/drop/pathDrag";
import { local } from "./features/local/localClient";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { stepFontSize } from "./features/settings/settings";
import { SettingsDialog, type SettingsSection } from "./features/settings/SettingsDialog";
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
import { chatAction, initialTabs, tabsReducer, type ChatLink, type Tab } from "./features/tabs/tabs";
import { TerminalView, type AiSuggestContext, type AssistTarget } from "./features/terminal/TerminalView";
import { ChatPane } from "./features/ai/ChatPane";
import { aiComplete, describeAiError } from "./features/ai/aiClient";
import { aiConfigOf, aiHint, newAiSessionId, truncateSelection } from "./features/ai/aiContext";
import { createAiLimiter } from "./features/ai/aiLimiter";
import { matchesShortcut } from "./features/settings/shortcutCapture";
import { hostKeyOf } from "./features/history/history";
import { commandHistory } from "./features/history/historyStore";
import { TunnelEditDialog } from "./features/tunnels/TunnelEditDialog";
import { TunnelsPanel } from "./features/tunnels/TunnelsPanel";
import type { Tunnel } from "./features/tunnels/tunnels";
import { useTunnelLauncher } from "./features/tunnels/useTunnelLauncher";
import { useTunnels } from "./features/tunnels/useTunnels";
import markUrl from "./assets/plexusterm-mark.svg";
import markLightUrl from "./assets/plexusterm-mark-light.svg";
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
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Rows2,
  Settings as SettingsIcon,
  SquareTerminal,
  Usb,
} from "lucide-react";
import { themeById } from "./features/terminal/themes";
import "./App.css";


type Modal =
  | { kind: "quickConnect" }
  | { kind: "serial" }
  | { kind: "telnet" }
  | { kind: "mosh" }
  | { kind: "editSession"; session: LibrarySession; isNew: boolean }
  | { kind: "editTunnel"; tunnel: Tunnel; isNew: boolean }
  | { kind: "settings"; section?: SettingsSection }
  | { kind: "wakeOnLan" }
  | { kind: "keyGen" }
  | { kind: "portScan" }
  | { kind: "networkScan" }
  | { kind: "editMacro"; macro: Macro; isNew: boolean }
  /** A recording just stopped: name it or discard it (S16.2). */
  | { kind: "nameMacro"; steps: Step[] }
  | null;

/** Short status of a pane's last failed AI suggestion (S2), with the full message as tooltip. */
interface AiHint {
  text: string;
  detail: string;
}

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const t = useT();
  const offerMosh = usePlatform() !== "windows";
  const items = [{ label: "Telnet…", onSelect: onTelnet }];
  if (offerMosh) items.push({ label: "Mosh…", onSelect: onMosh });
  return (
    <DropdownMenu
      title={t("app.toolbar.more")}
      items={items}
      button={
        <>
          <span className="btn__label">{t("app.toolbar.more")}</span>
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
  const t = useT();
  return (
    <DropdownMenu
      title={t("app.toolbar.tools")}
      items={[
        { label: t("app.tools.keyGenerator"), icon: <KeySquare size={15} />, onSelect: props.onKeyGen },
        { label: t("app.tools.portScanner"), icon: <ScanSearch size={15} />, onSelect: props.onPortScan },
        { label: t("app.tools.networkScanner"), icon: <Network size={15} />, onSelect: props.onNetworkScan },
        { label: t("app.tools.wakeOnLan"), icon: <Power size={15} />, onSelect: props.onWakeOnLan },
        {
          label: props.monitorOn ? t("app.tools.hideMonitor") : t("app.tools.showMonitor"),
          icon: <Activity size={15} />,
          onSelect: props.onToggleMonitor,
        },
      ]}
      button={
        <>
          <Wrench size={16} />
          <span className="btn__label">{t("app.toolbar.tools")}</span>
        </>
      }
    />
  );
}

function AppContent() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabs);
  const [modal, setModal] = useState<Modal>(null);
  const terminalSettings = useSettings();
  // Start with one local terminal open, once the settings say which shell it runs.
  const started = useRef(false);
  useEffect(() => {
    if (!terminalSettings.loaded || started.current) return;
    started.current = true;
    dispatch({ type: "open", target: localTargetOf(terminalSettings.settings) });
  }, [terminalSettings.loaded, terminalSettings.settings]);
  const shells = useShells();
  // Once per launch, when Settings allow it: a newer release only shows a notice.
  const [update, setUpdate] = useState<Release | null>(null);
  const updateChecked = useRef(false);
  useEffect(() => {
    if (!terminalSettings.loaded || updateChecked.current) return;
    updateChecked.current = true;
    if (!terminalSettings.settings.checkUpdates) return;
    checkForUpdate()
      .then(({ latest }) => setUpdate(latest))
      .catch(() => {});
  }, [terminalSettings.loaded, terminalSettings.settings.checkUpdates]);
  const dialogs = useDialogs();
  // The whole window follows the terminal colour scheme, like an editor theme.
  const scheme = themeById(terminalSettings.settings.theme);
  useLayoutEffect(() => applyUiTheme(scheme), [scheme]);
  // The interface language (S3): the chosen one, or the system's, English when unsupported.
  const language = terminalSettings.settings.language;
  useLayoutEffect(() => setLocale(resolveLocale(language, systemLanguages())), [language]);
  const t = useT();
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
  const [followLocalCwd, setFollowLocalCwd] = useState(true);
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
  const [assistTargets] = useState(() => createTargetRegistry<AssistTarget>());
  const [chatDrops] = useState(() => createTargetRegistry<(drag: PathDrag) => void>());
  const [aiLimit] = useState(() => createAiLimiter());
  const [aiHints, setAiHints] = useState<Record<string, AiHint>>({});
  /** Bumped on every assistant open: a new key restarts the X's spin (S5); 0 = not spinning. */
  const [spin, setSpin] = useState(0);
  const platform = usePlatform();

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
    setAiHints((prev) => {
      const ids = Object.keys(prev).filter((id) => open.has(id));
      return ids.length === Object.keys(prev).length ? prev : Object.fromEntries(ids.map((id) => [id, prev[id]]));
    });
    forgetChatsExcept(open);
  }, [state.tabs]);
  // The conversations belong to this window's terminals.
  useEffect(() => () => forgetChatsExcept(new Set()), []);

  const activeTab = state.tabs.find((t) => t.key === state.activeKey) ?? null;
  // SFTP and the followed folder belong to the focused pane of the active tab (S11.5); an AI
  // chat pane stands for its terminal (S9).
  const activePane = activeTab ? (activeTab.chats[activeTab.focusedPane]?.terminalPaneId ?? activeTab.focusedPane) : null;
  const activeSession = (activePane && paneMeta[activePane]) || NO_SESSION;
  const sftpSessionId = activeTab?.target.type === "ssh" ? activeSession.sessionId : null;
  // The Explorer tab belongs to a local terminal; its pty id lets the backend read the shell's folder.
  const localPtyId = activeTab?.target.type === "local" ? activeSession.sessionId : null;
  const localShown = localPtyId !== null && sidebarView === "explorer" && !terminalSettings.settings.sidebarCollapsed;
  const localCwd = useShellCwd(localPtyId, activeSession.cwd, localShown && followLocalCwd);
  const canSplit = activeTab !== null && paneIds(activeTab.layout).length < MAX_PANES;
  const loggingTabs = new Set(
    state.tabs.filter((t) => paneIds(t.layout).some((id) => paneMeta[id]?.logging)).map((t) => t.key),
  );

  // Terminal panes only: AI chat panes never take part in multi-execution (S9).
  const allPanes: PaneInfo[] = state.tabs.flatMap((t) =>
    paneIds(t.layout).filter((id) => !t.chats[id]).map((id) => ({
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
      if (macros.status.state !== "ready") return setNotice(t("app.notice.macrosUnreadable"));
      recorded.current = [];
      recordingRef.current = true;
      setRecording(true);
      return;
    }
    recordingRef.current = false;
    setRecording(false);
    const steps = recordedSteps(recorded.current);
    recorded.current = [];
    if (steps.length === 0) setNotice(t("app.notice.nothingRecorded"));
    else setModal({ kind: "nameMacro", steps });
  };

  /** Plays a macro into the focused pane of the active tab, through its normal input path (S16.3). */
  const startMacro = (macro: Macro) => {
    if (runRef.current) return setNotice(t("app.notice.macroRunning"));
    const paneId = activeTab?.focusedPane;
    const target = paneId ? macroTargets.get(paneId) : undefined;
    if (!target) return setNotice(t("app.notice.noMacroTarget"));
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
    else setNotice(t("app.notice.noMacroForHotkey", { hotkey: hotkeyLabel(hotkey) }));
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
  const { localShell, localShellArgs } = terminalSettings.settings;
  const openLocal = useCallback(
    () => open(localTargetOf({ localShell, localShellArgs })),
    [open, localShell, localShellArgs],
  );

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
          ? t("app.notice.moshSessionGone", { name })
          : t("app.notice.sshSessionGone"),
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
      ? `\n\n${t("app.confirm.jumpHostNote", { users: users.join(", ") })}`
      : "";
    if (await dialogs.confirm({ message: question + note, confirmLabel: t("common.delete"), danger: true })) deleteSessions(action);
  };

  const newFolder = async (parent: string) => {
    const name = await dialogs.prompt({
      message: parent ? t("app.confirm.newFolderInside", { parent }) : t("app.confirm.newFolder"),
      confirmLabel: t("app.confirm.create"),
    });
    if (name?.trim()) sessions.dispatch({ type: "addFolder", path: parent ? `${parent}/${name}` : name });
  };

  const { updateWith: updateSettingsWith } = terminalSettings;
  const settings = terminalSettings.settings;

  /** One AI conversation ID per pane for its inline suggestions, kept while the app runs (S6). */
  const aiSessions = useRef(new Map<string, string>());
  const aiSessionOf = (paneId: string) => {
    let id = aiSessions.current.get(paneId);
    if (!id) {
      id = newAiSessionId();
      aiSessions.current.set(paneId, id);
    }
    return id;
  };

  /** Completes the typed line of `paneId` with the AI provider (S2); errors only leave a hint. */
  const aiSuggestFor = (paneId: string, target: SessionTarget) => async (context: AiSuggestContext) => {
    const config = aiConfigOf(settings, aiSessionOf(paneId));
    const shell = runningShellOf(target, shells);
    const request = {
      line: context.line,
      os: platform,
      ...(shell ? { shell } : {}),
      cwd: context.cwd,
      history: context.history,
    };
    try {
      const completion = await aiLimit(paneId, () => aiComplete(config, request));
      setAiHints((prev) => {
        if (!(paneId in prev)) return prev;
        const { [paneId]: _cleared, ...rest } = prev;
        return rest;
      });
      return completion ? context.line + completion : null;
    } catch (err) {
      setAiHints((prev) => ({ ...prev, [paneId]: { text: aiHint(err), detail: describeAiError(err) } }));
      return null;
    }
  };

  /**
   * The assistant shortcut and the X (S5, S9): opens an AI chat pane below the focused terminal
   * of the active tab (or focuses the one it has), spinning the X; from a chat pane it goes
   * back to the chat's terminal.
   */
  const openAssistant = () => {
    if (!activeTab) return setNotice(t("app.notice.noTerminalForAi"));
    const next = chatAction(activeTab);
    if (next.kind === "full") {
      return setNotice(t("app.notice.tabFull", { max: MAX_PANES }));
    }
    if (next.kind === "terminal") {
      dispatch({ type: "focusPane", key: activeTab.key, paneId: next.paneId });
      assistTargets.get(next.paneId)?.focus();
      return;
    }
    const selection =
      next.kind === "open" ? truncateSelection(assistTargets.get(next.terminalPaneId)?.selection() ?? "") : "";
    void commandHistory.ready();
    dispatch({ type: "openChat", key: activeTab.key, selection });
    if (!prefersReducedMotion()) setSpin((n) => n + 1);
  };

  /**
   * The X (S5, S9): opens the focused terminal's AI chat like the shortcut, and when that chat is
   * already open (the chat or its terminal has the focus) closes it; both spin the X.
   */
  const toggleAssistantFromLogo = () => {
    const tab = activeTab;
    const focused = tab?.focusedPane;
    const chatId =
      tab && focused
        ? tab.chats[focused]
          ? focused
          : Object.keys(tab.chats).find((id) => tab.chats[id].terminalPaneId === focused)
        : undefined;
    if (!tab || !chatId) return openAssistant();
    const terminalPaneId = tab.chats[chatId].terminalPaneId;
    dispatch({ type: "closePane", key: tab.key, paneId: chatId });
    assistTargets.get(terminalPaneId)?.focus();
    if (!prefersReducedMotion()) setSpin((n) => n + 1);
  };

  /** What a chat pane knows about its terminal: OS, folder and the host's recent commands, never its output. */
  const chatContextOf = (tab: Tab, terminalPaneId: string) => {
    const hostKey = hostKeyOf(tab.target);
    const { commandHistory: historyOn, aiHistoryContext } = settings;
    return {
      os: platform,
      shell: runningShellOf(tab.target, shells),
      cwd: paneMeta[terminalPaneId]?.cwd ?? null,
      history: () => (historyOn ? commandHistory.recent(hostKey, aiHistoryContext) : []),
    };
  };

  /**
   * Files or folders dropped on a terminal pane (S4): a folder on an empty command line of its own
   * machine runs `cd`; anything else types the quoted paths at the cursor.
   */
  const dropOnPane = (paneId: string, drag: PathDrag) => {
    const tab = state.tabs.find((t) => paneIds(t.layout).includes(paneId) && !t.chats[paneId]);
    const pane = assistTargets.get(paneId);
    if (!tab || !pane) return;
    const { target } = tab;
    const action = dropAction(drag.paths, {
      lineEmpty: pane.lineEmpty?.() ?? false,
      sameMachine: sameMachine(drag.origin, target.type, paneMeta[paneId]?.sessionId ?? null),
      flavor: shellFlavor(platform, target.type, runningShellOf(target, shells)),
    });
    if (action.kind === "unsafe") setNotice(t("sftp.error.unsafePath"));
    else if (action.kind === "run") pane.run(action.command);
    else pane.insert(action.text);
    dispatch({ type: "focusPane", key: tab.key, paneId });
    pane.focus();
  };
  const dropRef = useRef<(drag: PathDrag, target: Element | null) => void>(() => {});
  dropRef.current = (drag, target) => {
    const paneId = target?.getAttribute("data-drop-pane");
    if (paneId) return dropOnPane(paneId, drag);
    // Files dropped on an AI chat are attached to its next question (S6).
    const chatId = target?.getAttribute("data-drop-chat");
    if (chatId) chatDrops.get(chatId)?.(drag);
  };
  useEffect(() => setDropHandler((drag, target) => dropRef.current(drag, target)), []);

  // Files dropped from the desktop: on a terminal pane they are handled like the Explorer's rows.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let over: Element | null = null;
    const highlight = (next: Element | null) => {
      if (next === over) return;
      over?.classList.remove("drop-target--over");
      next?.classList.add("drop-target--over");
      over = next;
    };
    const at = ({ x, y }: { x: number; y: number }) => dropTargetAt(x / window.devicePixelRatio, y / window.devicePixelRatio);
    try {
      getCurrentWebview()
        .onDragDropEvent(({ payload }) => {
          if (payload.type === "enter" || payload.type === "over") return highlight(at(payload.position));
          highlight(null);
          if (payload.type !== "drop") return;
          const target = at(payload.position);
          if (!target) return;
          void Promise.all(
            payload.paths.map((path) =>
              local
                .stat(path)
                .then((entry) => ({ path, isDir: entry.kind === "dir" }))
                .catch(() => ({ path, isDir: false })),
            ),
          ).then((paths) => dropRef.current({ origin: { kind: "local" }, paths }, target));
        })
        .then((stop) => (disposed ? stop() : (unlisten = stop)))
        .catch(() => {});
    } catch {
      // Not running inside Tauri (e.g. tests): no desktop drops.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /** Types an AI command into the chat's terminal, without Enter, and focuses it. */
  const insertFromChat = (tab: Tab, link: ChatLink, command: string) => {
    // Typed like the user's own keys (so Enter records it in the history), only into this terminal.
    assistTargets.get(link.terminalPaneId)?.insert(command);
    dispatch({ type: "focusPane", key: tab.key, paneId: link.terminalPaneId });
    assistTargets.get(link.terminalPaneId)?.focus();
  };

  /** Runs an AI command in the chat's terminal (Run): sent with Enter, then the terminal gets the focus. */
  const runFromChat = (tab: Tab, link: ChatLink, command: string) => {
    if (!assistTargets.get(link.terminalPaneId)?.run(command)) {
      setNotice(t("app.notice.commandNotRun"));
      return;
    }
    dispatch({ type: "focusPane", key: tab.key, paneId: link.terminalPaneId });
    assistTargets.get(link.terminalPaneId)?.focus();
  };

  // Another dialog keeps its place: the shortcut does not replace it.
  const assistantKeys = useRef({ openAssistant, shortcut: settings.assistantShortcut, blocked: modal !== null });
  assistantKeys.current = { openAssistant, shortcut: settings.assistantShortcut, blocked: modal !== null };

  // Terminals let these keys through unhandled (see TerminalView), so the window sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, assistantKeys.current.shortcut)) {
        e.preventDefault();
        if (!assistantKeys.current.blocked) assistantKeys.current.openAssistant();
        return;
      }
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
        case "toggleSidebar":
          return updateSettingsWith((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
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
        <button
          type="button"
          className="brand-button"
          aria-label={t("app.toolbar.aiAssistant")}
          title={t("app.toolbar.aiAssistantTitle", { shortcut: settings.assistantShortcut })}
          onClick={toggleAssistantFromLogo}
        >
          <img
            key={spin}
            className={`brand${spin ? " brand--spin" : ""}`}
            src={scheme.dark ? markUrl : markLightUrl}
            alt="PlexusTerm"
            onAnimationEnd={() => setSpin(0)}
          />
        </button>
        <button
          type="button"
          className="btn btn--icon toolbar__sidebar"
          aria-label={settings.sidebarCollapsed ? t("app.toolbar.showSidebar") : t("app.toolbar.hideSidebar")}
          title={t(settings.sidebarCollapsed ? "app.toolbar.showSidebarTitle" : "app.toolbar.hideSidebarTitle", {
            shortcut: "Ctrl+Shift+B",
          })}
          onClick={() => updateSettingsWith((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))}
        >
          {settings.sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button className="btn btn--icon" title={t("app.toolbar.terminalTitle", { shortcut: "Ctrl+Shift+T" })} onClick={openLocal}>
          <SquareTerminal size={16} />
          <span className="btn__label">{t("app.toolbar.terminal")}</span>
        </button>
        <button className="btn btn--icon" title="SSH (Ctrl+Shift+S)" onClick={() => setModal({ kind: "quickConnect" })}>
          <KeyRound size={16} />
          <span className="btn__label">SSH</span>
        </button>
        <button className="btn btn--icon" title={t("app.toolbar.serial")} onClick={() => setModal({ kind: "serial" })}>
          <Usb size={16} />
          <span className="btn__label">{t("app.toolbar.serial")}</span>
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
        <button className="btn btn--icon" disabled={!canSplit} title={t("app.toolbar.splitRightTitle", { shortcut: "Ctrl+Shift+D" })} onClick={() => split("row")}>
          <Columns2 size={16} />
          <span className="btn__label">{t("app.toolbar.splitRight")}</span>
        </button>
        <button className="btn btn--icon" disabled={!canSplit} title={t("app.toolbar.splitDownTitle", { shortcut: "Ctrl+Shift+E" })} onClick={() => split("column")}>
          <Rows2 size={16} />
          <span className="btn__label">{t("app.toolbar.splitDown")}</span>
        </button>
        <button
          className={`btn btn--icon${multiExec ? " btn--pressed" : ""}`}
          aria-pressed={multiExec}
          title={t("app.toolbar.multiExecTitle", { shortcut: "Ctrl+Shift+M" })}
          onClick={() => setMultiExec((on) => !on)}
        >
          <Radio size={16} />
          <span className="btn__label">{t("app.toolbar.multiExec")}</span>
        </button>
        <button
          className={`btn btn--icon${recording ? " btn--pressed btn--recording" : ""}`}
          aria-pressed={recording}
          title={t("app.toolbar.recordMacroTitle", { shortcut: "Ctrl+Shift+R" })}
          onClick={toggleRecording}
        >
          <Circle size={16} />
          <span className="btn__label">{t("app.toolbar.recordMacro")}</span>
        </button>
        <button
          className="btn btn--icon toolbar__settings"
          aria-label={t("app.toolbar.settings")}
          title={t("app.toolbar.settings")}
          onClick={() => setModal({ kind: "settings" })}
        >
          <SettingsIcon size={16} />
        </button>
      </header>
      <EditUploads onNotice={setNotice} />
      {update && <UpdateNotice release={update} onClose={() => setUpdate(null)} />}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)}>
            {t("app.notice.dismiss")}
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
        {!(settings.sidebarCollapsed && settings.sidebarHideWhenCollapsed) && (
          <Sidebar
            view={sidebarView}
            onViewChange={setSidebarView}
            collapsed={settings.sidebarCollapsed}
            onExpand={() => terminalSettings.update({ sidebarCollapsed: false })}
            width={settings.sidebarWidth}
            onWidthChange={(sidebarWidth) => terminalSettings.update({ sidebarWidth })}
            sftpAvailable={sftpSessionId !== null}
            localAvailable={localPtyId !== null}
            local={
              activeTab &&
              localPtyId !== null && (
                <LocalPanel
                  key={`${activePane}:${localPtyId}`}
                  cwd={localCwd}
                  follow={followLocalCwd}
                  onFollowChange={setFollowLocalCwd}
                  onPathToTerminal={(path) => {
                    const flavor = shellFlavor(platform, activeTab.target.type, runningShellOf(activeTab.target, shells));
                    const text = quotePath(path, flavor);
                    if (activePane && text !== null) writers.write([activePane], text);
                  }}
                  textEditor={terminalSettings.settings.textEditor}
                />
              )
            }
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
                  if (await dialogs.confirm({ message: t("app.confirm.deleteTunnel", { name: tunnel.name }), confirmLabel: t("common.delete"), danger: true })) {
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
                  if (await dialogs.confirm({ message: t("app.confirm.deleteMacro", { name: macro.name }), confirmLabel: t("common.delete"), danger: true })) {
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
                  void confirmDelete(t("app.confirm.deleteSession", { name: session.name }), { type: "deleteSession", id: session.id })
                }
                onNewFolder={(parent) => void newFolder(parent)}
                onImport={(imported) => sessions.dispatch({ type: "saveSessions", sessions: imported })}
                onDuplicate={(session) =>
                  sessions.dispatch({ type: "duplicateSession", id: session.id, newId: crypto.randomUUID() })
                }
                onDeleteFolder={(path) =>
                  void confirmDelete(t("app.confirm.deleteFolder", { path }), { type: "deleteFolder", path })
                }
              />
            }
          />
        )}
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
              void writeText(host).catch(() => setNotice(t("app.notice.copyFailed")))
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
                      const link = tab.chats[paneId];
                      if (link) {
                        return (
                          <div className="pane-stack">
                            <div className="pane-stack__terminal" data-drop-chat={paneId}>
                              <ChatPane
                                conversationKey={link.terminalPaneId}
                                settings={settings}
                                context={chatContextOf(tab, link.terminalPaneId)}
                                selection={link.selection}
                                focused={active && paneId === tab.focusedPane}
                                onInsert={(command) => insertFromChat(tab, link, command)}
                                onRun={(command) => runFromChat(tab, link, command)}
                                onSelectModel={(aiProvider, aiModel) => terminalSettings.update({ aiProvider, aiModel })}
                                onOpenSettings={() => setModal({ kind: "settings", section: "ai" })}
                                onClose={() => dispatch({ type: "closePane", key: tab.key, paneId })}
                                registerDropTarget={(attach) => chatDrops.register(paneId, attach)}
                              />
                            </div>
                          </div>
                        );
                      }
                      const excluded = paneMeta[paneId]?.excluded ?? false;
                      return (
                        <div className="pane-stack">
                          <div className="pane-stack__terminal" data-drop-pane={paneId}>
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
                            registerAssistTarget={(target) => assistTargets.register(paneId, target)}
                            aiSuggest={settings.aiSuggestions ? aiSuggestFor(paneId, tab.target) : undefined}
                            settings={terminalSettings.settings}
                            onSettingsChange={terminalSettings.update}
                            onLogging={(path) => updatePane(paneId, { logging: path !== null })}
                          />
                          {aiHints[paneId] && (
                            <div className="pane__ai-hint" title={aiHints[paneId].detail}>
                              {aiHints[paneId].text}
                            </div>
                          )}
                          {paneIds(tab.layout).length > 1 && (
                            <PaneCloseButton onClose={() => dispatch({ type: "closePane", key: tab.key, paneId })} />
                          )}
                          {multiExec && (
                            <button
                              className={`pane__exclude${excluded ? " pane__exclude--on" : ""}`}
                              aria-pressed={excluded}
                              aria-label={t("app.pane.excludeFromMultiExec")}
                              title={excluded ? t("app.pane.excludedFromMultiExec") : t("app.pane.excludeFromMultiExec")}
                              // Keep the keyboard focus where it is.
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onClick={() => updatePane(paneId, { excluded: !excluded })}
                            >
                              {excluded ? t("app.pane.excluded") : t("app.pane.exclude")}
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
            {state.tabs.length === 0 && terminalSettings.loaded && (
              <div className="empty">
                <p>{t("app.empty.noSessions")}</p>
                <div className="empty__actions">
                  <button className="btn" onClick={openLocal}>
                    {t("app.empty.startLocal")}
                  </button>
                  <button className="btn" onClick={() => setModal({ kind: "quickConnect" })}>
                    {t("app.empty.newSsh")}
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
          initialSection={modal.section}
          onCancel={() => setModal(null)}
          onSave={(next) => {
            terminalSettings.update(next);
            setModal(null);
          }}
          onLanguageNow={(language) => terminalSettings.update({ language })}
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
      <ShellsProvider>
        <DialogProvider>
          <AppContent />
        </DialogProvider>
      </ShellsProvider>
    </PlatformProvider>
  );
}
