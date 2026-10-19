import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { LicensesDialog } from "../licenses/LicensesDialog";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileText, Globe, Info, KeyRound, Keyboard, Palette, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import { LOCALES, t as translate, useT, type LanguageSetting } from "../../i18n/i18n";
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
import { TERMINAL_THEMES, themeById, type TerminalThemeEntry } from "../terminal/themes";
import {
  cleanLocalShell,
  clampAiHistoryContext,
  clampFontSize,
  clampChatFontSize,
  clampUiFontSize,
  MIN_UI_FONT_SIZE,
  MAX_UI_FONT_SIZE,
  MIN_CHAT_FONT_SIZE,
  MAX_CHAT_FONT_SIZE,
  cleanAiBaseUrl,
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
  type AiProvider,
  type TerminalSettings, type SidebarAtStartup } from "./settings";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { shortcutLabel } from "../panes/shortcuts";
import { devCommandsText, parseDevCommands } from "../devmode/devMode";
import { BUNDLED_FONTS, catalogChoice, detectInstalledFonts } from "./fontCatalog";

interface SettingsDialogProps {
  settings: TerminalSettings;
  onSave: (settings: TerminalSettings) => void;
  onCancel: () => void;
  /** Section shown first (Appearance when omitted). */
  initialSection?: SettingsSection;
  /** Applies and saves a language at once (the rescue buttons, S3). */
  onLanguageNow?: (language: LanguageSetting) => void;
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

export type SettingsSection = "appearance" | "terminal" | "shortcuts" | "ssh" | "files" | "ai" | "about";
type Section = SettingsSection;

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: "appearance", icon: Palette },
  { id: "terminal", icon: SquareTerminal },
  { id: "shortcuts", icon: Keyboard },
  { id: "ssh", icon: KeyRound },
  { id: "files", icon: FileText },
  { id: "ai", icon: Sparkles },
  { id: "about", icon: Info },
];

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
 * Saving and removing apply at once, not on Save.
 */
function ApiKeyField({ provider }: { provider: AiProvider }) {
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
      .then(() => invoke<boolean>("ai_key_status", { provider }))
      .then((saved) => current && setStatus(saved ? "saved" : "none"))
      .catch(() => current && setStatus("unavailable"));
    return () => {
      current = false;
    };
  }, [provider]);

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
      <label htmlFor="settings-ai-key">{t("settings.ai.apiKey")}</label>
      <div className="form-row field__picker">
        <input
          id="settings-ai-key"
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
          onClick={() => run(() => invoke("ai_key_save", { provider, key: key.trim() }), "saved", "saveKeyFailed")}
        >
          {t("settings.ai.saveKey")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || status !== "saved"}
          onClick={() => run(() => invoke("ai_key_delete", { provider }), "none", "removeKeyFailed")}
        >
          {t("settings.ai.removeKey")}
        </button>
      </div>
      <span className="muted">{label[status]}</span>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

const APP_VERSION = packageJson.version;
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
export function SettingsDialog({ settings, onSave, onCancel, initialSection, onLanguageNow }: SettingsDialogProps) {
  const [licensesOpen, setLicensesOpen] = useState(false);
  const t = useT();
  const platform = usePlatform();
  const [language, setLanguage] = useState<LanguageSetting>(settings.language);
  const languageNow = (next: LanguageSetting) => {
    setLanguage(next);
    onLanguageNow?.(next);
  };
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [uiFontSize, setUiFontSize] = useState(String(settings.uiFontSize));
  const [chatFontSize, setChatFontSize] = useState(String(settings.chatFontSize));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);
  const [errorHighlight, setErrorHighlight] = useState(settings.errorHighlight);
  const [shiftEnterNewline, setShiftEnterNewline] = useState(settings.shiftEnterNewline);
  const [attentionNotifications, setAttentionNotifications] = useState(settings.attentionNotifications);
  const [gpuAcceleration, setGpuAcceleration] = useState(settings.gpuAcceleration);
  const [devCommands, setDevCommands] = useState(() => devCommandsText(settings.devCommands));
  const [theme, setTheme] = useState(settings.theme);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  /** The well-known monospaced fonts installed here, looked for once per dialog. */
  const installedFonts = useMemo(() => detectInstalledFonts(), []);
  const [remoteMonitor, setRemoteMonitor] = useState(settings.remoteMonitor);
  const [sidebarHideWhenCollapsed, setSidebarHideWhenCollapsed] = useState(settings.sidebarHideWhenCollapsed);
  const [sidebarAtStartup, setSidebarAtStartup] = useState(settings.sidebarAtStartup);
  const [checkUpdates, setCheckUpdates] = useState(settings.checkUpdates);
  const [aiSaveChats, setAiSaveChats] = useState(settings.aiSaveChats);
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
  const [terminalFollowsBrowser, setTerminalFollowsBrowser] = useState(settings.terminalFollowsBrowser);
  const [localShell, setLocalShell] = useState(settings.localShell);
  const [localShellArgs, setLocalShellArgs] = useState(settings.localShellArgs);
  const [localCwd, setLocalCwd] = useState(settings.localCwd);
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
  const [section, setSection] = useState<Section>(initialSection ?? "appearance");
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const size = Number.parseFloat(fontSize);
    const uiSize = Number.parseFloat(uiFontSize);
    const chatSize = Number.parseFloat(chatFontSize);
    const context = Number.parseFloat(aiHistoryContext);
    onSave({
      fontSize: Number.isFinite(size) ? clampFontSize(size) : settings.fontSize,
      uiFontSize: Number.isFinite(uiSize) ? clampUiFontSize(uiSize) : settings.uiFontSize,
      chatFontSize: Number.isFinite(chatSize) ? clampChatFontSize(chatSize) : settings.chatFontSize,
      copyOnSelect,
      rightClickPastes,
      confirmMultilinePaste,
      errorHighlight,
      theme,
      fontFamily: cleanFontFamily(fontFamily),
      remoteMonitor,
      textEditor: cleanTextEditor(textEditor),
      fileDetails,
      gitFileStatus,
      viewerAutoSave,
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
      sidebarWidth: settings.sidebarWidth,
      tabColumnWidth: settings.tabColumnWidth,
      checkUpdates,
      aiSaveChats,
      language,
      shortcuts,
      shiftEnterNewline,
      attentionNotifications,
      gpuAcceleration,
      devCommands: parseDevCommands(devCommands),
    });
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

  const panel = (id: Section) => ({
    role: "tabpanel" as const,
    id: `settings-panel-${id}`,
    "aria-label": sectionLabel(id),
    hidden: section !== id,
    className: "settings__panel",
  });

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog settings" onSubmit={submit} aria-labelledby="settings-title" noValidate>
        <h2 id="settings-title">{t("settings.dialog.title")}</h2>
        <div className="settings__body">
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

          <div {...panel("appearance")}>
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
            <label className="field field--port">
              {t("settings.appearance.fontSize")}
              <input
                type="number"
                min={MIN_FONT_SIZE}
                max={MAX_FONT_SIZE}
                autoFocus
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
              />
            </label>
            <p className="muted">
              {fontShortcuts
                ? t("settings.appearance.fontHelp", { shortcuts: fontShortcuts })
                : t("settings.appearance.fontHelpNoShortcut")}
            </p>
            <label className="field field--port">
              {t("settings.appearance.uiFontSize")}
              <input
                type="number"
                min={MIN_UI_FONT_SIZE}
                max={MAX_UI_FONT_SIZE}
                value={uiFontSize}
                onChange={(e) => setUiFontSize(e.target.value)}
              />
            </label>
            <p className="muted">{t("settings.appearance.uiFontSizeHelp")}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={sidebarHideWhenCollapsed}
                onChange={(e) => setSidebarHideWhenCollapsed(e.target.checked)}
              />
              {t("settings.appearance.hideSidebar")}
            </label>
            <p className="muted">
              {sidebarShortcut
                ? t("settings.appearance.sidebarHelp", { shortcut: sidebarShortcut })
                : t("settings.appearance.sidebarHelpNoShortcut")}
            </p>
            <label className="field">
              {t("settings.appearance.sidebarAtStartup")}
              <select value={sidebarAtStartup} onChange={(e) => setSidebarAtStartup(e.target.value as SidebarAtStartup)}>
                <option value="last">{t("settings.appearance.sidebarLast")}</option>
                <option value="expanded">{t("settings.appearance.sidebarExpanded")}</option>
                <option value="collapsed">{t("settings.appearance.sidebarCollapsed")}</option>
              </select>
            </label>
          </div>

          <div {...panel("terminal")}>
            <ShellPicker
              id="settings-local-shell"
              label={t("settings.terminal.shell")}
              program={localShell}
              args={localShellArgs}
              onChange={(program, args) => {
                setLocalShell(program);
                setLocalShellArgs(args);
              }}
            />
            <p className="muted">{t("settings.terminal.shellHelp")}</p>
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
              {t("settings.terminal.confirmMultilinePaste")}
            </label>
            <p className="muted">{t("settings.terminal.rightClickHelp")}</p>
            <label className="check">
              <input type="checkbox" checked={errorHighlight} onChange={(e) => setErrorHighlight(e.target.checked)} />
              {t("settings.terminal.errorHighlight")}
            </label>
            <p className="muted">{t("settings.terminal.errorHighlightHelp")}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={shiftEnterNewline}
                onChange={(e) => setShiftEnterNewline(e.target.checked)}
              />
              {t("settings.terminal.shiftEnterNewline")}
            </label>
            <p className="muted">{t("settings.terminal.shiftEnterNewlineHelp")}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={attentionNotifications}
                onChange={(e) => setAttentionNotifications(e.target.checked)}
              />
              {t("settings.terminal.attentionNotifications")}
            </label>
            <p className="muted">{t("settings.terminal.attentionNotificationsHelp")}</p>
            <label className="check">
              <input type="checkbox" checked={gpuAcceleration} onChange={(e) => setGpuAcceleration(e.target.checked)} />
              {t("settings.terminal.gpuAcceleration")}
            </label>
            <p className="muted">{t("settings.terminal.gpuAccelerationHelp")}</p>
            <div className="field">
              <label htmlFor="settings-dev-commands">{t("settings.terminal.devCommands")}</label>
              <input
                id="settings-dev-commands"
                value={devCommands}
                spellCheck={false}
                autoCapitalize="off"
                onChange={(e) => setDevCommands(e.target.value)}
              />
            </div>
            <p className="muted">{t("settings.terminal.devCommandsHelp")}</p>
          </div>

          <div {...panel("shortcuts")}>
            <ShortcutsPanel
              overrides={shortcuts}
              assistantShortcut={assistantShortcut}
              onChange={setShortcuts}
              onAssistantChange={setAssistantShortcut}
            />
          </div>

          <div {...panel("ssh")}>
            <label className="check">
              <input type="checkbox" checked={remoteMonitor} onChange={(e) => setRemoteMonitor(e.target.checked)} />
              {t("settings.ssh.remoteMonitor")}
            </label>
            <p className="muted">{t("settings.ssh.remoteMonitorHelp")}</p>
          </div>

          <div {...panel("files")}>
            <div className="field">
              <label htmlFor="settings-text-editor">{t("settings.files.textEditor")}</label>
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
            <p className="muted">
              {editorHelpBefore}
              <code>code --wait</code>
              {editorHelpAfter}
            </p>
            <label className="check">
              <input type="checkbox" checked={fileDetails} onChange={(e) => setFileDetails(e.target.checked)} />
              {t("settings.files.details")}
            </label>
            <label className="check">
              <input type="checkbox" checked={gitFileStatus} onChange={(e) => setGitFileStatus(e.target.checked)} />
              {t("settings.files.gitStatus")}
            </label>
            <p className="muted">{t("settings.files.gitStatusHelp")}</p>
            <label className="check">
              <input type="checkbox" checked={viewerAutoSave} onChange={(e) => setViewerAutoSave(e.target.checked)} />
              {t("settings.files.autoSave")}
            </label>
            <p className="muted">{t("settings.files.autoSaveHelp")}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={terminalFollowsBrowser}
                onChange={(e) => setTerminalFollowsBrowser(e.target.checked)}
              />
              {t("settings.files.terminalFollows")}
            </label>
            <p className="muted">{t("settings.files.terminalFollowsHelp")}</p>
          </div>

          <div {...panel("ai")}>
            <label className="field field--port">
              {t("settings.ai.chatFontSize")}
              <input
                type="number"
                min={MIN_CHAT_FONT_SIZE}
                max={MAX_CHAT_FONT_SIZE}
                value={chatFontSize}
                onChange={(e) => setChatFontSize(e.target.value)}
              />
            </label>
            <p className="muted">
              {fontShortcuts
                ? t("settings.ai.chatFontSizeHelp", { shortcuts: fontShortcuts })
                : t("settings.ai.chatFontSizeHelpNoShortcut")}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={inlineSuggestions}
                onChange={(e) => setInlineSuggestions(e.target.checked)}
              />
              {t("settings.ai.inlineSuggestions")}
            </label>
            <p className="muted">{t("settings.ai.inlineSuggestionsHelp")}</p>
            <div className="form-row">
              <label className="check">
                <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
                {t("settings.ai.commandHistory")}
              </label>
              <button type="button" className="btn" onClick={clearHistory}>
                {t("settings.ai.clearHistory")}
              </button>
            </div>
            {historyNote && <p className="muted">{historyNote}</p>}
            <p className="muted">{t("settings.ai.historyHelp")}</p>
            <label className="check">
              <input type="checkbox" checked={aiSuggestions} onChange={(e) => setAiSuggestions(e.target.checked)} />
              {t("settings.ai.aiSuggestions")}
            </label>
            <p className="muted">{t("settings.ai.aiSuggestionsHelp")}</p>
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
            <label className="check">
              <input type="checkbox" checked={aiSaveChats} onChange={(e) => setAiSaveChats(e.target.checked)} />
              {t("settings.ai.saveChats")}
            </label>
            <p className="muted">{t("settings.ai.saveChatsHelp")}</p>
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
                {updateState.state === "available" && (
                  <button type="button" className="btn btn--primary" onClick={(e) => openLink(e, updateState.release.url)}>
                    {t("settings.about.download")}
                  </button>
                )}
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
              <label className="check">
                <input type="checkbox" checked={checkUpdates} onChange={(e) => setCheckUpdates(e.target.checked)} />
                {t("settings.about.checkAtStartup")}
              </label>
              <p className="muted">{t("settings.about.checkHelp")}</p>
              <div className="settings__updates">
                <button type="button" className="btn" onClick={(e) => openLink(e, BUG_REPORT_URL)}>
                  {t("settings.about.reportProblem")}
                </button>
                <button type="button" className="btn" onClick={(e) => openLink(e, FEATURE_REQUEST_URL)}>
                  {t("settings.about.suggestImprovement")}
                </button>
              </div>
              <p className="muted">{t("settings.about.feedbackHelp")}</p>
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
          <button type="button" className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary">
            {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
