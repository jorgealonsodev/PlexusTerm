import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileText, Globe, Info, KeyRound, Palette, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import { LOCALES, t as translate, useT, type LanguageSetting } from "../../i18n/i18n";
import packageJson from "../../../package.json";
import wordmarkUrl from "../../assets/plexusterm-wordmark.svg";
import wordmarkLightUrl from "../../assets/plexusterm-wordmark-light.svg";
import { aiOpenCodeModels, describeAiError, type GoModels } from "../ai/aiClient";
import { aiProviderLabel } from "../ai/ModelPicker";
import { commandHistory } from "../history/historyStore";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { TERMINAL_THEMES, themeById, type TerminalThemeEntry } from "../terminal/themes";
import {
  clampAiHistoryContext,
  clampFontSize,
  cleanAiBaseUrl,
  cleanAiModel,
  cleanFontFamily,
  cleanTextEditor,
  cssFontFamily,
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
  type TerminalSettings,
} from "./settings";
import { appShortcutConflict, isValidShortcut, shortcutFromEvent } from "./shortcutCapture";

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

export type SettingsSection = "appearance" | "terminal" | "ssh" | "files" | "ai" | "about";
type Section = SettingsSection;

const SECTIONS: { id: Section; icon: LucideIcon }[] = [
  { id: "appearance", icon: Palette },
  { id: "terminal", icon: SquareTerminal },
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

/** Press a key combination to set it; Escape cancels; app shortcuts are refused. */
function ShortcutField({ value, onChange }: { value: string; onChange: (shortcut: string) => void }) {
  const t = useT();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!capturing) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (plain && e.key === "Tab") return; // keep moving through the form
    e.preventDefault();
    e.stopPropagation();
    if (plain && e.key === "Escape") {
      setCapturing(false);
      setError(null);
      return;
    }
    const shortcut = shortcutFromEvent(e);
    if (shortcut === null) return;
    if (!isValidShortcut(shortcut)) setError(t("settings.ai.shortcutInvalid"));
    else if (appShortcutConflict(shortcut)) setError(t("settings.ai.shortcutTaken", { shortcut }));
    else {
      setError(null);
      setCapturing(false);
      onChange(shortcut);
    }
  };

  return (
    <div className="field">
      <label htmlFor="settings-assistant-shortcut">{t("settings.ai.assistantShortcut")}</label>
      <input
        id="settings-assistant-shortcut"
        className={capturing ? "shortcut-capture shortcut-capture--active" : "shortcut-capture"}
        readOnly
        value={value}
        onFocus={() => setCapturing(true)}
        onClick={() => setCapturing(true)}
        onBlur={() => {
          setCapturing(false);
          setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="muted">
        {t(capturing ? "settings.ai.shortcutCapturing" : "settings.ai.shortcutIdle")}
      </span>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

const APP_VERSION = packageJson.version;
const REPO_URL = "https://github.com/jorgealonsodev/PlexusTerm";
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;

/** Opens a link in the system browser (the app window never navigates away). */
function openLink(e: MouseEvent, url: string) {
  e.preventDefault();
  void openUrl(url).catch(() => {});
}

/** Terminal settings shared by every tab (S15.6), in sections chosen from a side menu. */
export function SettingsDialog({ settings, onSave, onCancel, initialSection, onLanguageNow }: SettingsDialogProps) {
  const t = useT();
  const platform = usePlatform();
  const [language, setLanguage] = useState<LanguageSetting>(settings.language);
  const languageNow = (next: LanguageSetting) => {
    setLanguage(next);
    onLanguageNow?.(next);
  };
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);
  const [theme, setTheme] = useState(settings.theme);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [remoteMonitor, setRemoteMonitor] = useState(settings.remoteMonitor);
  const [sidebarHideWhenCollapsed, setSidebarHideWhenCollapsed] = useState(settings.sidebarHideWhenCollapsed);
  const [textEditor, setTextEditor] = useState(settings.textEditor);
  const [inlineSuggestions, setInlineSuggestions] = useState(settings.inlineSuggestions);
  const [history, setHistory] = useState(settings.commandHistory);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState(settings.aiSuggestions);
  const [aiProvider, setAiProvider] = useState<AiProvider>(settings.aiProvider);
  const [aiBaseUrl, setAiBaseUrl] = useState(settings.aiBaseUrl);
  const [aiModel, setAiModel] = useState(settings.aiModel);
  const [aiHistoryContext, setAiHistoryContext] = useState(String(settings.aiHistoryContext));
  const [assistantShortcut, setAssistantShortcut] = useState(settings.assistantShortcut);
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
    const context = Number.parseFloat(aiHistoryContext);
    onSave({
      fontSize: Number.isFinite(size) ? clampFontSize(size) : settings.fontSize,
      copyOnSelect,
      rightClickPastes,
      confirmMultilinePaste,
      theme,
      fontFamily: cleanFontFamily(fontFamily),
      remoteMonitor,
      textEditor: cleanTextEditor(textEditor),
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
      sidebarWidth: settings.sidebarWidth,
      language,
    });
  };

  // Sentences with markup inside: the placeholder marks where the code or the link goes.
  const [editorHelpBefore, editorHelpAfter = ""] = t("settings.files.textEditorHelp").split("{command}");
  const [creditsBefore, creditsAfter = ""] = t("settings.about.credits").split("{notices}");

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
            <p className="muted">{t("settings.appearance.fontHelp")}</p>
            <label className="check">
              <input
                type="checkbox"
                checked={sidebarHideWhenCollapsed}
                onChange={(e) => setSidebarHideWhenCollapsed(e.target.checked)}
              />
              {t("settings.appearance.hideSidebar")}
            </label>
            <p className="muted">{t("settings.appearance.sidebarHelp")}</p>
          </div>

          <div {...panel("terminal")}>
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
          </div>

          <div {...panel("ai")}>
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
            <ShortcutField value={assistantShortcut} onChange={setAssistantShortcut} />
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
