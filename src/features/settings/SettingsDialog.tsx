import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { LicensesDialog } from "../licenses/LicensesDialog";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Code, FileText, Globe, Info, KeyRound, Keyboard, LayoutPanelTop, Palette, Search, Share2, SlidersHorizontal, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import { filterSettings } from "./settingsSearch";
import { LOCALES, t as translate, useT, type LanguageSetting } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import packageJson from "../../../package.json";
import wordmarkUrl from "../../assets/plexusterm-wordmark.svg";
import wordmarkLightUrl from "../../assets/plexusterm-wordmark-light.svg";
import { aiOpenCodeModels, describeAiError, type GoModels } from "../ai/aiClient";
import { aiProviderLabel } from "../ai/ModelPicker";
import { commandHistory } from "../history/historyStore";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { ShellPicker } from "../terminal/ShellPicker";
import { checkForUpdate, type Release } from "../updates/updates";
import { UpdateActions } from "../updates/UpdateActions";
import { TERMINAL_THEMES, themeById, type TerminalThemeEntry } from "../terminal/themes";
import {
  cleanLocalShell,
  clampAiHistoryContext,
  clampFontSize,
  clampChatFontSize,
  clampViewerFontSize,
  clampUiFontSize,
  FONT_WEIGHTS,
  LINE_HEIGHTS,
  MIN_UI_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_CHAT_FONT_SIZE,
  MAX_CHAT_FONT_SIZE,
  MIN_VIEWER_FONT_SIZE,
  clampRecentFolderLimit,
  clampCommandNotifySeconds,
  MAX_COMMAND_NOTIFY_SECONDS,
  MAX_VIEWER_FONT_SIZE,
  cleanAiBaseUrl,
  cleanShareUrl,
  cleanAiModel,
  cleanFontFamily,
  cleanTextEditor,
  cssFontFamily,
  DEFAULT_FONT_FAMILY,
  AI_PROVIDERS,
  DEFAULT_AI_MODELS,
  isAiProvider,
  MAX_AI_BASE_URL_LENGTH,
  MAX_AI_HISTORY_CONTEXT,
  MAX_AI_MODEL_LENGTH,
  MAX_FONT_FAMILY_LENGTH,
  MAX_FONT_SIZE,
  MAX_TEXT_EDITOR_LENGTH,
  MIN_FONT_SIZE,
  MIN_FOCUS_BORDER_STRENGTH,
  MAX_FOCUS_BORDER_STRENGTH,
  clampFocusBorderStrength,
  clampPaneFooterHeight,
  MAX_PANE_FOOTER_HEIGHT,
  MIN_PANE_FOOTER_HEIGHT,
  cleanHexColor,
  focusBorderCss,
  type AiProvider,
  type TerminalSettings, type SidebarAtStartup, type ViewerPosition, type NewTerminalFolder, type AiUsageChoice } from "./settings";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { shortcutLabel } from "../panes/shortcuts";
import { devCommandsText, parseDevCommands } from "../devmode/devMode";
import { MAX_RECENT_FOLDERS } from "../devmode/recentFolders";
import { BUNDLED_FONTS, catalogChoice, detectInstalledFonts } from "./fontCatalog";
import { SharingSettings, type SharingValues } from "../share/SharingSettings";
import { AuditLogDialog } from "../share/AuditLogDialog";
import { HelpTip } from "../sidebar/HelpTip";
import { ToolbarEditor } from "../toolbar/ToolbarEditor";
import type { ToolbarLayout } from "../toolbar/toolbarLayout";
import { ICON_PACKS, isIconPack } from "../files/iconPacks";
import { diagnosticLogDefaultDir } from "../diagnostics/useDiagnosticLog";
import { HighlightRulesEditor } from "./HighlightRulesEditor";
import type { Macro } from "../macros/macros";
import { parseHighlightRules } from "../terminal/highlightRules";
import type { SyncStatus } from "../sessions/useSessionSync";

interface SettingsDialogProps {
  settings: TerminalSettings;
  /** Applies the settings; called by itself a moment after each change, and on closing. */
  onSave: (settings: TerminalSettings) => void;
  /** Closes the dialog (anything still being edited was applied just before). */
  onCancel: () => void;
  /** Section shown first (Appearance when omitted). */
  initialSection?: SettingsSection;
  /** Applies and saves a language at once (the rescue buttons, S3). */
  onLanguageNow?: (language: LanguageSetting) => void;
  /** How the sync of the saved sessions went last (Connections). */
  syncStatus?: SyncStatus;
  /** How the sync of the settings went last, when it is on. */
  settingsSyncStatus?: SyncStatus;
  /** The saved macros a highlight rule's action can play (S3). */
  macros?: readonly Pick<Macro, "id" | "name">[];
}

const PREVIEW_COLOURS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

/** A few lines of a shell session drawn with the scheme's colours. */
function ThemePreview({ entry, fontFamily }: { entry: TerminalThemeEntry; fontFamily: string }) {
  const tr = useT();
  const t = entry.theme;
  return (
    <div
      className="theme-preview"
      aria-label={tr("settings.appearance.preview", { name: entry.name })}
      style={{ background: t.background, color: t.foreground, fontFamily: cssFontFamily(fontFamily) }}
    >
      <div>
        <span style={{ color: t.green }}>user@host</span>:<span style={{ color: t.blue }}>~/project</span>$ ls
      </div>
      <div>
        <span style={{ color: t.blue }}>src</span> <span style={{ color: t.green }}>build.sh</span> README.md{" "}
        <span style={{ color: t.red }}>error.log</span>
      </div>
      <div className="theme-preview__swatches">
        {PREVIEW_COLOURS.map((name) => (
          <span key={name} style={{ background: t[name] }} />
        ))}
        {PREVIEW_COLOURS.map((name) => {
          const bright = `bright${name[0].toUpperCase()}${name.slice(1)}` as keyof typeof t;
          return <span key={bright} style={{ background: t[bright] as string }} />;
        })}
      </div>
    </div>
  );
}

export type SettingsSection =
  | "general"
  | "appearance"
  | "toolbar"
  | "terminal"
  | "dev"
  | "ssh"
  | "files"
  | "ai"
  | "sharing"
  | "shortcuts"
  | "about";
type Section = SettingsSection;

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: "general", icon: SlidersHorizontal },
  { id: "appearance", icon: Palette },
  { id: "toolbar", icon: LayoutPanelTop },
  { id: "terminal", icon: SquareTerminal },
  { id: "dev", icon: Code },
  { id: "ssh", icon: KeyRound },
  { id: "files", icon: FileText },
  { id: "ai", icon: Sparkles },
  { id: "sharing", icon: Share2 },
  { id: "shortcuts", icon: Keyboard },
  { id: "about", icon: Info },
];

/** The sections in the order the side menu lists them (the command palette lists them too). */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = SECTIONS.map((s) => s.id);

/** A section's name in the current language. */
const sectionLabel = (id: Section) => translate(`settings.sections.${id}`);

/** Where OpenCode publishes its Go model list (public, no key). */
const OPENCODE_MODELS_URL = "https://opencode.ai/inference/go/v1/models";

/**
 * The OpenCode Go model picker (S7): the backend's list (24 h cache, Refresh asks again);
 * models PlexusTerm cannot talk to yet are shown disabled. Without a list the model is typed.
 */
function OpenCodeModelField({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const t = useT();
  const [list, setList] = useState<GoModels | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);

  const load = (refresh: boolean) => {
    setBusy(true);
    setError(null);
    aiOpenCodeModels(refresh)
      .then((models) => live.current && setList(models))
      .catch((err) => live.current && setError(describeAiError(err)))
      .finally(() => live.current && setBusy(false));
  };

  useEffect(() => {
    live.current = true;
    load(false);
    return () => {
      live.current = false;
    };
  }, []);

  const models = list?.models ?? [];
  return (
    <div className="field">
      <label htmlFor="settings-ai-model">{t("settings.ai.model")}</label>
      <div className="form-row field__picker">
        {models.length > 0 ? (
          <select id="settings-ai-model" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>
              {t("settings.ai.chooseModel")}
            </option>
            {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.supported}>
                {t(m.supported ? "settings.ai.modelOption" : "settings.ai.modelOptionUnsupported", {
                  name: m.name,
                  id: m.id,
                })}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="settings-ai-model"
            value={value}
            maxLength={MAX_AI_MODEL_LENGTH}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        <button type="button" className="btn" disabled={busy} onClick={() => load(true)}>
          {t("settings.ai.refreshModels")}
        </button>
      </div>
      {busy && <span className="muted">{t("settings.ai.loadingModels")}</span>}
      {list?.note && <span className="muted">{list.note}</span>}
      {error && (
        <span className="form-error">{t("settings.ai.modelsError", { error, url: OPENCODE_MODELS_URL })}</span>
      )}
    </div>
  );
}

type KeyStatus = "checking" | "saved" | "none" | "unavailable";

/**
 * The provider's API key in the system keyring: only whether one is saved is ever shown.
 * Saving and removing apply at once, not on Save. `usage`: the key kept apart for reading the
 * plan usage in the bar under a terminal, instead of the AI features' one.
 */
function ApiKeyField({ provider, usage = false }: { provider: AiProvider; usage?: boolean }) {
  const command = usage ? "usage_key" : "ai_key";
  const inputId = usage ? "settings-usage-key" : "settings-ai-key";
  const t = useT();
  const [status, setStatus] = useState<KeyStatus>("checking");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setStatus("checking");
    setError(null);
    Promise.resolve()
      .then(() => invoke<boolean>(`${command}_status`, { provider }))
      .then((saved) => current && setStatus(saved ? "saved" : "none"))
      .catch(() => current && setStatus("unavailable"));
    return () => {
      current = false;
    };
  }, [provider, command]);

  const run = (action: () => Promise<unknown>, after: KeyStatus, failure: "saveKeyFailed" | "removeKeyFailed") => {
    setBusy(true);
    setError(null);
    Promise.resolve()
      .then(action)
      .then(() => {
        setStatus(after);
        setKey("");
      })
      .catch((err) => setError(t(`settings.ai.${failure}`, { error: describeAiError(err) })))
      .finally(() => setBusy(false));
  };

  const label = {
    checking: t("settings.ai.keyChecking"),
    saved: t("settings.ai.keySaved"),
    none: t("settings.ai.keyNone"),
    unavailable: t("settings.ai.keyUnavailable"),
  };
  return (
    <div className="field">
      <label htmlFor={inputId}>{usage ? t("settings.terminal.aiUsageKey") : t("settings.ai.apiKey")}</label>
      <div className="form-row field__picker">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          value={key}
          placeholder={t(status === "saved" ? "settings.ai.keyReplacePlaceholder" : "settings.ai.keyPastePlaceholder")}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !key.trim()}
          onClick={() => run(() => invoke(`${command}_save`, { provider, key: key.trim() }), "saved", "saveKeyFailed")}
        >
          {t("settings.ai.saveKey")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || status !== "saved"}
          onClick={() => run(() => invoke(`${command}_delete`, { provider }), "none", "removeKeyFailed")}
        >
          {t("settings.ai.removeKey")}
        </button>
      </div>
      <span className="muted">{label[status]}</span>
      {usage && status !== "saved" && <span className="muted">{t("settings.terminal.aiUsageKeyHelp")}</span>}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

const APP_VERSION = packageJson.version;
/** A change is applied this long after the last edit (or at once when the dialog closes). */
export const AUTO_SAVE_DELAY_MS = 500;
const REPO_URL = "https://github.com/jorgealonsodev/PlexusTerm";
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;
/** The repository's issue forms (.github/ISSUE_TEMPLATE); `version` is the bug form's field id. */
const BUG_REPORT_URL = `${REPO_URL}/issues/new?template=bug_report.yml&version=${encodeURIComponent(APP_VERSION)}`;
const FEATURE_REQUEST_URL = `${REPO_URL}/issues/new?template=feature_request.yml`;

/** Opens a link in the system browser (the app window never navigates away). */
function openLink(e: MouseEvent, url: string) {
  e.preventDefault();
  void openUrl(url).catch(() => {});
}

/** Terminal settings shared by every tab (S15.6), in sections chosen from a side menu. */
/** The names of the terminal font weights. */
const WEIGHT_NAMES: Record<number, AppKey> = {
  300: "settings.appearance.weightLight",
  400: "settings.appearance.weightRegular",
  500: "settings.appearance.weightMedium",
  600: "settings.appearance.weightSemibold",
};

export function SettingsDialog({ settings, onSave, onCancel, initialSection, onLanguageNow, syncStatus, settingsSyncStatus, macros }: SettingsDialogProps) {
  const [licensesOpen, setLicensesOpen] = useState(false);
  const t = useT();
  const platform = usePlatform();
  const [language, setLanguage] = useState<LanguageSetting>(settings.language);
  const languageNow = (next: LanguageSetting) => {
    setLanguage(next);
    onLanguageNow?.(next);
  };
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [toolbarIconsOnly, setToolbarIconsOnly] = useState(settings.toolbarIconsOnly);
  const [toolbarLayout, setToolbarLayout] = useState<ToolbarLayout | null>(settings.toolbarLayout);
  const [uiFontSize, setUiFontSize] = useState(String(settings.uiFontSize));
  const [fontWeight, setFontWeight] = useState(settings.fontWeight);
  const [lineHeight, setLineHeight] = useState(settings.lineHeight);
  const [chatFontSize, setChatFontSize] = useState(String(settings.chatFontSize));
  const [viewerFontSize, setViewerFontSize] = useState(String(settings.viewerFontSize));
  const [focusBorderColor, setFocusBorderColor] = useState(settings.focusBorderColor);
  const [focusBorderStrength, setFocusBorderStrength] = useState(settings.focusBorderStrength);
  const [paneFooterHeight, setPaneFooterHeight] = useState(String(settings.paneFooterHeight));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);
  const [errorHighlight, setErrorHighlight] = useState(settings.errorHighlight);
  const [shellIntegration, setShellIntegration] = useState(settings.shellIntegration);
  const [logTimestamps, setLogTimestamps] = useState(settings.logTimestamps);
  const [shiftEnterNewline, setShiftEnterNewline] = useState(settings.shiftEnterNewline);
  const [attentionNotifications, setAttentionNotifications] = useState(settings.attentionNotifications);
  const [commandNotifySeconds, setCommandNotifySeconds] = useState(String(settings.commandNotifySeconds));
  const [highlightRules, setHighlightRules] = useState(settings.highlightRules);
  const [syncFolder, setSyncFolder] = useState(settings.syncFolder);
  const [settingsSyncFolder, setSettingsSyncFolder] = useState(settings.settingsSyncFolder);
  const [gpuAcceleration, setGpuAcceleration] = useState(settings.gpuAcceleration);
  const [devCommands, setDevCommands] = useState(() => devCommandsText(settings.devCommands));
  const [recentFolderLimit, setRecentFolderLimit] = useState(String(settings.recentFolderLimit));
  const [devFolderInFooter, setDevFolderInFooter] = useState(settings.devFolderInFooter);
  const [aiUsageInFooter, setAiUsageInFooter] = useState(settings.aiUsageInFooter);
  const [aiUsageProvider, setAiUsageProvider] = useState(settings.aiUsageProvider);
  const [sharing, setSharing] = useState<SharingValues>({
    shareRelayUrl: settings.shareRelayUrl,
    shareViewerOrigin: settings.shareViewerOrigin,
    shareViewNeedsApproval: settings.shareViewNeedsApproval,
    shareSudoReset: settings.shareSudoReset,
    shareBlockLid: settings.shareBlockLid,
    shareRecordInput: settings.shareRecordInput,
  });
  const [auditOpen, setAuditOpen] = useState(false);
  const [theme, setTheme] = useState(settings.theme);
  /** The scheme's accent, which the colour picker starts from while no colour is chosen. */
  const themeAccent = (themeById(theme).theme.blue ?? "#5ec4ff").slice(0, 7).toLowerCase();
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  /** The well-known monospaced fonts installed here, looked for once per dialog. */
  const installedFonts = useMemo(() => detectInstalledFonts(), []);
  const [remoteMonitor, setRemoteMonitor] = useState(settings.remoteMonitor);
  const [sshAutoReconnect, setSshAutoReconnect] = useState(settings.sshAutoReconnect);
  const [sidebarHideWhenCollapsed, setSidebarHideWhenCollapsed] = useState(settings.sidebarHideWhenCollapsed);
  const [sidebarAtStartup, setSidebarAtStartup] = useState(settings.sidebarAtStartup);
  const [devColumnHideWhenCollapsed, setDevColumnHideWhenCollapsed] = useState(settings.devColumnHideWhenCollapsed);
  const [devColumnAtStartup, setDevColumnAtStartup] = useState(settings.devColumnAtStartup);
  const [checkUpdates, setCheckUpdates] = useState(settings.checkUpdates);
  const [restoreTabs, setRestoreTabs] = useState(settings.restoreTabs);
  const [aiSaveChats, setAiSaveChats] = useState(settings.aiSaveChats);
  const [diagnosticLog, setDiagnosticLog] = useState(settings.diagnosticLog);
  const [diagnosticLogDir, setDiagnosticLogDir] = useState(settings.diagnosticLogDir);
  const [defaultLogDir, setDefaultLogDir] = useState<string | null>(null);
  useEffect(() => {
    void diagnosticLogDefaultDir().then(setDefaultLogDir);
  }, []);
  // The file the log goes to, as typed now; Windows paths keep their backslashes.
  const logDir = diagnosticLogDir.trim() || defaultLogDir;
  const logFile = logDir ? `${logDir.replace(/[\\/]+$/, "")}${logDir.includes("\\") ? "\\" : "/"}plexusterm.log` : null;
  const [updateState, setUpdateState] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "upToDate"; current: string }
    | { state: "available"; release: Release }
    | { state: "failed"; error: string }
  >({ state: "idle" });
  const checkNow = () => {
    setUpdateState({ state: "checking" });
    checkForUpdate()
      .then(({ current, latest }) =>
        setUpdateState(latest ? { state: "available", release: latest } : { state: "upToDate", current }),
      )
      .catch((error: string) => setUpdateState({ state: "failed", error }));
  };
  const [textEditor, setTextEditor] = useState(settings.textEditor);
  const [fileDetails, setFileDetails] = useState(settings.fileDetails);
  const [gitFileStatus, setGitFileStatus] = useState(settings.gitFileStatus);
  const [viewerAutoSave, setViewerAutoSave] = useState(settings.viewerAutoSave);
  const [viewerPosition, setViewerPosition] = useState(settings.viewerPosition);
  const [fileIconsList, setFileIconsList] = useState(settings.fileIconsList);
  const [fileIconsTree, setFileIconsTree] = useState(settings.fileIconsTree);
  const [terminalFollowsBrowser, setTerminalFollowsBrowser] = useState(settings.terminalFollowsBrowser);
  const [localShell, setLocalShell] = useState(settings.localShell);
  const [localShellArgs, setLocalShellArgs] = useState(settings.localShellArgs);
  const [localCwd, setLocalCwd] = useState(settings.localCwd);
  const [newTerminalFolder, setNewTerminalFolder] = useState(settings.newTerminalFolder);
  const [devNewTerminalFolder, setDevNewTerminalFolder] = useState(settings.devNewTerminalFolder);
  const [inlineSuggestions, setInlineSuggestions] = useState(settings.inlineSuggestions);
  const [history, setHistory] = useState(settings.commandHistory);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState(settings.aiSuggestions);
  const [aiProvider, setAiProvider] = useState<AiProvider>(settings.aiProvider);
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl);
  const [aiModel, setAiModel] = useState(settings.aiModel);
  const [aiHistoryContext, setAiHistoryContext] = useState(String(settings.aiHistoryContext));
  const [assistantShortcut, setAssistantShortcut] = useState(settings.assistantShortcut);
  const [shortcuts, setShortcuts] = useState(settings.shortcuts);
  const [section, setSection] = useState<Section>(initialSection ?? "general");
  /** The search box's text: while it has some, every section shows the options it finds. */
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const bodyRef = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState(true);
  // After every render, as options come and go with the values chosen (AI provider, ...).
  useLayoutEffect(() => {
    const panels = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(":scope > .settings__panel") ?? []);
    setFound(filterSettings(panels, query) > 0);
  });
  const dark = TERMINAL_THEMES.filter((scheme) => scheme.dark);
  const light = TERMINAL_THEMES.filter((scheme) => !scheme.dark);

  const browseTextEditor = async () => {
    try {
      const program = await open({
        title: t("settings.files.chooseEditor"),
        multiple: false,
        directory: false,
        defaultPath: programsDir(platform),
      });
      if (typeof program === "string") setTextEditor(program);
    } catch {
      // No file picker (e.g. outside Tauri): the field can still be typed.
    }
  };

  /** A model that is still some provider's default follows the provider. */
  const changeProvider = (value: string) => {
    if (!isAiProvider(value)) return;
    if (Object.values(DEFAULT_AI_MODELS).includes(aiModel.trim())) setAiModel(DEFAULT_AI_MODELS[value]);
    setAiProvider(value);
  };

  const clearHistory = () => {
    setHistoryNote(null);
    commandHistory
      .clear()
      .then(() => setHistoryNote(t("settings.ai.historyCleared")))
      .catch((err) => setHistoryNote(t("settings.ai.historyClearFailed", { error: String(err) })));
  };

  /** The settings as the fields show them now (an unreadable number keeps the saved value). */
  const draft = (): TerminalSettings => {
    const size = Number.parseFloat(fontSize);
    const uiSize = Number.parseFloat(uiFontSize);
    const chatSize = Number.parseFloat(chatFontSize);
    const viewerSize = Number.parseFloat(viewerFontSize);
    const recentLimit = Number.parseFloat(recentFolderLimit);
    const notifySeconds = Number.parseFloat(commandNotifySeconds);
    const context = Number.parseFloat(aiHistoryContext);
    return {
      fontSize: Number.isFinite(size) ? clampFontSize(size) : settings.fontSize,
      uiFontSize: Number.isFinite(uiSize) ? clampUiFontSize(uiSize) : settings.uiFontSize,
      toolbarIconsOnly,
      toolbarLayout,
      fontWeight,
      lineHeight,
      chatFontSize: Number.isFinite(chatSize) ? clampChatFontSize(chatSize) : settings.chatFontSize,
      viewerFontSize: Number.isFinite(viewerSize) ? clampViewerFontSize(viewerSize) : settings.viewerFontSize,
      focusBorderColor: cleanHexColor(focusBorderColor),
      focusBorderStrength: clampFocusBorderStrength(focusBorderStrength),
      paneFooterHeight: Number.isFinite(Number.parseFloat(paneFooterHeight))
        ? clampPaneFooterHeight(Number.parseFloat(paneFooterHeight))
        : settings.paneFooterHeight,
      copyOnSelect,
      rightClickPastes,
      confirmMultilinePaste,
      errorHighlight,
      shellIntegration,
      logTimestamps,
      syncFolder: syncFolder.trim(),
      settingsSyncFolder: settingsSyncFolder.trim(),
      theme,
      fontFamily: cleanFontFamily(fontFamily),
      remoteMonitor,
      sshAutoReconnect,
      textEditor: cleanTextEditor(textEditor),
      fileDetails,
      gitFileStatus,
      viewerAutoSave,
      viewerPosition,
      fileIconsList,
      fileIconsTree,
      // Set with the viewer's own button, not here.
      viewerChangedLines: settings.viewerChangedLines,
      terminalFollowsBrowser,
      inlineSuggestions,
      commandHistory: history,
      aiSuggestions,
      aiProvider,
      aiBaseUrl: cleanAiBaseUrl(aiBaseUrl),
      aiModel: cleanAiModel(aiModel, aiProvider),
      aiHistoryContext: Number.isFinite(context) ? clampAiHistoryContext(context) : settings.aiHistoryContext,
      assistantShortcut,
      sidebarCollapsed: settings.sidebarCollapsed,
      sidebarHideWhenCollapsed,
      sidebarAtStartup,
      localShell: cleanLocalShell(localShell),
      localShellArgs: cleanLocalShell(localShell) ? cleanLocalShell(localShellArgs) : "",
      localCwd: cleanLocalShell(localCwd),
      newTerminalFolder,
      devNewTerminalFolder,
      sidebarWidth: settings.sidebarWidth,
      tabColumnWidth: settings.tabColumnWidth,
      devColumnCollapsed: settings.devColumnCollapsed,
      devColumnHideWhenCollapsed,
      devColumnAtStartup,
      checkUpdates,
      restoreTabs,
      aiSaveChats,
      diagnosticLog,
      diagnosticLogDir: cleanLocalShell(diagnosticLogDir),
      language,
      shortcuts,
      shiftEnterNewline,
      attentionNotifications,
      // Rules left without an expression are dropped.
      highlightRules: parseHighlightRules(highlightRules),
      commandNotifySeconds: Number.isFinite(notifySeconds)
        ? clampCommandNotifySeconds(notifySeconds)
        : settings.commandNotifySeconds,
      gpuAcceleration,
      devCommands: parseDevCommands(devCommands),
      recentFolderLimit: Number.isFinite(recentLimit) ? clampRecentFolderLimit(recentLimit) : settings.recentFolderLimit,
      devFolderInFooter,
      aiUsageInFooter,
      aiUsageProvider,
      ...sharing,
      shareRelayUrl: cleanShareUrl(sharing.shareRelayUrl, ["wss", "ws"]),
      shareViewerOrigin: cleanShareUrl(sharing.shareViewerOrigin, ["https", "http"]),
    };
  };

  // Every change is applied by itself, without a Save button: a moment after the last edit (so a
  // number or a path being typed is not applied at each key), and at once when the dialog closes.
  const next = draft();
  const nextKey = JSON.stringify(next);
  // What the fields showed when the dialog opened counts as saved: opening it changes nothing.
  const saved = useRef<string | null>(null);
  if (saved.current === null) saved.current = nextKey;
  const pending = useRef<{ key: string; value: TerminalSettings } | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const flush = () => {
    const change = pending.current;
    pending.current = null;
    if (!change || change.key === saved.current) return;
    saved.current = change.key;
    onSaveRef.current(change.value);
  };
  useEffect(() => {
    if (nextKey === saved.current) {
      pending.current = null;
      return;
    }
    pending.current = { key: nextKey, value: next };
    const timer = setTimeout(flush, AUTO_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `next` is described by `nextKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextKey]);
  // Closed some other way (the app closing it): what was edited is still applied.
  useEffect(() => () => flush(), []);
  const close = () => {
    flush();
    onCancel();
  };

  // Sentences with markup inside: the placeholder marks where the code or the link goes.
  const [editorHelpBefore, editorHelpAfter = ""] = t("settings.files.textEditorHelp").split("{command}");
  const [creditsBefore, creditsAfter = ""] = t("settings.about.credits").split("{notices}");

  // The help texts name the shortcuts as they are set now.
  const fontShortcuts = (["fontIncrease", "fontDecrease", "fontReset"] as const)
    .map((action) => shortcutLabel(action, shortcuts))
    .filter(Boolean)
    .join(" / ");
  const sidebarShortcut = shortcutLabel("toggleSidebar", shortcuts);
  const devColumnShortcut = shortcutLabel("toggleDevColumn", shortcuts);

  const panel = (id: Section) => ({
    role: "tabpanel" as const,
    id: `settings-panel-${id}`,
    "aria-label": sectionLabel(id),
    hidden: !searching && section !== id,
    className: "settings__panel",
  });

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && close()}>
      <form className="dialog settings" onSubmit={(e) => e.preventDefault()} aria-labelledby="settings-title" noValidate>
        <div className="settings__head">
          <h2 id="settings-title">{t("settings.dialog.title")}</h2>
          <label className="settings__search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              autoFocus
              value={query}
              placeholder={t("settings.search.placeholder")}
              aria-label={t("settings.search.label")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape empties the search first; with nothing to empty it closes the dialog.
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </label>
        </div>
        <div ref={bodyRef} className={`settings__body${searching ? " settings__body--searching" : ""}`}>
          {searching && !found && <p className="muted settings__no-results">{t("settings.search.noResults", { query: query.trim() })}</p>}
          <nav className="settings__nav" role="tablist" aria-orientation="vertical" aria-label={t("settings.dialog.sections")}>
            {SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={section === id}
                aria-controls={`settings-panel-${id}`}
                className={`settings__tab${section === id ? " settings__tab--active" : ""}`}
                onClick={() => setSection(id)}
              >
                <Icon size={15} />
                {sectionLabel(id)}
              </button>
            ))}
          </nav>

          <div {...panel("general")}>
            <h3 className="settings__group">{t("settings.groups.language")}</h3>
            <div className="field">
              <label htmlFor="settings-language">{t("settings.language.label")}</label>
              <div className="form-row">
                <select
                  id="settings-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as LanguageSetting)}
                >
                  <option value="system">{t("settings.language.system")}</option>
                  {LOCALES.map((l) => (
                    <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {/* Never translated and applied at once: a way back from a language you cannot read. */}
                <button type="button" className="btn btn--icon" lang="en" dir="ltr" onClick={() => languageNow("system")}>
                  <Globe size={14} />
                  System language
                </button>
                <button type="button" className="btn btn--icon" lang="en" dir="ltr" onClick={() => languageNow("en")}>
                  <Globe size={14} />
                  English
                </button>
              </div>
            </div>
            <h3 className="settings__group">{t("settings.groups.startup")}</h3>
            <label className="field">
              {t("settings.appearance.sidebarAtStartup")}
              <select value={sidebarAtStartup} onChange={(e) => setSidebarAtStartup(e.target.value as SidebarAtStartup)}>
                <option value="last">{t("settings.appearance.sidebarLast")}</option>
                <option value="expanded">{t("settings.appearance.sidebarExpanded")}</option>
                <option value="collapsed">{t("settings.appearance.sidebarCollapsed")}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={restoreTabs} onChange={(e) => setRestoreTabs(e.target.checked)} />
              <span className="setting-title">
                {t("settings.general.restoreTabs")} <HelpTip text={t("settings.general.restoreTabsHelp")} />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={checkUpdates} onChange={(e) => setCheckUpdates(e.target.checked)} />
              <span className="setting-title">
                {t("settings.about.checkAtStartup")} <HelpTip text={t("settings.about.checkHelp")} />
              </span>
            </label>
          </div>

          <div {...panel("toolbar")}>
            <ToolbarEditor layout={toolbarLayout} onChange={setToolbarLayout} />
          </div>

          <div {...panel("appearance")}>
            <h3 className="settings__group">{t("settings.groups.colours")}</h3>
            <label className="field">
              {t("settings.appearance.colourScheme")}
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <optgroup label={t("settings.appearance.dark")}>
                  {dark.map((scheme) => (
                    <option key={scheme.id} value={scheme.id}>
                      {scheme.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("settings.appearance.light")}>
                  {light.map((scheme) => (
                    <option key={scheme.id} value={scheme.id}>
                      {scheme.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <ThemePreview entry={themeById(theme)} fontFamily={cleanFontFamily(fontFamily)} />
            <h3 className="settings__group">{t("settings.groups.terminalFont")}</h3>
            <label className="field">
              {t("settings.appearance.font")}
              <select value={catalogChoice(fontFamily, installedFonts)} onChange={(e) => e.target.value && setFontFamily(e.target.value)}>
                <option value={DEFAULT_FONT_FAMILY}>{t("settings.appearance.fontDefault")}</option>
                <optgroup label={t("settings.appearance.fontsBundled")}>
                  {BUNDLED_FONTS.map((font) => (
                    <option key={font.family} value={font.family}>
                      {font.name}
                    </option>
                  ))}
                </optgroup>
                {installedFonts.length > 0 && (
                  <optgroup label={t("settings.appearance.fontsInstalled")}>
                    {installedFonts.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="" disabled>
                  {t("settings.appearance.fontCustom")}
                </option>
              </select>
            </label>
            <label className="field">
              {t("settings.appearance.fontFamily")}
              <input
                value={fontFamily}
                maxLength={MAX_FONT_FAMILY_LENGTH}
                spellCheck={false}
                onChange={(e) => setFontFamily(e.target.value)}
              />
            </label>
            <label className="field field--size">
              {t("settings.appearance.fontWeight")}
              <select value={fontWeight} onChange={(e) => setFontWeight(Number(e.target.value))}>
                {FONT_WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {t(WEIGHT_NAMES[weight])}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.lineHeight")} <HelpTip text={t("settings.appearance.lineHeightHelp")} />
              </span>
              <select value={lineHeight} onChange={(e) => setLineHeight(Number(e.target.value))}>
                {LINE_HEIGHTS.map((height) => (
                  <option key={height} value={height}>
                    {height === 1 ? "1.0" : height}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.fontSize")} <HelpTip text={fontShortcuts ? t("settings.appearance.fontHelp", { shortcuts: fontShortcuts }) : t("settings.appearance.fontHelpNoShortcut")} />
              </span>
              <input
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                autoFocus
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
              />
            </label>
            <h3 className="settings__group">{t("settings.groups.textSizes")}</h3>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.uiFontSize")} <HelpTip text={t("settings.appearance.uiFontSizeHelp")} />
              </span>
              <input
                type="number"
                min={MIN_UI_FONT_SIZE}
                max={MAX_UI_FONT_SIZE}
                value={uiFontSize}
                onChange={(e) => setUiFontSize(e.target.value)}
              />
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.chatFontSize")} <HelpTip text={fontShortcuts ? t("settings.appearance.chatFontSizeHelp", { shortcuts: fontShortcuts }) : t("settings.appearance.chatFontSizeHelpNoShortcut")} />
              </span>
              <input
                type="number"
                min={MIN_CHAT_FONT_SIZE}
                max={MAX_CHAT_FONT_SIZE}
                value={chatFontSize}
                onChange={(e) => setChatFontSize(e.target.value)}
              />
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.viewerFontSize")} <HelpTip text={t("settings.appearance.viewerFontSizeHelp")} />
              </span>
              <input
                type="number"
                min={MIN_VIEWER_FONT_SIZE}
                max={MAX_VIEWER_FONT_SIZE}
                value={viewerFontSize}
                onChange={(e) => setViewerFontSize(e.target.value)}
              />
            </label>
            <h3 className="settings__group">{t("settings.groups.layout")}</h3>
            <label className="check">
              <input type="checkbox" checked={toolbarIconsOnly} onChange={(e) => setToolbarIconsOnly(e.target.checked)} />
              <span>{t("settings.appearance.toolbarIconsOnly")}</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={sidebarHideWhenCollapsed}
                onChange={(e) => setSidebarHideWhenCollapsed(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.appearance.hideSidebar")} <HelpTip text={sidebarShortcut ? t("settings.appearance.sidebarHelp", { shortcut: sidebarShortcut }) : t("settings.appearance.sidebarHelpNoShortcut")} />
              </span>
            </label>
            <div className="field">
              <span className="setting-title">
                {t("settings.appearance.focusBorder")} <HelpTip text={t("settings.appearance.focusBorderHelp")} />
              </span>
              <div className="form-row focus-border">
                <input
                  type="color"
                  aria-label={t("settings.appearance.focusBorderColor")}
                  title={t("settings.appearance.focusBorderColor")}
                  value={focusBorderColor || themeAccent}
                  onChange={(e) => setFocusBorderColor(e.target.value.toLowerCase())}
                />
                <button type="button" className="btn" disabled={!focusBorderColor} onClick={() => setFocusBorderColor("")}>
                  {t("settings.appearance.focusBorderAccent")}
                </button>
                <span
                  className="focus-border__preview"
                  aria-hidden="true"
                  style={{ borderColor: focusBorderCss(focusBorderColor, focusBorderStrength) }}
                />
              </div>
              <label className="focus-border__strength">
                {t("settings.appearance.focusBorderStrength", { value: focusBorderStrength })}
                <input
                  type="range"
                  min={MIN_FOCUS_BORDER_STRENGTH}
                  max={MAX_FOCUS_BORDER_STRENGTH}
                  step={5}
                  value={focusBorderStrength}
                  onChange={(e) => setFocusBorderStrength(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.appearance.paneFooterHeight")} <HelpTip text={t("settings.appearance.paneFooterHeightHelp")} />
              </span>
              <input
                type="number"
                min={MIN_PANE_FOOTER_HEIGHT}
                max={MAX_PANE_FOOTER_HEIGHT}
                step={1}
                value={paneFooterHeight}
                onChange={(e) => setPaneFooterHeight(e.target.value)}
              />
            </label>
          </div>

          <div {...panel("terminal")}>
            <h3 className="settings__group">{t("settings.groups.session")}</h3>
            <ShellPicker
              id="settings-local-shell"
              label={t("settings.terminal.shell")}
              help={t("settings.terminal.shellHelp")}
              program={localShell}
              args={localShellArgs}
              onChange={(program, args) => {
                setLocalShell(program);
                setLocalShellArgs(args);
              }}
            />
            <div className="field">
              <label htmlFor="settings-local-cwd">{t("settings.terminal.startDir")}</label>
              <div className="form-row field__picker">
                <input
                  id="settings-local-cwd"
                  value={localCwd}
                  placeholder={t("sessions.edit.startDirPlaceholder")}
                  spellCheck={false}
                  onChange={(e) => setLocalCwd(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  aria-label={t("sessions.edit.chooseStartDir")}
                  onClick={() =>
                    void open({ title: t("sessions.edit.chooseStartDir"), multiple: false, directory: true })
                      .then((dir) => typeof dir === "string" && setLocalCwd(dir))
                      .catch(() => {})
                  }
                >
                  {t("common.browse")}
                </button>
              </div>
            </div>
            <label className="field">
              {t("settings.terminal.newTerminalFolder")}
              <select value={newTerminalFolder} onChange={(e) => setNewTerminalFolder(e.target.value as NewTerminalFolder)}>
                <option value="start">{t("settings.terminal.newTerminalStart")}</option>
                <option value="terminal">{t("settings.terminal.newTerminalHere")}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={shellIntegration} onChange={(e) => setShellIntegration(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.shellIntegration")} <HelpTip text={t("settings.terminal.shellIntegrationHelp")} />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={logTimestamps} onChange={(e) => setLogTimestamps(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.logTimestamps")} <HelpTip text={t("settings.terminal.logTimestampsHelp")} />
              </span>
            </label>
            <h3 className="settings__group">{t("settings.groups.input")}</h3>
            <label className="check">
              <input type="checkbox" checked={copyOnSelect} onChange={(e) => setCopyOnSelect(e.target.checked)} />
              {t("settings.terminal.copyOnSelect")}
            </label>
            <label className="check">
              <input type="checkbox" checked={rightClickPastes} onChange={(e) => setRightClickPastes(e.target.checked)} />
              {t("settings.terminal.rightClickPastes")}
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmMultilinePaste}
                onChange={(e) => setConfirmMultilinePaste(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.terminal.confirmMultilinePaste")} <HelpTip text={t("settings.terminal.rightClickHelp")} />
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={shiftEnterNewline}
                onChange={(e) => setShiftEnterNewline(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.terminal.shiftEnterNewline")} <HelpTip text={t("settings.terminal.shiftEnterNewlineHelp")} />
              </span>
            </label>
            <h3 className="settings__group">{t("settings.groups.display")}</h3>
            <label className="check">
              <input type="checkbox" checked={errorHighlight} onChange={(e) => setErrorHighlight(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.errorHighlight")} <HelpTip text={t("settings.terminal.errorHighlightHelp")} />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={gpuAcceleration} onChange={(e) => setGpuAcceleration(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.gpuAcceleration")} <HelpTip text={t("settings.terminal.gpuAccelerationHelp")} />
              </span>
            </label>
            <h3 className="settings__group">{t("settings.groups.notifications")}</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={attentionNotifications}
                onChange={(e) => setAttentionNotifications(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.terminal.attentionNotifications")} <HelpTip text={t("settings.terminal.attentionNotificationsHelp")} />
              </span>
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.terminal.commandNotifySeconds")} <HelpTip text={t("settings.terminal.commandNotifySecondsHelp")} />
              </span>
              <input
                type="number"
                min={0}
                max={MAX_COMMAND_NOTIFY_SECONDS}
                value={commandNotifySeconds}
                onChange={(e) => setCommandNotifySeconds(e.target.value)}
              />
            </label>
            <h3 className="settings__group">{t("settings.groups.highlightRules")}</h3>
            <HighlightRulesEditor rules={highlightRules} onChange={setHighlightRules} macros={macros} />
          </div>

          <div {...panel("dev")}>
            <h3 className="settings__group">{t("settings.groups.devCommands")}</h3>
            <div className="field">
              <label htmlFor="settings-dev-commands"><span className="setting-title">{t("settings.terminal.devCommands")} <HelpTip text={t("settings.terminal.devCommandsHelp")} /></span></label>
              <input
                id="settings-dev-commands"
                value={devCommands}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(e) => setDevCommands(e.target.value)}
              />
            </div>
            <label className="field">
              {t("settings.terminal.devNewTerminalFolder")}
              <select value={devNewTerminalFolder} onChange={(e) => setDevNewTerminalFolder(e.target.value as NewTerminalFolder)}>
                <option value="start">{t("settings.terminal.newTerminalStart")}</option>
                <option value="terminal">{t("settings.terminal.newTerminalHere")}</option>
              </select>
            </label>
            <label className="field field--size">
              <span className="setting-title">
                {t("settings.terminal.recentFolderLimit")} <HelpTip text={t("settings.terminal.recentFolderLimitHelp")} />
              </span>
              <input
                type="number"
                min={1}
                max={MAX_RECENT_FOLDERS}
                value={recentFolderLimit}
                onChange={(e) => setRecentFolderLimit(e.target.value)}
              />
            </label>
            <h3 className="settings__group">{t("settings.groups.devColumn")}</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={devColumnHideWhenCollapsed}
                onChange={(e) => setDevColumnHideWhenCollapsed(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.appearance.hideDevColumn")} <HelpTip text={devColumnShortcut ? t("settings.appearance.devColumnHelp", { shortcut: devColumnShortcut }) : t("settings.appearance.devColumnHelpNoShortcut")} />
              </span>
            </label>
            <label className="field">
              {t("settings.appearance.devColumnAtStartup")}
              <select value={devColumnAtStartup} onChange={(e) => setDevColumnAtStartup(e.target.value as SidebarAtStartup)}>
                <option value="last">{t("settings.appearance.sidebarLast")}</option>
                <option value="expanded">{t("settings.appearance.sidebarExpanded")}</option>
                <option value="collapsed">{t("settings.appearance.sidebarCollapsed")}</option>
              </select>
            </label>
            <h3 className="settings__group">{t("settings.groups.bar")}</h3>
            <label className="check">
              <input type="checkbox" checked={devFolderInFooter} onChange={(e) => setDevFolderInFooter(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.devFolderInFooter")} <HelpTip text={t("settings.terminal.devFolderInFooterHelp")} />
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={aiUsageInFooter} onChange={(e) => setAiUsageInFooter(e.target.checked)} />
              <span className="setting-title">
                {t("settings.terminal.aiUsageInFooter")} <HelpTip text={t("settings.terminal.aiUsageInFooterHelp")} />
              </span>
            </label>
            <label className="field">
              {t("settings.terminal.aiUsageProvider")}
              <select
                value={aiUsageProvider}
                disabled={!aiUsageInFooter}
                onChange={(e) => setAiUsageProvider(e.target.value as AiUsageChoice)}
              >
                <option value="auto">{t("settings.terminal.aiUsageAuto")}</option>
                <option value="claude">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="agy">Antigravity</option>
                <option value="opencodeGo">OpenCode Go</option>
                <option value="off">{t("app.usage.off")}</option>
              </select>
            </label>
            {aiUsageInFooter && <ApiKeyField provider="opencode-go" usage />}
          </div>

          <div {...panel("ssh")}>
            <label className="check">
              <input type="checkbox" checked={remoteMonitor} onChange={(e) => setRemoteMonitor(e.target.checked)} />
              <span className="setting-title">
                {t("settings.ssh.remoteMonitor")} <HelpTip text={t("settings.ssh.remoteMonitorHelp")} />
              </span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={sshAutoReconnect}
                onChange={(e) => setSshAutoReconnect(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.ssh.autoReconnect")} <HelpTip text={t("settings.ssh.autoReconnectHelp")} />
              </span>
            </label>
            <h3 className="settings__group">{t("settings.groups.sessionSync")}</h3>
            <div className="field">
              <label htmlFor="settings-sync-folder">
                <span className="setting-title">
                  {t("settings.ssh.syncFolder")} <HelpTip text={t("settings.ssh.syncFolderHelp")} />
                </span>
              </label>
              <div className="form-row field__picker">
                <input
                  id="settings-sync-folder"
                  value={syncFolder}
                  placeholder={t("settings.ssh.syncFolderPlaceholder")}
                  spellCheck={false}
                  onChange={(e) => setSyncFolder(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  aria-label={t("settings.ssh.chooseSyncFolder")}
                  onClick={() =>
                    void open({ title: t("settings.ssh.chooseSyncFolder"), multiple: false, directory: true })
                      .then((dir) => typeof dir === "string" && setSyncFolder(dir))
                      .catch(() => {})
                  }
                >
                  {t("common.browse")}
                </button>
              </div>
              {syncStatus && syncFolder.trim() === settings.syncFolder && syncFolder.trim() !== "" && (
                <span className={syncStatus.state === "error" ? "form-error" : "muted"} role="status">
                  {syncStatus.state === "synced"
                    ? t("settings.ssh.syncedAt", { time: new Date(syncStatus.at).toLocaleTimeString() })
                    : syncStatus.state === "error"
                      ? syncStatus.foreign
                        ? t("settings.ssh.syncForeign")
                        : t("settings.ssh.syncError", { error: syncStatus.message })
                      : t("settings.ssh.syncing")}
                </span>
              )}
            </div>
            <h3 className="settings__group">{t("settings.groups.settingsSync")}</h3>
            <div className="field">
              <label htmlFor="settings-settings-sync-folder">
                <span className="setting-title">
                  {t("settings.ssh.settingsSyncFolder")} <HelpTip text={t("settings.ssh.settingsSyncFolderHelp")} />
                </span>
              </label>
              <div className="form-row field__picker">
                <input
                  id="settings-settings-sync-folder"
                  value={settingsSyncFolder}
                  placeholder={t("settings.ssh.settingsSyncFolderPlaceholder")}
                  spellCheck={false}
                  onChange={(e) => setSettingsSyncFolder(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  aria-label={t("settings.ssh.chooseSettingsSyncFolder")}
                  onClick={() =>
                    void open({ title: t("settings.ssh.chooseSettingsSyncFolder"), multiple: false, directory: true })
                      .then((dir) => typeof dir === "string" && setSettingsSyncFolder(dir))
                      .catch(() => {})
                  }
                >
                  {t("common.browse")}
                </button>
              </div>
              {settingsSyncStatus &&
                settingsSyncFolder.trim() === settings.settingsSyncFolder &&
                settingsSyncFolder.trim() !== "" && (
                  <span className={settingsSyncStatus.state === "error" ? "form-error" : "muted"} role="status">
                    {settingsSyncStatus.state === "synced"
                      ? t("settings.ssh.syncedAt", { time: new Date(settingsSyncStatus.at).toLocaleTimeString() })
                      : settingsSyncStatus.state === "error"
                        ? settingsSyncStatus.foreign
                          ? t("settings.ssh.syncSettingsForeign")
                          : t("settings.ssh.syncError", { error: settingsSyncStatus.message })
                        : t("settings.ssh.syncing")}
                  </span>
                )}
            </div>
          </div>

          <div {...panel("files")}>
            <h3 className="settings__group">{t("settings.groups.fileLists")}</h3>
            <label className="check">
              <input type="checkbox" checked={fileDetails} onChange={(e) => setFileDetails(e.target.checked)} />
              {t("settings.files.details")}
            </label>
            <label className="check">
              <input type="checkbox" checked={gitFileStatus} onChange={(e) => setGitFileStatus(e.target.checked)} />
              <span className="setting-title">
                {t("settings.files.gitStatus")} <HelpTip text={t("settings.files.gitStatusHelp")} />
              </span>
            </label>
            <label className="field">
              {t("settings.files.iconsList")}
              <select value={fileIconsList} onChange={(e) => isIconPack(e.target.value) && setFileIconsList(e.target.value)}>
                {ICON_PACKS.map((pack) => (
                  <option key={pack} value={pack}>
                    {t(`settings.files.iconPack.${pack}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="setting-title">
                {t("settings.files.iconsTree")} <HelpTip text={t("settings.files.iconsHelp")} />
              </span>
              <select value={fileIconsTree} onChange={(e) => isIconPack(e.target.value) && setFileIconsTree(e.target.value)}>
                {ICON_PACKS.map((pack) => (
                  <option key={pack} value={pack}>
                    {t(`settings.files.iconPack.${pack}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={terminalFollowsBrowser}
                onChange={(e) => setTerminalFollowsBrowser(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.files.terminalFollows")} <HelpTip text={t("settings.files.terminalFollowsHelp")} />
              </span>
            </label>
            <h3 className="settings__group">{t("settings.groups.viewer")}</h3>
            <label className="field">
              {t("settings.files.viewerPosition")}
              <select value={viewerPosition} onChange={(e) => setViewerPosition(e.target.value as ViewerPosition)}>
                <option value="left">{t("settings.files.viewerLeft")}</option>
                <option value="right">{t("settings.files.viewerRight")}</option>
                <option value="below">{t("settings.files.viewerBelow")}</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={viewerAutoSave} onChange={(e) => setViewerAutoSave(e.target.checked)} />
              <span className="setting-title">
                {t("settings.files.autoSave")} <HelpTip text={t("settings.files.autoSaveHelp")} />
              </span>
            </label>
            <div className="field">
              <label htmlFor="settings-text-editor"><span className="setting-title">{t("settings.files.textEditor")} <HelpTip text={`${editorHelpBefore}code --wait${editorHelpAfter}`} /></span></label>
              <div className="form-row field__picker">
                <input
                  id="settings-text-editor"
                  value={textEditor}
                  placeholder={t("settings.files.systemDefault")}
                  maxLength={MAX_TEXT_EDITOR_LENGTH}
                  spellCheck={false}
                  onChange={(e) => setTextEditor(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => void browseTextEditor()}>
                  {t("common.browse")}
                </button>
                <button type="button" className="btn" disabled={!textEditor} onClick={() => setTextEditor("")}>
                  {t("settings.files.useSystemDefault")}
                </button>
              </div>
            </div>
          </div>

          <div {...panel("ai")}>
            <h3 className="settings__group">{t("settings.groups.suggestions")}</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={inlineSuggestions}
                onChange={(e) => setInlineSuggestions(e.target.checked)}
              />
              <span className="setting-title">
                {t("settings.ai.inlineSuggestions")} <HelpTip text={t("settings.ai.inlineSuggestionsHelp")} />
              </span>
            </label>
            <div className="form-row">
              <label className="check">
                <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
                <span className="setting-title">
                  {t("settings.ai.commandHistory")} <HelpTip text={t("settings.ai.historyHelp")} />
                </span>
              </label>
              <button type="button" className="btn" onClick={clearHistory}>
                {t("settings.ai.clearHistory")}
              </button>
            </div>
            {historyNote && <p className="muted">{historyNote}</p>}
            <label className="check">
              <input type="checkbox" checked={aiSuggestions} onChange={(e) => setAiSuggestions(e.target.checked)} />
              <span className="setting-title">
                {t("settings.ai.aiSuggestions")} <HelpTip text={t("settings.ai.aiSuggestionsHelp")} />
              </span>
            </label>
            <label className="field field--number">
              {t("settings.ai.historyContext")}
              <input
                type="number"
                min={0}
                max={MAX_AI_HISTORY_CONTEXT}
                value={aiHistoryContext}
                onChange={(e) => setAiHistoryContext(e.target.value)}
              />
            </label>
            <h3 className="settings__group">{t("settings.groups.provider")}</h3>
            <label className="field">
              {t("settings.ai.provider")}
              <select value={aiProvider} onChange={(e) => changeProvider(e.target.value)}>
                {AI_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {aiProviderLabel(id)}
                  </option>
                ))}
              </select>
            </label>
            {aiProvider === "opencode-go" && (
              <p className="muted">{t("settings.ai.openCodeGoNote")}</p>
            )}
            {aiProvider === "openai-compatible" && (
              <label className="field">
                {t("settings.ai.baseUrl")}
                <input
                  value={aiBaseUrl}
                  placeholder="http://localhost:11434/v1"
                  maxLength={MAX_AI_BASE_URL_LENGTH}
                  spellCheck={false}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                />
              </label>
            )}
            {aiProvider === "opencode-go" ? (
              <OpenCodeModelField value={aiModel} onChange={setAiModel} />
            ) : (
              <label className="field">
                {t("settings.ai.model")}
                <input
                  value={aiModel}
                  maxLength={MAX_AI_MODEL_LENGTH}
                  spellCheck={false}
                  onChange={(e) => setAiModel(e.target.value)}
                />
              </label>
            )}
            <ApiKeyField provider={aiProvider} />
            <h3 className="settings__group">{t("settings.groups.chat")}</h3>
            <label className="check">
              <input type="checkbox" checked={aiSaveChats} onChange={(e) => setAiSaveChats(e.target.checked)} />
              <span className="setting-title">
                {t("settings.ai.saveChats")} <HelpTip text={t("settings.ai.saveChatsHelp")} />
              </span>
            </label>
          </div>

          <div {...panel("sharing")}>
            <SharingSettings
              values={sharing}
              onChange={(change) => setSharing((current) => ({ ...current, ...change }))}
              linux={platform === "linux"}
              onAuditLog={() => setAuditOpen(true)}
            />
          </div>

          <div {...panel("shortcuts")}>
            <ShortcutsPanel
              overrides={shortcuts}
              assistantShortcut={assistantShortcut}
              onChange={setShortcuts}
              onAssistantChange={setAssistantShortcut}
            />
          </div>

          <div {...panel("about")}>
            <div className="settings__about">
              <img
                className="settings__logo"
                src={themeById(settings.theme).dark ? wordmarkUrl : wordmarkLightUrl}
                alt="PlexusTerm"
              />
              <p>{t("settings.about.version", { version: APP_VERSION })}</p>
              <p className="muted">{t("settings.about.description")}</p>
              <div className="settings__updates">
                <button type="button" className="btn" disabled={updateState.state === "checking"} onClick={checkNow}>
                  {t("settings.about.checkUpdates")}
                </button>
                <UpdateActions release={updateState.state === "available" ? updateState.release : undefined} />
              </div>
              {updateState.state !== "idle" && (
                <p role="status">
                  {updateState.state === "checking"
                    ? t("settings.about.checking")
                    : updateState.state === "upToDate"
                      ? t("settings.about.upToDate", { version: updateState.current })
                      : updateState.state === "available"
                        ? t("settings.about.available", { version: updateState.release.version })
                        : t("settings.about.checkFailed", { error: updateState.error })}
                </p>
              )}
              <div className="settings__updates">
                <button type="button" className="btn" onClick={(e) => openLink(e, BUG_REPORT_URL)}>
                  {t("settings.about.reportProblem")}
                </button>
                <button type="button" className="btn" onClick={(e) => openLink(e, FEATURE_REQUEST_URL)}>
                  {t("settings.about.suggestImprovement")}
                </button>
                <HelpTip text={t("settings.about.feedbackHelp")} />
              </div>
              <label className="check">
                <input type="checkbox" checked={diagnosticLog} onChange={(e) => setDiagnosticLog(e.target.checked)} />
                {t("settings.about.diagnosticLog")}
              </label>
              <div className="field">
                <label htmlFor="settings-log-dir"><span className="setting-title">{t("settings.about.diagnosticLogDir")} <HelpTip text={t("settings.about.diagnosticLogHelp")} /></span></label>
                <div className="form-row field__picker">
                  <input
                    id="settings-log-dir"
                    value={diagnosticLogDir}
                    placeholder={defaultLogDir ?? ""}
                    spellCheck={false}
                    disabled={!diagnosticLog}
                    onChange={(e) => setDiagnosticLogDir(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    aria-label={t("settings.about.chooseLogDir")}
                    disabled={!diagnosticLog}
                    onClick={() =>
                      void open({ title: t("settings.about.chooseLogDir"), multiple: false, directory: true })
                        .then((dir) => typeof dir === "string" && setDiagnosticLogDir(dir))
                        .catch(() => {})
                    }
                  >
                    {t("common.browse")}
                  </button>
                </div>
              </div>
              {logFile && <p className="settings__log-file">{t("settings.about.diagnosticLogFile", { path: logFile })}</p>}
              <p>
                <a href={REPO_URL} onClick={(e) => openLink(e, REPO_URL)}>
                  github.com/jorgealonsodev/PlexusTerm
                </a>
              </p>
              <p className="muted">
                {creditsBefore}
                <a href={NOTICES_URL} onClick={(e) => openLink(e, NOTICES_URL)}>
                  {t("settings.about.notices")}
                </a>
                {creditsAfter}
              </p>
              <p className="muted">{t("settings.about.iconCredits")}</p>
              <p>
                <button type="button" className="btn" onClick={() => setLicensesOpen(true)}>
                  {t("settings.about.licenses")}
                </button>
              </p>
              {licensesOpen && (
                <LicensesDialog onClose={() => setLicensesOpen(false)} onOpenLink={(url) => void openUrl(url).catch(() => {})} />
              )}
            </div>
          </div>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn btn--primary" onClick={close}>
            {t("common.close")}
          </button>
        </div>
      </form>
      {auditOpen && <AuditLogDialog onClose={() => setAuditOpen(false)} />}
    </div>
  );
}
