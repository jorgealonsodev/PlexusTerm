import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileText, Info, KeyRound, Palette, Sparkles, SquareTerminal, type LucideIcon } from "lucide-react";
import packageJson from "../../../package.json";
import wordmarkUrl from "../../assets/plexusterm-wordmark.svg";
import wordmarkLightUrl from "../../assets/plexusterm-wordmark-light.svg";
import { aiOpenCodeModels, describeAiError, type GoModels } from "../ai/aiClient";
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
}

const PREVIEW_COLOURS = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;

/** A few lines of a shell session drawn with the scheme's colours. */
function ThemePreview({ entry, fontFamily }: { entry: TerminalThemeEntry; fontFamily: string }) {
  const t = entry.theme;
  return (
    <div
      className="theme-preview"
      aria-label={`Preview of ${entry.name}`}
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

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "ssh", label: "SSH", icon: KeyRound },
  { id: "files", label: "Files", icon: FileText },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "about", label: "About", icon: Info },
];

const PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  "openai-compatible": "OpenAI-compatible",
  "opencode-go": "OpenCode Go",
};

/** Where OpenCode publishes its Go model list (public, no key). */
const OPENCODE_MODELS_URL = "https://opencode.ai/inference/go/v1/models";

/**
 * The OpenCode Go model picker (S7): the backend's list (24 h cache, Refresh asks again);
 * models PlexusTerm cannot talk to yet are shown disabled. Without a list the model is typed.
 */
function OpenCodeModelField({ value, onChange }: { value: string; onChange: (model: string) => void }) {
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
      <label htmlFor="settings-ai-model">Model</label>
      <div className="form-row field__picker">
        {models.length > 0 ? (
          <select id="settings-ai-model" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>
              Choose a model
            </option>
            {value && !models.some((m) => m.id === value) && <option value={value}>{value}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.supported}>
                {`${m.name} (${m.id})${m.supported ? "" : " — not supported yet"}`}
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
          Refresh models
        </button>
      </div>
      {busy && <span className="muted">Loading the models…</span>}
      {list?.note && <span className="muted">{list.note}</span>}
      {error && (
        <span className="form-error">
          {error} Type a model id from {OPENCODE_MODELS_URL}.
        </span>
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

  const run = (action: () => Promise<unknown>, after: KeyStatus, failure: string) => {
    setBusy(true);
    setError(null);
    Promise.resolve()
      .then(action)
      .then(() => {
        setStatus(after);
        setKey("");
      })
      .catch((err) => setError(`${failure}: ${err}`))
      .finally(() => setBusy(false));
  };

  const label = { checking: "Checking the keyring…", saved: "A key is saved", none: "No key saved", unavailable: "Keyring unavailable" };
  return (
    <div className="field">
      <label htmlFor="settings-ai-key">API key</label>
      <div className="form-row field__picker">
        <input
          id="settings-ai-key"
          type="password"
          autoComplete="off"
          value={key}
          placeholder={status === "saved" ? "Type a new key to replace it" : "Paste the key"}
          onChange={(e) => setKey(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !key.trim()}
          onClick={() => run(() => invoke("ai_key_save", { provider, key: key.trim() }), "saved", "Could not save the key")}
        >
          Save key
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || status !== "saved"}
          onClick={() => run(() => invoke("ai_key_delete", { provider }), "none", "Could not remove the key")}
        >
          Remove key
        </button>
      </div>
      <span className="muted">{label[status]}</span>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

/** Press a key combination to set it; Escape cancels; app shortcuts are refused. */
function ShortcutField({ value, onChange }: { value: string; onChange: (shortcut: string) => void }) {
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
    if (!isValidShortcut(shortcut)) setError("Use Ctrl, Alt or Meta with a key.");
    else if (appShortcutConflict(shortcut)) setError(`${shortcut} is already used by PlexusTerm.`);
    else {
      setError(null);
      setCapturing(false);
      onChange(shortcut);
    }
  };

  return (
    <div className="field">
      <label htmlFor="settings-assistant-shortcut">Assistant shortcut</label>
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
        {capturing ? "Press the new key combination, or Escape to keep it." : "Click the field to change it."}
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
export function SettingsDialog({ settings, onSave, onCancel, initialSection }: SettingsDialogProps) {
  const platform = usePlatform();
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);
  const [theme, setTheme] = useState(settings.theme);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [remoteMonitor, setRemoteMonitor] = useState(settings.remoteMonitor);
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
  const dark = TERMINAL_THEMES.filter((t) => t.dark);
  const light = TERMINAL_THEMES.filter((t) => !t.dark);

  const browseTextEditor = async () => {
    try {
      const program = await open({
        title: "Choose a text editor",
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
      .then(() => setHistoryNote("History cleared."))
      .catch((err) => setHistoryNote(`Could not clear the history: ${err}`));
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
    });
  };

  const panel = (id: Section) => ({
    role: "tabpanel" as const,
    id: `settings-panel-${id}`,
    "aria-label": SECTIONS.find((x) => x.id === id)!.label,
    hidden: section !== id,
    className: "settings__panel",
  });

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog settings" onSubmit={submit} aria-labelledby="settings-title" noValidate>
        <h2 id="settings-title">Settings</h2>
        <div className="settings__body">
          <nav className="settings__nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
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
                {label}
              </button>
            ))}
          </nav>

          <div {...panel("appearance")}>
            <label className="field">
              Colour scheme
              <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                <optgroup label="Dark">
                  {dark.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Light">
                  {light.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <ThemePreview entry={themeById(theme)} fontFamily={cleanFontFamily(fontFamily)} />
            <label className="field">
              Font family
              <input
                value={fontFamily}
                maxLength={MAX_FONT_FAMILY_LENGTH}
                spellCheck={false}
                onChange={(e) => setFontFamily(e.target.value)}
              />
            </label>
            <label className="field field--port">
              Font size
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
              Ctrl+= / Ctrl+- / Ctrl+0 change the font size. Prompt themes that draw icons (Powerlevel10k, agnoster,
              Starship) need a Nerd Font as the font family.
            </p>
          </div>

          <div {...panel("terminal")}>
            <label className="check">
              <input type="checkbox" checked={copyOnSelect} onChange={(e) => setCopyOnSelect(e.target.checked)} />
              Copy on select
            </label>
            <label className="check">
              <input type="checkbox" checked={rightClickPastes} onChange={(e) => setRightClickPastes(e.target.checked)} />
              Right click pastes
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={confirmMultilinePaste}
                onChange={(e) => setConfirmMultilinePaste(e.target.checked)}
              />
              Confirm multi-line paste
            </label>
            <p className="muted">When right click pastes, Ctrl+right click opens the terminal menu.</p>
          </div>

          <div {...panel("ssh")}>
            <label className="check">
              <input type="checkbox" checked={remoteMonitor} onChange={(e) => setRemoteMonitor(e.target.checked)} />
              Remote monitor bar (SSH tabs)
            </label>
            <p className="muted">
              A bar under each SSH pane with the server's CPU, memory, disk, network and users, read over the same
              connection. Also in Tools.
            </p>
          </div>

          <div {...panel("files")}>
            <div className="field">
              <label htmlFor="settings-text-editor">Text editor</label>
              <div className="form-row field__picker">
                <input
                  id="settings-text-editor"
                  value={textEditor}
                  placeholder="System default"
                  maxLength={MAX_TEXT_EDITOR_LENGTH}
                  spellCheck={false}
                  onChange={(e) => setTextEditor(e.target.value)}
                />
                <button type="button" className="btn" onClick={() => void browseTextEditor()}>
                  Browse…
                </button>
                <button type="button" className="btn" disabled={!textEditor} onClick={() => setTextEditor("")}>
                  Use system default
                </button>
              </div>
            </div>
            <p className="muted">
              The text editor opens files from the SFTP browser: a program, or a command such as{" "}
              <code>code --wait</code>; leave it empty to use the system default.
            </p>
          </div>

          <div {...panel("ai")}>
            <label className="check">
              <input
                type="checkbox"
                checked={inlineSuggestions}
                onChange={(e) => setInlineSuggestions(e.target.checked)}
              />
              Inline suggestions
            </label>
            <p className="muted">
              A grey suggestion of the rest of the command while you type. Right Arrow or End accepts it, Ctrl+Right
              accepts one word.
            </p>
            <div className="form-row">
              <label className="check">
                <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
                Command history
              </label>
              <button type="button" className="btn" onClick={clearHistory}>
                Clear history
              </button>
            </div>
            {historyNote && <p className="muted">{historyNote}</p>}
            <p className="muted">
              Commands you run are kept on this computer, per host, to suggest them again. Lines starting with a
              space, passwords and full-screen programs are never recorded.
            </p>
            <label className="check">
              <input type="checkbox" checked={aiSuggestions} onChange={(e) => setAiSuggestions(e.target.checked)} />
              AI suggestions
            </label>
            <p className="muted">
              When the history has nothing, ask the AI provider. Only the typed line, the current folder and the last
              history commands are sent, never the terminal output.
            </p>
            <label className="field">
              Provider
              <select value={aiProvider} onChange={(e) => changeProvider(e.target.value)}>
                {Object.entries(PROVIDER_LABELS).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {aiProvider === "opencode-go" && (
              <p className="muted">
                OpenCode Go is meant for coding agents and monitors traffic; inline AI suggestions send many short
                requests.
              </p>
            )}
            {aiProvider === "openai-compatible" && (
              <label className="field">
                Base URL
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
                Model
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
              History commands sent as context
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
              <p>Version {APP_VERSION}</p>
              <p className="muted">
                A terminal and remote-session manager for Linux and Windows: local shells, SSH, SFTP, tunnels, serial,
                Telnet and Mosh in one window.
              </p>
              <p>
                <a href={REPO_URL} onClick={(e) => openLink(e, REPO_URL)}>
                  github.com/jorgealonsodev/PlexusTerm
                </a>
              </p>
              <p className="muted">
                Colour schemes from iTerm2-Color-Schemes (MIT) and their authors; see{" "}
                <a href={NOTICES_URL} onClick={(e) => openLink(e, NOTICES_URL)}>
                  third-party notices
                </a>
                .
              </p>
            </div>
          </div>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
