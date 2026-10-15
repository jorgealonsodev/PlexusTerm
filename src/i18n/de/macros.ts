import type { macros as en } from "../en/macros";
import type { Messages } from "../types";

export const macros: Messages<typeof en> = {
  recording: {
    title: "Makro wird aufgezeichnet",
    warning: "Alle Eingaben werden gespeichert, auch Passwörter",
    stop: "Aufzeichnung beenden",
  },
  name: {
    title: "Aufgezeichnetes Makro speichern",
    recorded: {
      one: "{count} Schritt aufgezeichnet. Makros werden als Klartext gespeichert.",
      other: "{count} Schritte aufgezeichnet. Makros werden als Klartext gespeichert.",
    },
    discard: "Verwerfen",
  },
  progress: {
    running: "„{name}“ läuft: Schritt {step} von {total}",
    label: "Fortschritt von Makro {name}",
  },
  panel: {
    title: "Makros",
    new: "Neu",
    search: "Makros durchsuchen",
    readError:
      "Gespeicherte Makros konnten nicht gelesen werden: {message}. Bearbeiten ist deaktiviert, um die Datei zu schützen.",
    saveError: "Makros konnten nicht gespeichert werden: {error}",
    empty: "Noch keine Makros. Zeichne eines mit Ctrl+Shift+R auf oder erstelle eines mit „Neu“.",
    noMatch: "Keine passenden Makros.",
    steps: { one: "{count} Schritt", other: "{count} Schritte" },
    editNamed: "{name} bearbeiten",
    duplicate: "Duplizieren",
    duplicateNamed: "{name} duplizieren",
    deleteNamed: "{name} löschen",
    playNamed: "{name} abspielen",
    play: "Im aktiven Terminal abspielen",
    hint: "Makros werden im aktiven Terminal abgespielt; Ctrl+Alt+1–9 spielt das Makro ab, das dieser Taste zugewiesen ist. Makros werden als Klartext gespeichert.",
  },
  edit: {
    newTitle: "Neues Makro",
    editTitle: "Makro bearbeiten",
    hotkey: "Tastenkürzel",
    none: "Keines",
    hotkeyUsed: "{hotkey} ({name})",
    escapes:
      "Escape-Sequenzen im Text: \\r Enter, \\n, \\t, \\e Escape, \\\\, \\xHH, ^C und andere Steuertasten ^A–^Z, ^[ und ^?.",
    kindSend: "Text senden",
    kindWait: "Warten",
    kindWaitFor: "Auf Text warten",
    stepKind: "Art von Schritt {n}",
    stepMs: "Millisekunden von Schritt {n}",
    stepText: "Text von Schritt {n}",
    sendPlaceholder: "z. B. ls -la\\r",
    waitForPlaceholder: "z. B. password:",
    stepTimeout: "Zeitlimit von Schritt {n} in Sekunden",
    moveUp: "Schritt {n} nach oben verschieben",
    moveDown: "Schritt {n} nach unten verschieben",
    removeStep: "Schritt {n} entfernen",
    noSteps: "Noch keine Schritte.",
    addStep: "Schritt hinzufügen",
  },
  form: {
    nameRequired: "Gib einen Namen ein.",
    invalidWait: "Schritt {n}: Die Wartezeit muss eine ganze Zahl von Millisekunden zwischen 0 und {max} sein.",
    waitForTextRequired: "Schritt {n}: Gib den Text ein, auf den gewartet werden soll.",
    invalidTimeout: "Schritt {n}: Das Zeitlimit muss eine ganze Zahl von Sekunden zwischen 1 und {max} sein.",
  },
  file: {
    invalidJson: "Die Makrodatei ist kein gültiges JSON: {error}",
    unsupportedVersion: "Nicht unterstützte Version der Makrodatei",
    invalidMacros: "Die Makrodatei enthält ungültige Makros",
    duplicateHotkey: "Die Makrodatei enthält zwei Makros auf {hotkey}",
  },
  copyName: "{name} (Kopie)",
  player: {
    timedOut:
      "Makro „{name}“ wurde bei Schritt {step} von {total} gestoppt: „{text}“ erschien nicht innerhalb von {seconds} s.",
  },
};
