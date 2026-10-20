import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ColorMenu } from "./features/toolbar/ColorMenu";
import { loadToolbarColor, saveToolbarColor } from "./features/toolbar/toolbarColor";
import { readableOn } from "./features/settings/uiTheme";
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
import type { AppKey } from "./i18n/catalogs";
import { forgetChatsExcept } from "./features/ai/chatMemory";
import { PaneCloseButton } from "./features/panes/PaneCloseButton";
import { DialogProvider, useDialogs } from "./features/dialogs/DialogProvider";
import { EditUploads } from "./features/sftp/EditUploads";
import { writeText } from "./features/terminal/clipboard";
import { PaneGrid } from "./features/panes/PaneGrid";
import { MAX_PANES, neighbour, paneIds } from "./features/panes/paneLayout";
import { shortcutFor, shortcutLabel, type ShortcutActionId } from "./features/panes/shortcuts";
import { SerialDialog } from "./features/serial/SerialDialog";
import { LocalPanel } from "./features/local/LocalPanel";
import { useShellCwd } from "./features/local/useShellCwd";
import { sftp } from "./features/sftp/sftpClient";
import { quotePath, shellFlavor } from "./features/terminal/shellPath";
import { dropAction, sameMachine } from "./features/drop/dropAction";
import { dropTargetAt, setDropHandler, type PathDrag, type PathOrigin } from "./features/drop/pathDrag";
import { local } from "./features/local/localClient";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { BASE_TEXT_SIZE, stepChatFontSize, stepFontSize } from "./features/settings/settings";
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
import { chatAction, initialTabs, isTerminalPane, tabTitle, tabsReducer, terminalPaneOf, type ChatLink, type Tab, type TabsAction, type ViewerLink } from "./features/tabs/tabs";
import { FileViewer } from "./features/viewer/FileViewer";
import type { AttentionNotice } from "./features/terminal/attention";
import { branchSourceOf, GitBranchReporter } from "./features/terminal/gitBranch";
import { createNotifier } from "./features/notifications/notifier";
import { showSystemNotification } from "./features/notifications/systemNotification";
import { TerminalView, type AiSuggestContext, type AssistTarget } from "./features/terminal/TerminalView";
import { ChatPane, type ChatTarget } from "./features/ai/ChatPane";
import { setChatSaving } from "./features/ai/chatHistory";
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
  Code,
  Activity,
  Columns2,
  KeySquare,
  Network,
  Power,
  ScanSearch,
  Wrench,
  GitBranch,
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
import { useDevMode, type LocateProject } from "./features/devmode/useDevMode";
import { basename } from "./features/local/localPath";
import { parseWorkspaceFile } from "./features/files/workspaceFile";
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
  /** A program in the pane asked for attention while the user was not looking at it. */
  attention: boolean;
  /** Times the shell's prompt came back (OSC 7, OSC 133 or a command's output going quiet). */
  prompts: number;
  /** Git branch of the pane's folder, or null outside a repository. */
  branch: string | null;
  /** The pane is printing on its own (an AI CLI working). */
  busy: boolean;
}

/** "Open in terminal" over SSH: the shell is ready once its login output is quiet this long... */
const SHELL_QUIET_MS = 400;
/** ...or when it printed nothing this long after the session started. */
const SHELL_FIRST_OUTPUT_MS = 1500;

/** Terminals that can run AI command-line tools, so their bar has the DEV button (S10). */
/** The folders a VS Code workspace file lists; none when it cannot be read. */
const workspaceFoldersOf = (file: string) =>
  local
    .readText(file)
    .then((text) => parseWorkspaceFile(text, file))
    .catch(() => [] as string[]);

const DEV_TARGETS: ReadonlySet<string> = new Set(["local", "ssh", "mosh"]);

const NO_SESSION: PaneMeta = { sessionId: null, cwd: null, excluded: false, logging: false, attention: false, prompts: 0, branch: null, busy: false };

/** The terminal pane a tab's focus stands for: an AI chat pane stands for its terminal (S9). */

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
  const openWorkspaceRef = useRef<(folders: string[]) => void>(() => {});
  useEffect(() => {
    if (!terminalSettings.loaded || started.current) return;
    started.current = true;
    // Opened with a VS Code workspace file: its DEV tab instead of the usual terminal.
    void invoke<string | null>("launch_workspace_take")
      .catch(() => null)
      .then((file) => (file ? workspaceFoldersOf(file) : []))
      .then((folders) => {
        if (folders.length > 0) openWorkspaceRef.current(folders);
        else dispatch({ type: "open", target: localTargetOf(terminalSettings.settings) });
      });
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
  // The interface, the AI chat and the file viewer scale their text apart from the terminal (App.css: --ui-scale).
  const { uiFontSize, chatFontSize, viewerFontSize } = terminalSettings.settings;
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--ui-scale", String(uiFontSize / BASE_TEXT_SIZE));
    root.setProperty("--chat-scale", String(chatFontSize / BASE_TEXT_SIZE));
    root.setProperty("--viewer-scale", String(viewerFontSize / BASE_TEXT_SIZE));
  }, [uiFontSize, chatFontSize, viewerFontSize]);
  // The interface language (S3): the chosen one, or the system's, English when unsupported.
  const language = terminalSettings.settings.language;
  useLayoutEffect(() => setLocale(resolveLocale(language, systemLanguages())), [language]);
  const t = useT();
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Viewers holding unsaved edits, as `tabKey\npaneId`. */
  const unsavedViewers = useRef(new Set<string>());
  const markUnsaved = (tabKey: string, paneId: string, dirty: boolean) => {
    const id = `${tabKey}\n${paneId}`;
    if (dirty) unsavedViewers.current.add(id);
    else unsavedViewers.current.delete(id);
  };
  /**
   * Dispatches a tab action, asking first when it would close a viewer holding unsaved edits or
   * show another file in it (its tab, its terminal or the viewer itself closing).
   */
  const dispatchKeepingEdits = async (action: TabsAction) => {
    const before = stateRef.current;
    const after = tabsReducer(before, action);
    const lost = before.tabs.flatMap((tab) =>
      Object.entries(tab.viewers ?? {})
        .filter(([paneId, viewer]) => {
          if (!unsavedViewers.current.has(`${tab.key}\n${paneId}`)) return false;
          const kept = after.tabs.find((next) => next.key === tab.key)?.viewers?.[paneId];
          return kept?.opened !== viewer.opened;
        })
        .map(([, viewer]) => basename(viewer.path)),
    );
    if (lost.length > 0) {
      const question = t("app.viewer.discardQuestion", { name: lost.join(", ") });
      if (!(await dialogs.confirm({ message: question, confirmLabel: t("app.viewer.discard"), danger: true }))) return;
    }
    dispatch(action);
  };
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
  const [chatDrops] = useState(() => createTargetRegistry<ChatTarget>());
  const [aiLimit] = useState(() => createAiLimiter());
  const [aiHints, setAiHints] = useState<Record<string, AiHint>>({});
  /** Folders added to each DEV tab's workspace, by tab key (VS Code-style roots in the Explorer). */
  const [workspaceFolders, setWorkspaceFolders] = useState<Record<string, string[]>>({});
  /** This window's toolbar colour (right-click the toolbar), to tell PlexusTerm windows apart. */
  const [toolbarColor, setToolbarColorState] = useState<string | null>(loadToolbarColor);
  const [toolbarMenu, setToolbarMenu] = useState<{ x: number; y: number } | null>(null);
  const setToolbarColor = (color: string | null) => {
    setToolbarColorState(color);
    saveToolbarColor(color);
  };
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
        next.logging === current.logging &&
        next.attention === current.attention &&
        next.prompts === current.prompts &&
        next.branch === current.branch &&
        next.busy === current.busy
        ? prev
        : { ...prev, [paneId]: next };
    });
  }, []);

  /** Counts a pane's prompts, so its git branch is read again after each command. */
  const promptCameBack = useCallback((paneId: string) => {
    setPaneMeta((prev) => {
      const current = prev[paneId] ?? NO_SESSION;
      return { ...prev, [paneId]: { ...current, prompts: current.prompts + 1 } };
    });
  }, []);

  /**
   * DEV mode's project for a tab turning on (S10): the folder the tool was opened in, the pane's
   * shell folder (OSC 7, else asked from the backend); null when it cannot be known (Mosh, Telnet
   * and serial terminals have no channel to ask through).
   */
  const locateProject: LocateProject = async (tabKey, paneId) => {
    const tab = state.tabs.find((t) => t.key === tabKey);
    const sessionId = paneMeta[paneId]?.sessionId ?? null;
    const kind = tab?.target.type;
    if (sessionId === null || (kind !== "local" && kind !== "ssh")) return null;
    const folder =
      paneMeta[paneId]?.cwd ?? (kind === "local" ? await local.shellCwd(sessionId) : await sftp.shellCwd(sessionId));
    if (!folder) return null;
    return { folder, root: folder };
  };
  const dev = useDevMode(locateProject);
  const { forget: forgetDev, toggle: toggleDev } = dev;

  // Forget what closed panes reported.
  useEffect(() => {
    forgetDev(new Map(state.tabs.map((t) => [t.key, paneIds(t.layout)])));
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
    const tabKeys = new Set(state.tabs.map((t) => t.key));
    setWorkspaceFolders((prev) => {
      const keys = Object.keys(prev).filter((key) => tabKeys.has(key));
      return keys.length === Object.keys(prev).length ? prev : Object.fromEntries(keys.map((key) => [key, prev[key]]));
    });
  }, [state.tabs, forgetDev]);
  // The conversations belong to this window's terminals.
  useEffect(() => () => forgetChatsExcept(new Set()), []);

  const activeTab = state.tabs.find((t) => t.key === state.activeKey) ?? null;
  /** A tab opened from a DEV tab (+, Duplicate, Open in terminal): it turns DEV mode on once its shell has started. */
  const devOnStart = useRef<string | null>(null);
  useEffect(() => {
    const tab = state.tabs.find((t) => t.key === devOnStart.current);
    if (!tab) return;
    const pane = terminalPaneOf(tab);
    if ((paneMeta[pane]?.sessionId ?? null) === null) return;
    devOnStart.current = null;
    if (!dev.state[tab.key]) toggleDev(tab.key, pane);
  }, [state.tabs, paneMeta, dev.state, toggleDev]);
  // SFTP and the followed folder belong to the focused pane of the active tab (S11.5); an AI
  // chat pane stands for its terminal (S9).
  const activePane = activeTab ? terminalPaneOf(activeTab) : null;
  const activeSession = (activePane && paneMeta[activePane]) || NO_SESSION;
  // DEV mode of the active tab (S10): its file lists stay at the project the CLI started in.
  const activeDev = activeTab ? dev.state[activeTab.key] : undefined;
  const devAnchor = activeDev ? (activeDev.root ?? activeDev.folder) : null;
  const sftpSessionId = activeTab?.target.type === "ssh" ? activeSession.sessionId : null;
  // The Explorer tab belongs to a local terminal; its pty id lets the backend read the shell's folder.
  const localPtyId = activeTab?.target.type === "local" ? activeSession.sessionId : null;
  const localShown = localPtyId !== null && sidebarView === "explorer" && !terminalSettings.settings.sidebarCollapsed;
  const localCwd = useShellCwd(localPtyId, activeSession.cwd, localShown && followLocalCwd);
  // SFTP follows a remote shell without OSC 7 by reading its folder on the server; the sidebar
  // shows SFTP for an SSH tab on either file tab.
  const sftpShown =
    sftpSessionId !== null && (sidebarView === "sftp" || sidebarView === "explorer") && !terminalSettings.settings.sidebarCollapsed;
  const sftpCwd = useShellCwd(sftpSessionId, activeSession.cwd, sftpShown && followCwd, sftp.shellCwd);
  // The file lists read their git status again while the active terminal prints (AI CLIs edit
  // files as they go), through the same output feed macros wait on.
  const activeSessionId = activeSession.sessionId;
  const activePaneOutput = useCallback(
    (listener: (text: string) => void) =>
      (activePane !== null && activeSessionId !== null ? macroTargets.get(activePane)?.subscribe(listener) : undefined) ??
      (() => {}),
    [activePane, activeSessionId, macroTargets],
  );
  const canSplit = activeTab !== null && paneIds(activeTab.layout).length < MAX_PANES;
  const loggingTabs = new Set(
    state.tabs.filter((t) => paneIds(t.layout).some((id) => paneMeta[id]?.logging)).map((t) => t.key),
  );
  const attentionTabs = new Set(
    state.tabs.filter((t) => paneIds(t.layout).some((id) => paneMeta[id]?.attention)).map((t) => t.key),
  );
  const devTabs = new Set(Object.keys(dev.state));
  /** Tabs whose CLI is working: its pane is printing (S13). */
  const busyTabs = new Set(
    Object.entries(dev.state)
      .filter(([, tabDev]) => tabDev.cli !== null && tabDev.pane !== null && paneMeta[tabDev.pane]?.busy)
      .map(([key]) => key),
  );
  /** The tab column of DEV mode (S13): each tab's CLI and project folder (its terminal's folder outside DEV mode). */
  const tabDetails = new Map(
    state.tabs.map((t) => {
      const tabDev = dev.state[t.key];
      const folder = tabDev ? (tabDev.root ?? tabDev.folder) : (paneMeta[terminalPaneOf(t)]?.cwd ?? null);
      return [t.key, { cli: tabDev?.cli ?? null, folder: folder ? basename(folder) : null }];
    }),
  );

  // The pane being looked at loses its attention mark: when it gets the focus, and when the window
  // comes back to the front with it focused.
  const lookedAt = activeTab?.focusedPane ?? null;
  const lookedAtRef = useRef(lookedAt);
  lookedAtRef.current = lookedAt;
  useEffect(() => {
    if (lookedAt !== null && document.hasFocus()) updatePane(lookedAt, { attention: false });
  }, [lookedAt, updatePane]);
  useEffect(() => {
    const onFocus = () => {
      if (lookedAtRef.current !== null) updatePane(lookedAtRef.current, { attention: false });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [updatePane]);
  const [notifier] = useState(() =>
    createNotifier({ send: (title, body) => void showSystemNotification(title, body) }),
  );

  // Terminal panes only: AI chat panes never take part in multi-execution (S9).
  const allPanes: PaneInfo[] = state.tabs.flatMap((t) =>
    paneIds(t.layout).filter((id) => isTerminalPane(t, id)).map((id) => ({
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
  const { localShell, localShellArgs, localCwd: localStart } = terminalSettings.settings;
  const openLocal = useCallback(
    () => open(localTargetOf({ localShell, localShellArgs, localCwd: localStart })),
    [open, localShell, localShellArgs, localStart],
  );

  /** A workspace's folders open as a new DEV tab in the first one, with the others added. */
  const openWorkspace = ([first, ...others]: string[]) => {
    const key = `tab-${state.nextSeq}`;
    devOnStart.current = key;
    setWorkspaceFolders((prev) => ({ ...prev, [key]: others }));
    open(localTargetOf({ localShell, localShellArgs, localCwd: first }));
  };
  openWorkspaceRef.current = openWorkspace;

  // A workspace file given to a second launch of PlexusTerm (it then exits) opens here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<string>("open-workspace", ({ payload }) => {
      void workspaceFoldersOf(payload).then((folders) => folders.length > 0 && openWorkspaceRef.current(folders));
    })
      .then((stop) => (disposed ? stop() : (unlisten = stop)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
  // Settings → AI → keep conversations (S9): read before the first chat is listed.
  setChatSaving(settings.aiSaveChats);

  /**
   * A program in a pane rang the bell or sent a desktop notification. Nothing happens while the user
   * is looking at that pane (so a shell's bell while typing raises no noise); otherwise the pane and
   * its tab are marked, and a desktop notification is shown when the window is in the background.
   */
  const attend = (tab: Tab, paneId: string, notice: AttentionNotice) => {
    const windowFocused = document.hasFocus();
    if (windowFocused && state.activeKey === tab.key && tab.focusedPane === paneId) return;
    updatePane(paneId, { attention: true });
    // A DEV tab notifies even with desktop notifications off (S10).
    if (!windowFocused && (settings.attentionNotifications || dev.state[tab.key])) {
      notifier.notify(paneId, notice.title ?? tabTitle(tab), notice.body ?? t("app.tabs.attentionNotice"));
    }
  };

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
    openAssistantFor(activeTab);
  };

  /** Opens (or focuses) the AI chat of `tab`'s focused pane, with that pane's selection attached. */
  const openAssistantFor = (tab: Tab) => {
    const next = chatAction(tab);
    if (next.kind === "full") {
      return setNotice(t("app.notice.tabFull", { max: MAX_PANES }));
    }
    if (next.kind === "terminal") {
      dispatch({ type: "focusPane", key: tab.key, paneId: next.paneId });
      assistTargets.get(next.paneId)?.focus();
      return;
    }
    const selection =
      next.kind === "open" ? truncateSelection(assistTargets.get(next.terminalPaneId)?.selection() ?? "") : "";
    void commandHistory.ready();
    dispatch({ type: "openChat", key: tab.key, selection });
    if (!prefersReducedMotion()) setSpin((n) => n + 1);
  };

  /** "Ask the AI" from a terminal's menu (S7): that pane's chat, with the selection it was opened on. */
  const askAiFrom = (tab: Tab, paneId: string) => {
    const open = Object.keys(tab.chats).find((id) => tab.chats[id].terminalPaneId === paneId);
    if (open) {
      // Its chat is already open: the selection goes to its next question.
      dispatch({ type: "focusPane", key: tab.key, paneId: open });
      chatDrops.get(open)?.attachSelection(assistTargets.get(paneId)?.selection() ?? "");
      return;
    }
    dispatch({ type: "focusPane", key: tab.key, paneId });
    openAssistantFor({ ...tab, focusedPane: paneId });
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
    const tab = state.tabs.find((t) => paneIds(t.layout).includes(paneId) && isTerminalPane(t, paneId));
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
  /**
   * A folder opened in the SFTP browser or the Explorer (L16): the pane's shell changes to it when
   * Settings ask for it, the panel's Follow terminal folder is on (off unlinks both ways), the
   * command line is empty and the folder is on the pane's machine.
   */
  const cdFromBrowser = (paneId: string | null, origin: PathOrigin, path: string, follow: boolean) => {
    if (!paneId || !follow || !terminalSettings.settings.terminalFollowsBrowser) return;
    const tab = state.tabs.find((t) => paneIds(t.layout).includes(paneId) && isTerminalPane(t, paneId));
    const pane = assistTargets.get(paneId);
    if (!tab || !pane?.lineEmpty?.()) return;
    const action = dropAction([{ path, isDir: true }], {
      lineEmpty: true,
      sameMachine: sameMachine(origin, tab.target.type, paneMeta[paneId]?.sessionId ?? null),
      flavor: shellFlavor(platform, tab.target.type, runningShellOf(tab.target, shells)),
    });
    if (action.kind === "run") pane.run(action.command);
  };

  /** A stable way to listen to each terminal pane's output (a file viewer follows its terminal's). */
  const outputListeners = useRef(new Map<string, (listener: (text: string) => void) => () => void>());
  const outputOf = (paneId: string) => {
    let subscribe = outputListeners.current.get(paneId);
    if (!subscribe) {
      subscribe = (listener) => macroTargets.get(paneId)?.subscribe(listener) ?? (() => {});
      outputListeners.current.set(paneId, subscribe);
    }
    return subscribe;
  };
  /** The text of a viewer's file, from this computer or through its SFTP session. */
  const viewFile = (viewer: ViewerLink, encoding?: string) =>
    viewer.origin.kind === "local"
      ? local.viewText(viewer.path, encoding)
      : sftp.viewText(viewer.origin.sessionId, viewer.path, encoding);
  /** Saves a viewer's edited text over its file while the file still holds `expected`. */
  const saveViewedFile = (viewer: ViewerLink, expected: string, content: string, encoding: string, readAs: string) =>
    viewer.origin.kind === "local"
      ? local.writeText(viewer.path, expected, content, encoding, readAs)
      : sftp.writeText(viewer.origin.sessionId, viewer.path, expected, content, encoding, readAs);
  /** The project folder of a local DEV tab (where its `.plexusterm` settings go), or null. */
  const projectOf = (key: string) => {
    const tab = state.tabs.find((t) => t.key === key);
    const tabDev = dev.state[key];
    const project = tabDev ? (tabDev.root ?? tabDev.folder) : null;
    return tab?.target.type === "local" ? project : null;
  };
  /**
   * A tab's colour; a local DEV tab's is its project's too, saved in `<project>/.plexusterm/` so the
   * project's tabs get it again (like VS Code's Peacock).
   */
  const colorTab = (key: string, color: string | null) => {
    dispatch({ type: "setColor", key, color });
    const project = projectOf(key);
    if (!project) return;
    invoke("project_color_set", { folder: project, kind: "tab", color }).catch((err) => setNotice(String(err)));
  };
  /** The toolbar colour saved by each project (DEV mode), shown while one of its tabs is active. */
  const [projectToolbar, setProjectToolbar] = useState<Record<string, string | null>>({});
  const activeProject = activeTab ? projectOf(activeTab.key) : null;
  const shownToolbarColor = (activeProject && projectToolbar[activeProject]) || toolbarColor;
  /** The toolbar's colour menu: the active DEV tab's project's colour, else this window's. */
  const pickToolbarColor = (color: string | null) => {
    if (!activeProject) return setToolbarColor(color);
    setProjectToolbar((prev) => ({ ...prev, [activeProject]: color }));
    invoke("project_color_set", { folder: activeProject, kind: "toolbar", color }).catch((err) => setNotice(String(err)));
  };
  /** DEV tabs already given their project's colours, by tab and project. */
  const projectColorsRead = useRef(new Set<string>());
  useEffect(() => {
    for (const tab of state.tabs) {
      const tabDev = dev.state[tab.key];
      const project = tabDev ? (tabDev.root ?? tabDev.folder) : null;
      if (tab.target.type !== "local" || !project) continue;
      const read = `${tab.key}\0${project}`;
      if (projectColorsRead.current.has(read)) continue;
      projectColorsRead.current.add(read);
      invoke<{ tabColor: string | null; toolbarColor: string | null }>("project_colors_get", { folder: project })
        .then((colors) => {
          if (colors.tabColor) dispatch({ type: "setColor", key: tab.key, color: colors.tabColor });
          setProjectToolbar((prev) => ({ ...prev, [project]: colors.toolbarColor }));
        })
        .catch(() => {});
    }
  }, [state.tabs, dev.state]);
  /** Shows a file of the file lists in the viewer of the active tab's terminal, on the side Settings choose. */
  const viewInTab = (origin: PathOrigin, path: string) => {
    if (!activeTab) return;
    const terminal = terminalPaneOf(activeTab);
    const hasViewer = Object.values(activeTab.viewers ?? {}).some((v) => v.terminalPaneId === terminal);
    if (!hasViewer && paneIds(activeTab.layout).length >= MAX_PANES) return setNotice(t("app.viewer.full"));
    const position = terminalSettings.settings.viewerPosition;
    void dispatchKeepingEdits({ type: "openViewer", key: activeTab.key, path, origin, position });
  };
  /**
   * "Open in terminal" on a folder of the file lists. The Explorer opens a local terminal with the
   * same shell starting there; the SFTP browser opens another tab of the same SSH login (as
   * Duplicate does, so it authenticates the same way) and changes to the folder once its shell is
   * ready, with the same quoted `cd` a dropped folder runs.
   */
  const openInTerminal = (path: string) => {
    if (!activeTab) return;
    const { target } = activeTab;
    if (target.type !== "local" && target.type !== "ssh") return;
    // From a DEV tab the new terminal is a DEV tab too.
    if (activeDev) devOnStart.current = `tab-${state.nextSeq}`;
    if (target.type === "local") return open({ ...target, cwd: path });
    // The pane the "open" action is about to create (see tabsReducer).
    pendingCd.current.set(`pane-${state.nextPaneSeq}`, path);
    open(target);
  };
  /** SSH panes opened by "Open in terminal" and the folder each changes to once ready. */
  const pendingCd = useRef(new Map<string, string>());
  /**
   * Runs a pending `cd` in a pane whose session just started, once its shell is ready: when what
   * it prints at login (banner, prompt) has gone quiet, or soon if it printed before we listened.
   */
  const cdWhenReady = (paneId: string, target: SessionTarget) => {
    const path = pendingCd.current.get(paneId);
    if (path === undefined) return;
    pendingCd.current.delete(paneId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: () => void = () => {};
    const run = () => {
      stop();
      const pane = assistTargets.get(paneId);
      const action = dropAction([{ path, isDir: true }], {
        lineEmpty: true,
        sameMachine: true,
        flavor: shellFlavor(platform, target.type, runningShellOf(target, shells)),
      });
      if (action.kind === "unsafe") setNotice(t("sftp.error.unsafePath"));
      else if (action.kind === "run") pane?.run(action.command);
    };
    const wait = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(run, ms);
    };
    stop = macroTargets.get(paneId)?.subscribe(() => wait(SHELL_QUIET_MS)) ?? (() => {});
    wait(SHELL_FIRST_OUTPUT_MS);
  };

  const dropRef = useRef<(drag: PathDrag, target: Element | null) => void>(() => {});
  dropRef.current = (drag, target) => {
    const paneId = target?.getAttribute("data-drop-pane");
    if (paneId) return dropOnPane(paneId, drag);
    // Files dropped on an AI chat are attached to its next question (S6).
    const chatId = target?.getAttribute("data-drop-chat");
    if (chatId) chatDrops.get(chatId)?.attachFiles(drag);
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
  /** The user's shortcut overrides and what the window shortcuts read without re-subscribing. */
  const shortcutKeys = useRef({
    overrides: settings.shortcuts,
    tabs: state.tabs,
    activeKey: state.activeKey,
    sidebarCollapsed: settings.sidebarCollapsed,
  });
  shortcutKeys.current = {
    overrides: settings.shortcuts,
    tabs: state.tabs,
    activeKey: state.activeKey,
    sidebarCollapsed: settings.sidebarCollapsed,
  };

  // Terminals let these keys through unhandled (see TerminalView), so the window sees them.
  useEffect(() => {
    /** The tab `step` places after (or before) the active one, wrapping around. */
    const tabBeside = (step: 1 | -1) => {
      const { tabs, activeKey } = shortcutKeys.current;
      if (tabs.length < 2) return;
      const index = tabs.findIndex((tab) => tab.key === activeKey);
      dispatch({ type: "activate", key: tabs[(index + step + tabs.length) % tabs.length].key });
    };
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, assistantKeys.current.shortcut)) {
        e.preventDefault();
        if (!assistantKeys.current.blocked) assistantKeys.current.openAssistant();
        return;
      }
      const shortcut = shortcutFor(e, shortcutKeys.current.overrides);
      if (!shortcut) return;
      e.preventDefault();
      switch (shortcut.type) {
        case "newTerminal":
          return openLocal();
        case "quickConnect":
          return setModal({ kind: "quickConnect" });
        case "newSerial":
          return setModal({ kind: "serial" });
        case "newTelnet":
          return setModal({ kind: "telnet" });
        case "newMosh":
          return setModal({ kind: "mosh" });
        case "tool":
          return setModal({ kind: shortcut.tool });
        case "openSettings":
          return setModal({ kind: "settings" });
        case "toggleRemoteMonitor":
          return updateSettingsWith((s) => ({ remoteMonitor: !s.remoteMonitor }));
        case "toggleMultiExec":
          return setMultiExec((on) => !on);
        case "toggleDevMode":
          if (activeTab) toggleDev(activeTab.key, terminalPaneOf(activeTab));
          return;
        case "fontSize":
          // In the AI chat the keys size its text; anywhere else, the terminals'.
          if (document.activeElement?.closest(".chat")) {
            return updateSettingsWith((s) => ({ chatFontSize: stepChatFontSize(s.chatFontSize, shortcut.step) }));
          }
          return updateSettingsWith((s) => ({ fontSize: stepFontSize(s.fontSize, shortcut.step) }));
        case "recordMacro":
          return macroKeys.current.toggleRecording();
        case "toggleSidebar":
          return updateSettingsWith((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
        case "sidebarView":
          // Like a click on the sidebar tab: a folded sidebar opens.
          setSidebarView(shortcut.view);
          if (shortcutKeys.current.sidebarCollapsed) updateSettingsWith(() => ({ sidebarCollapsed: false }));
          return;
        case "playMacro":
          return macroKeys.current.playHotkey(shortcut.hotkey);
        case "nextTab":
          return tabBeside(1);
        case "previousTab":
          return tabBeside(-1);
        // Handled by the focused terminal itself.
        case "find":
        case "copy":
        case "paste":
        case "selectAll":
        case "clear":
        case "saveOutput":
        case "toggleLogging":
        case "askAi":
          return;
      }
      if (!activeTab) return;
      const key = activeTab.key;
      if (shortcut.type === "closeTab") void dispatchKeepingEdits({ type: "close", key });
      else if (shortcut.type === "closePane") void dispatchKeepingEdits({ type: "closePane", key, paneId: activeTab.focusedPane });
      else if (shortcut.type === "split") dispatch({ type: "split", key, direction: shortcut.direction });
      else dispatch({ type: "focusDirection", key, direction: shortcut.direction });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLocal, activeTab, updateSettingsWith, toggleDev]);

  /** A title with an action's shortcut in it, or the plain label when the action has none. */
  const titleWith = (key: AppKey, plainKey: AppKey, action: ShortcutActionId) => {
    const shortcut = shortcutLabel(action, settings.shortcuts);
    return shortcut ? t(key, { shortcut }) : t(plainKey);
  };
  const sshShortcut = shortcutLabel("quickConnect", settings.shortcuts);

  const toolbarRef = useRef<HTMLElement>(null);
  const compactToolbar = useCompactToolbar(toolbarRef);

  const split = (direction: "row" | "column") => {
    if (activeTab) dispatch({ type: "split", key: activeTab.key, direction });
  };

  return (
    <div className="app">
      <header
        className={`toolbar${compactToolbar ? " toolbar--compact" : ""}${shownToolbarColor ? " toolbar--coloured" : ""}`}
        ref={toolbarRef}
        style={
          shownToolbarColor
            ? ({ "--toolbar-bg": shownToolbarColor, "--toolbar-fg": readableOn(shownToolbarColor) } as CSSProperties)
            : undefined
        }
        onContextMenu={(e) => {
          // The bar itself, not its buttons.
          if ((e.target as Element).closest("button, input, a, select")) return;
          e.preventDefault();
          setToolbarMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {toolbarMenu && (
          <ColorMenu
            x={toolbarMenu.x}
            y={toolbarMenu.y}
            current={shownToolbarColor}
            onPick={pickToolbarColor}
            onClose={() => setToolbarMenu(null)}
          />
        )}
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
          title={
            settings.sidebarCollapsed
              ? titleWith("app.toolbar.showSidebarTitle", "app.toolbar.showSidebar", "toggleSidebar")
              : titleWith("app.toolbar.hideSidebarTitle", "app.toolbar.hideSidebar", "toggleSidebar")
          }
          onClick={() => updateSettingsWith((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))}
        >
          {settings.sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button className="btn btn--icon" title={titleWith("app.toolbar.terminalTitle", "app.toolbar.terminal", "newTerminal")} onClick={openLocal}>
          <SquareTerminal size={16} />
          <span className="btn__label">{t("app.toolbar.terminal")}</span>
        </button>
        <button
          className="btn btn--icon"
          title={sshShortcut ? `SSH (${sshShortcut})` : "SSH"}
          onClick={() => setModal({ kind: "quickConnect" })}>
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
        <button className="btn btn--icon" disabled={!canSplit} title={titleWith("app.toolbar.splitRightTitle", "app.toolbar.splitRight", "splitRight")} onClick={() => split("row")}>
          <Columns2 size={16} />
          <span className="btn__label">{t("app.toolbar.splitRight")}</span>
        </button>
        <button className="btn btn--icon" disabled={!canSplit} title={titleWith("app.toolbar.splitDownTitle", "app.toolbar.splitDown", "splitDown")} onClick={() => split("column")}>
          <Rows2 size={16} />
          <span className="btn__label">{t("app.toolbar.splitDown")}</span>
        </button>
        <button
          className={`btn btn--icon${multiExec ? " btn--pressed" : ""}`}
          aria-pressed={multiExec}
          title={titleWith("app.toolbar.multiExecTitle", "app.toolbar.multiExec", "toggleMultiExec")}
          onClick={() => setMultiExec((on) => !on)}
        >
          <Radio size={16} />
          <span className="btn__label">{t("app.toolbar.multiExec")}</span>
        </button>
        <button
          className={`btn btn--icon${recording ? " btn--pressed btn--recording" : ""}`}
          aria-pressed={recording}
          title={titleWith("app.toolbar.recordMacroTitle", "app.toolbar.recordMacro", "recordMacro")}
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
                  // DEV mode lists from the project root (S10) and starts over when it ends.
                  key={`${activePane}:${localPtyId}${activeDev ? `:dev:${devAnchor ?? ""}` : ""}`}
                  // DEV mode opens at the folder the tool was opened in, then follows the terminal if asked.
                  cwd={activeDev && (!followLocalCwd || localCwd === null) ? devAnchor : localCwd}
                  follow={followLocalCwd}
                  startAt={activeDev ? devAnchor : null}
                  onFollowChange={setFollowLocalCwd}
                  workspace={{
                    folders: workspaceFolders[activeTab.key] ?? [],
                    onAdd: (folder) =>
                      setWorkspaceFolders((prev) => ({ ...prev, [activeTab.key]: [...(prev[activeTab.key] ?? []), folder] })),
                    onRemove: (folder) =>
                      setWorkspaceFolders((prev) => ({
                        ...prev,
                        [activeTab.key]: (prev[activeTab.key] ?? []).filter((f) => f !== folder),
                      })),
                    // A workspace file opens a new DEV tab in its first folder, with the others added.
                    onOpenFolders: openWorkspace,
                  }}
                  // The terminal runs an AI CLI in DEV mode: no cd is typed into it.
                  onUserNavigate={(path) => !activeDev && cdFromBrowser(activePane, { kind: "local" }, path, followLocalCwd)}
                  onPathToTerminal={(path) => {
                    const flavor = shellFlavor(platform, activeTab.target.type, runningShellOf(activeTab.target, shells));
                    const text = quotePath(path, flavor);
                    if (activePane && text !== null) writers.write([activePane], text);
                  }}
                  textEditor={terminalSettings.settings.textEditor}
                  details={terminalSettings.settings.fileDetails}
                  onOpenInTerminal={openInTerminal}
                  onView={(path) => viewInTab({ kind: "local" }, path)}
                  // DEV mode's tree, icons and git status (S10).
                  devStyle={activeDev !== undefined}
                  git={{
                    enabled: terminalSettings.settings.gitFileStatus,
                    visible: localShown,
                    prompt: activeSession.prompts,
                    subscribeOutput: activePaneOutput,
                  }}
                />
              )
            }
            sftp={
              activeTab &&
              sftpSessionId !== null && (
                <SftpPanel
                  key={`${activePane}:${sftpSessionId}${activeDev ? `:dev:${devAnchor ?? ""}` : ""}`}
                  sessionId={sftpSessionId}
                  cwd={activeDev && (!followCwd || sftpCwd === null) ? devAnchor : sftpCwd}
                  follow={followCwd}
                  startAt={activeDev ? devAnchor : null}
                  onFollowChange={setFollowCwd}
                  onPathToTerminal={(text) => activePane && writers.write([activePane], text)}
                  onUserNavigate={(path) =>
                    !activeDev && cdFromBrowser(activePane, { kind: "sftp", sessionId: sftpSessionId }, path, followCwd)
                  }
                  textEditor={terminalSettings.settings.textEditor}
                  details={terminalSettings.settings.fileDetails}
                  onOpenInTerminal={openInTerminal}
                  onView={(path) => sftpSessionId !== null && viewInTab({ kind: "sftp", sessionId: sftpSessionId }, path)}
                  // DEV mode's tree, icons and git status (S10).
                  devStyle={activeDev !== undefined}
                  git={{
                    enabled: terminalSettings.settings.gitFileStatus,
                    visible: sftpShown,
                    prompt: activeSession.prompts,
                    subscribeOutput: activePaneOutput,
                  }}
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
                recordShortcut={shortcutLabel("recordMacro", settings.shortcuts)}
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
        {/* DEV mode puts the tabs in a column at the right (S13); the workspace keeps its place in the tree. */}
        <section className={`main${activeDev ? " main--dev" : ""}`}>
          <TabBar
            tabs={state.tabs}
            activeKey={state.activeKey}
            logging={loggingTabs}
            attention={attentionTabs}
            dev={devTabs}
            busy={busyTabs}
            column={activeDev !== undefined}
            details={tabDetails}
            columnWidth={settings.tabColumnWidth}
            onColumnWidthChange={(tabColumnWidth) => terminalSettings.update({ tabColumnWidth })}
            onActivate={(key) => dispatch({ type: "activate", key })}
            onClose={(key) => void dispatchKeepingEdits({ type: "close", key })}
            onNew={() => {
              // From the DEV column the new terminal stays in DEV mode, as the column does.
              if (activeDev) devOnStart.current = `tab-${state.nextSeq}`;
              openLocal();
            }}
            onDuplicate={(key) => {
              // The copy of a DEV tab is a DEV tab too.
              if (dev.state[key]) devOnStart.current = `tab-${state.nextSeq}`;
              dispatch({ type: "duplicate", key });
            }}
            onColor={colorTab}
            onCloseOthers={(key) => void dispatchKeepingEdits({ type: "closeOthers", key })}
            onCloseRight={(key) => void dispatchKeepingEdits({ type: "closeRight", key })}
            onCloseAll={() => void dispatchKeepingEdits({ type: "closeAll" })}
            onCopyHost={(host) =>
              void writeText(host).catch(() => setNotice(t("app.notice.copyFailed")))
            }
          />
          <main className="workspace">
            {state.tabs.map((tab) => {
              const active = tab.key === state.activeKey;
              const tabDev = dev.state[tab.key];
              return (
                <div key={tab.key} className="tab-panes" hidden={!active}>
                  <PaneGrid
                    layout={tab.layout}
                    focusedPane={tab.focusedPane}
                    onFocusPane={(paneId) => dispatch({ type: "focusPane", key: tab.key, paneId })}
                    onResize={(splitId, ratio) => dispatch({ type: "resizeSplit", key: tab.key, splitId, ratio })}
                    renderPane={(paneId) => {
                      const viewer = tab.viewers?.[paneId];
                      if (viewer) {
                        return (
                          <FileViewer
                            // Each View reads the file again (it may have changed, or come from elsewhere).
                            key={viewer.opened}
                            path={viewer.path}
                            load={(encoding) => viewFile(viewer, encoding)}
                            save={(expected, content, encoding, readAs) => saveViewedFile(viewer, expected, content, encoding, readAs)}
                            autoSave={terminalSettings.settings.viewerAutoSave}
                            onDirtyChange={(dirty) => markUnsaved(tab.key, paneId, dirty)}
                            // Changed lines against the last commit, for local files (git on this machine).
                            loadCommitted={viewer.origin.kind === "local" ? () => local.committedText(viewer.path) : undefined}
                            showChanges={terminalSettings.settings.viewerChangedLines}
                            onShowChangesChange={(show) => updateSettingsWith(() => ({ viewerChangedLines: show }))}
                            // It follows the file while its terminal works (an AI tool editing it).
                            subscribeOutput={outputOf(viewer.terminalPaneId)}
                            prompt={paneMeta[viewer.terminalPaneId]?.prompts ?? 0}
                            onClose={() => void dispatchKeepingEdits({ type: "closePane", key: tab.key, paneId })}
                          />
                        );
                      }
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
                                onClose={() => void dispatchKeepingEdits({ type: "closePane", key: tab.key, paneId })}
                                registerDropTarget={(target) => chatDrops.register(paneId, target)}
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
                              dev.title(tab.key, paneId, title, settings.devCommands);
                            }}
                            onExit={() => void dispatchKeepingEdits({ type: "closePane", key: tab.key, paneId })}
                            onCwd={(cwd) => updatePane(paneId, { cwd })}
                            onSession={(sessionId) => {
                              updatePane(paneId, { sessionId });
                              if (sessionId !== null) cdWhenReady(paneId, tab.target);
                              // A new SSH connection brings its file browser to the front; a local terminal
                              // shows the Explorer instead of Sessions, leaving any other tab chosen (L18).
                              if (sessionId !== null && tab.target.type === "ssh") setSidebarView("sftp");
                              if (sessionId !== null && tab.target.type === "local") {
                                setSidebarView((view) => (view === "sessions" ? "explorer" : view));
                              }
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
                            onAskAi={() => askAiFrom(tab, paneId)}
                            onAttention={(notice) => attend(tab, paneId, notice)}
                            onPrompt={(mark) => {
                              promptCameBack(paneId);
                              if (mark) dev.promptMark(tab.key, paneId);
                            }}
                            onCommand={(command, prompt) => dev.command(tab.key, paneId, command, prompt, settings.devCommands)}
                            // Only a DEV tab running an AI tool shows it: anywhere else every burst
                            // of output would draw the whole window again for nothing.
                            onActivity={(busy) => {
                              if (!busy || tabDev?.cli) updatePane(paneId, { busy });
                            }}
                            onOutputQuiet={
                              tabDev?.pane === paneId && tabDev.prompt
                                ? (row) => dev.quiet(tab.key, paneId, row)
                                : undefined
                            }
                          />
                          <GitBranchReporter
                            source={branchSourceOf(tab.target, paneMeta[paneId]?.sessionId ?? null)}
                            cwd={paneMeta[paneId]?.cwd ?? null}
                            prompt={paneMeta[paneId]?.prompts ?? 0}
                            // Only DEV mode reads and shows the branch (S10, L5).
                            enabled={tabDev !== undefined}
                            onBranch={(branch) => updatePane(paneId, { branch })}
                          />
                          {paneIds(tab.layout).length > 1 && paneMeta[paneId]?.attention && (
                            <span
                              className="pane__attention"
                              role="img"
                              aria-label={t("app.tabs.attention")}
                              title={t("app.tabs.attention")}
                            />
                          )}
                          {aiHints[paneId] && (
                            <div className="pane__ai-hint" title={aiHints[paneId].detail}>
                              {aiHints[paneId].text}
                            </div>
                          )}
                          {paneIds(tab.layout).length > 1 && (
                            <PaneCloseButton
                              shortcut={shortcutLabel("closePane", settings.shortcuts)}
                              onClose={() => void dispatchKeepingEdits({ type: "closePane", key: tab.key, paneId })}
                            />
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
                          {(() => {
                            // One bar under the terminal: its git branch (DEV mode only), then (SSH) the remote
                            // monitor, and the DEV button at its right end for terminals that can run AI CLIs.
                            // A terminal with another one below it keeps only the DEV option, without the bar:
                            // the bar of the one below shows its own branch and monitor.
                            const below = neighbour(tab.layout, paneId, "down");
                            const bare = below !== null && isTerminalPane(tab, below);
                            const branch = tabDev && !bare ? paneMeta[paneId]?.branch : null;
                            const monitor = tab.target.type === "ssh" && settings.remoteMonitor && !bare;
                            const devButton = DEV_TARGETS.has(tab.target.type);
                            if (!branch && !monitor && !devButton) return null;
                            const devShortcut = shortcutLabel("toggleDevMode", settings.shortcuts);
                            return (
                              <div className={`pane-footer${bare ? " pane-footer--bare" : ""}`}>
                                {branch && (
                                  <span className="pane-footer__branch" dir="auto" title={t("app.tabs.branch", { branch })}>
                                    <GitBranch size={13} aria-hidden="true" />
                                    <span className="pane-footer__branch-name">{branch}</span>
                                  </span>
                                )}
                                {monitor && <RemoteMonitorBar sessionId={paneMeta[paneId]?.sessionId ?? null} active={active} />}
                                {devButton && (
                                  <button
                                    type="button"
                                    className={`pane-footer__dev${tabDev ? " pane-footer__dev--on" : ""}`}
                                    aria-pressed={tabDev !== undefined}
                                    aria-label={tabDev ? t("app.dev.on") : t("app.dev.off")}
                                    title={
                                      devShortcut
                                        ? t(tabDev ? "app.dev.onShortcut" : "app.dev.offShortcut", { shortcut: devShortcut })
                                        : tabDev
                                          ? t("app.dev.on")
                                          : t("app.dev.off")
                                    }
                                    // Keep the keyboard focus in the terminal.
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => dev.toggle(tab.key, paneId)}
                                  >
                                    <Code size={12} aria-hidden="true" />
                                    <span className="pane-footer__dev-label">DEV</span>
                                  </button>
                                )}
                              </div>
                            );
                          })()}
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
