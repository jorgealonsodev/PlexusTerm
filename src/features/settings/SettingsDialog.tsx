import { useState, type FormEvent, type MouseEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FileText, Info, KeyRound, Palette, SquareTerminal, type LucideIcon } from "lucide-react";
import packageJson from "../../../package.json";
import wordmarkUrl from "../../assets/plexusterm-wordmark.svg";
import wordmarkLightUrl from "../../assets/plexusterm-wordmark-light.svg";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { TERMINAL_THEMES, themeById, type TerminalThemeEntry } from "../terminal/themes";
import {
  clampFontSize,
  cleanFontFamily,
  cleanTextEditor,
  cssFontFamily,
  MAX_FONT_FAMILY_LENGTH,
  MAX_FONT_SIZE,
  MAX_TEXT_EDITOR_LENGTH,
  MIN_FONT_SIZE,
  type TerminalSettings,
} from "./settings";

interface SettingsDialogProps {
  settings: TerminalSettings;
  onSave: (settings: TerminalSettings) => void;
  onCancel: () => void;
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

type Section = "appearance" | "terminal" | "ssh" | "files" | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "ssh", label: "SSH", icon: KeyRound },
  { id: "files", label: "Files", icon: FileText },
  { id: "about", label: "About", icon: Info },
];

const APP_VERSION = packageJson.version;
const REPO_URL = "https://github.com/jorgealonsodev/PlexusTerm";
const NOTICES_URL = `${REPO_URL}/blob/main/THIRD_PARTY_NOTICES.md`;

/** Opens a link in the system browser (the app window never navigates away). */
function openLink(e: MouseEvent, url: string) {
  e.preventDefault();
  void openUrl(url).catch(() => {});
}

/** Terminal settings shared by every tab (S15.6), in sections chosen from a side menu. */
export function SettingsDialog({ settings, onSave, onCancel }: SettingsDialogProps) {
  const platform = usePlatform();
  const [fontSize, setFontSize] = useState(String(settings.fontSize));
  const [copyOnSelect, setCopyOnSelect] = useState(settings.copyOnSelect);
  const [rightClickPastes, setRightClickPastes] = useState(settings.rightClickPastes);
  const [confirmMultilinePaste, setConfirmMultilinePaste] = useState(settings.confirmMultilinePaste);
  const [theme, setTheme] = useState(settings.theme);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [remoteMonitor, setRemoteMonitor] = useState(settings.remoteMonitor);
  const [textEditor, setTextEditor] = useState(settings.textEditor);
  const [section, setSection] = useState<Section>("appearance");
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const size = Number.parseFloat(fontSize);
    onSave({
      fontSize: Number.isFinite(size) ? clampFontSize(size) : settings.fontSize,
      copyOnSelect,
      rightClickPastes,
      confirmMultilinePaste,
      theme,
      fontFamily: cleanFontFamily(fontFamily),
      remoteMonitor,
      textEditor: cleanTextEditor(textEditor),
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
