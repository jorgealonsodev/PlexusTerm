import type { settings as en } from "../en/settings";
import type { Messages } from "../types";

export const settings: Messages<typeof en> = {
  language: {
    label: "Sprache",
    system: "System",
  },
  dialog: {
    title: "Einstellungen",
    sections: "Einstellungsbereiche",
  },
  sections: {
    appearance: "Darstellung",
    terminal: "Terminal",
    ssh: "SSH",
    files: "Dateien",
    ai: "KI",
    about: "Info",
  },
  appearance: {
    colourScheme: "Farbschema",
    dark: "Dunkel",
    light: "Hell",
    preview: "Vorschau von {name}",
    fontFamily: "Schriftart",
    fontSize: "Schriftgröße",
    fontHelp:
      "Ctrl+= / Ctrl+- / Ctrl+0 ändern die Schriftgröße. Prompt-Themes mit Symbolen (Powerlevel10k, agnoster, Starship) benötigen eine Nerd Font als Schriftart.",
    hideSidebar: "Seitenleiste beim Einklappen vollständig ausblenden",
    sidebarHelp:
      "Ctrl+Shift+B oder die Schaltfläche in der Symbolleiste klappt die Seitenleiste auf ihre Tab-Symbole ein oder blendet sie mit dieser Option vollständig aus.",
  },
  terminal: {
    copyOnSelect: "Beim Markieren kopieren",
    rightClickPastes: "Rechtsklick fügt ein",
    confirmMultilinePaste: "Mehrzeiliges Einfügen bestätigen",
    rightClickHelp: "Wenn Rechtsklick einfügt, öffnet Ctrl+Rechtsklick das Terminalmenü.",
  },
  ssh: {
    remoteMonitor: "Remote-Monitorleiste (SSH-Tabs)",
    remoteMonitorHelp:
      "Eine Leiste unter jedem SSH-Bereich mit CPU, Arbeitsspeicher, Datenträger, Netzwerk und Benutzern des Servers, über dieselbe Verbindung gelesen. Auch unter Werkzeuge.",
  },
  files: {
    textEditor: "Texteditor",
    systemDefault: "Systemstandard",
    useSystemDefault: "Systemstandard verwenden",
    chooseEditor: "Texteditor auswählen",
    textEditorHelp:
      "Der Texteditor öffnet Dateien aus dem SFTP-Browser: ein Programm oder ein Befehl wie {command}; leer lassen, um den Systemstandard zu verwenden.",
  },
  ai: {
    inlineSuggestions: "Inline-Vorschläge",
    inlineSuggestionsHelp:
      "Ein grauer Vorschlag für den Rest des Befehls während der Eingabe. Pfeil rechts oder End übernimmt ihn, Ctrl+Pfeil rechts übernimmt ein Wort.",
    commandHistory: "Befehlsverlauf",
    clearHistory: "Verlauf löschen",
    historyCleared: "Verlauf gelöscht.",
    historyClearFailed: "Der Verlauf konnte nicht gelöscht werden: {error}",
    historyHelp:
      "Ausgeführte Befehle werden pro Host auf diesem Computer gespeichert, um sie erneut vorzuschlagen. Zeilen, die mit einem Leerzeichen beginnen, Passwörter und Vollbildprogramme werden nie aufgezeichnet.",
    aiSuggestions: "KI-Vorschläge",
    aiSuggestionsHelp:
      "Wenn der Verlauf nichts liefert, wird der KI-Anbieter gefragt. Gesendet werden nur die eingegebene Zeile, der aktuelle Ordner und die letzten Verlaufsbefehle, niemals die Terminalausgabe.",
    provider: "Anbieter",
    openCodeGoNote:
      "OpenCode Go ist für Coding-Agenten gedacht und überwacht den Datenverkehr; Inline-KI-Vorschläge senden viele kurze Anfragen.",
    baseUrl: "Basis-URL",
    model: "Modell",
    historyContext: "Als Kontext gesendete Verlaufsbefehle",
    chooseModel: "Modell auswählen",
    modelOption: "{name} ({id})",
    modelOptionUnsupported: "{name} ({id}) – noch nicht unterstützt",
    refreshModels: "Modelle aktualisieren",
    loadingModels: "Modelle werden geladen…",
    modelsError: "{error} Gib eine Modell-ID von {url} ein.",
    apiKey: "API-Schlüssel",
    keyChecking: "Schlüsselbund wird geprüft…",
    keySaved: "Ein Schlüssel ist gespeichert",
    keyNone: "Kein Schlüssel gespeichert",
    keyUnavailable: "Schlüsselbund nicht verfügbar",
    keyReplacePlaceholder: "Neuen Schlüssel eingeben, um ihn zu ersetzen",
    keyPastePlaceholder: "Schlüssel einfügen",
    saveKey: "Schlüssel speichern",
    removeKey: "Schlüssel entfernen",
    saveKeyFailed: "Der Schlüssel konnte nicht gespeichert werden: {error}",
    removeKeyFailed: "Der Schlüssel konnte nicht entfernt werden: {error}",
    assistantShortcut: "Tastenkürzel für den Assistenten",
    shortcutInvalid: "Verwende Ctrl, Alt oder Meta mit einer Taste.",
    shortcutTaken: "{shortcut} wird bereits von PlexusTerm verwendet.",
    shortcutCapturing: "Drücke die neue Tastenkombination oder Escape, um sie beizubehalten.",
    shortcutIdle: "Klicke in das Feld, um es zu ändern.",
  },
  about: {
    version: "Version {version}",
    description:
      "Ein Terminal- und Remote-Sitzungsmanager für Linux und Windows: lokale Shells, SSH, SFTP, Tunnel, seriell, Telnet und Mosh in einem Fenster.",
    credits: "Farbschemata aus iTerm2-Color-Schemes (MIT) und von deren Autoren; siehe {notices}.",
    notices: "Hinweise zu Drittanbietern",
  },
};
