import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "Lokal (-L)",
    remote: "Remote (-R)",
    dynamic: "Dynamisch SOCKS5 (-D)",
  },
  panel: {
    title: "SSH-Tunnel",
    new: "Neu",
    startAll: "Alle starten",
    stopAll: "Alle stoppen",
    readError:
      "Gespeicherte Tunnel konnten nicht gelesen werden: {message}. Bearbeiten ist deaktiviert, um die Datei zu schützen.",
    saveError: "Tunnel konnten nicht gespeichert werden: {error}",
    empty: "Noch keine Tunnel.",
    missingSession: "Sitzung fehlt",
    via: "{tunnel} über {session}",
    hint: "Tunnel lauschen auf 127.0.0.1, sofern keine andere Adresse gewählt ist.",
  },
  state: {
    stopped: "Gestoppt",
    starting: "Wird gestartet…",
    running: "Läuft",
    error: "Fehler",
  },
  edit: {
    newTitle: "Neuer SSH-Tunnel",
    editTitle: "Tunnel bearbeiten",
    namePlaceholder: "Aus den Ports erzeugt",
    type: "Typ",
    sshSession: "SSH-Sitzung",
    chooseSession: "Gespeicherte Sitzung auswählen…",
    noSessions: "Speichere zuerst eine SSH-Sitzung; Tunnel verwenden deren Verbindung.",
    listenAddressServer: "Lauschadresse auf dem Server",
    listenAddress: "Lauschadresse",
    exposedRemote:
      "Lauschen auf {host} macht den Serverport für andere Rechner erreichbar. Verwende 127.0.0.1, um ihn privat zu halten.",
    exposedLocal:
      "Lauschen auf {host} erlaubt anderen Rechnern, diesen Tunnel zu nutzen. Verwende 127.0.0.1, um ihn privat zu halten.",
    destinationFromHere: "Ziel (von diesem Rechner aus)",
    destinationFromServer: "Ziel (vom Server aus)",
    dynamicHint: "Anwendungen nutzen diesen Port als SOCKS5-Proxy; der Server baut die Verbindungen auf.",
  },
  form: {
    chooseSession: "Gespeicherte SSH-Sitzung auswählen",
    invalidListenPort: "Lauschport muss eine Zahl zwischen 1 und 65535 sein",
    destHostRequired: "Zielhost ist erforderlich",
    invalidDestPort: "Zielport muss eine Zahl zwischen 1 und 65535 sein",
  },
  file: {
    invalidJson: "Die Tunneldatei ist kein gültiges JSON: {error}",
    unsupportedVersion: "Nicht unterstützte Version der Tunneldatei",
    invalidTunnels: "Die Tunneldatei enthält ungültige Tunnel",
  },
  launcher: {
    sessionGone:
      "Die gespeicherte Sitzung existiert nicht mehr; bearbeite den Tunnel, um eine andere auszuwählen.",
    startFailed: "Der Tunnel konnte nicht gestartet werden: {error}",
  },
};
