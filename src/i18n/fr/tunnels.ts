import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "Local (-L)",
    remote: "Distant (-R)",
    dynamic: "SOCKS5 dynamique (-D)",
  },
  panel: {
    title: "Tunnels SSH",
    new: "Nouveau",
    startAll: "Tout démarrer",
    stopAll: "Tout arrêter",
    readError:
      "Impossible de lire les tunnels enregistrés : {message}. La modification est désactivée pour protéger le fichier.",
    saveError: "Impossible d'enregistrer les tunnels : {error}",
    empty: "Aucun tunnel pour l'instant.",
    missingSession: "session introuvable",
    via: "{tunnel} via {session}",
    hint: "Les tunnels écoutent sur 127.0.0.1, sauf si vous choisissez une autre adresse.",
  },
  state: {
    stopped: "Arrêté",
    starting: "Démarrage…",
    running: "En cours",
    error: "Erreur",
  },
  edit: {
    newTitle: "Nouveau tunnel SSH",
    editTitle: "Modifier le tunnel",
    namePlaceholder: "Généré à partir des ports",
    type: "Type",
    sshSession: "Session SSH",
    chooseSession: "Choisissez une session enregistrée…",
    noSessions: "Enregistrez d'abord une session SSH ; les tunnels utilisent sa connexion.",
    listenAddressServer: "Adresse d'écoute sur le serveur",
    listenAddress: "Adresse d'écoute",
    exposedRemote:
      "Écouter sur {host} permet à d'autres machines d'atteindre le port du serveur. Utilisez 127.0.0.1 pour le garder privé.",
    exposedLocal: "Écouter sur {host} permet à d'autres machines d'utiliser ce tunnel. Utilisez 127.0.0.1 pour le garder privé.",
    destinationFromHere: "Destination (depuis cette machine)",
    destinationFromServer: "Destination (depuis le serveur)",
    dynamicHint: "Les applications utilisent ce port comme proxy SOCKS5 ; le serveur ouvre les connexions.",
  },
  form: {
    chooseSession: "Choisissez une session SSH enregistrée",
    invalidListenPort: "Le port d'écoute doit être un nombre compris entre 1 et 65535",
    destHostRequired: "L'hôte de destination est obligatoire",
    invalidDestPort: "Le port de destination doit être un nombre compris entre 1 et 65535",
  },
  file: {
    invalidJson: "le fichier des tunnels n'est pas un JSON valide : {error}",
    unsupportedVersion: "version du fichier des tunnels non prise en charge",
    invalidTunnels: "le fichier des tunnels contient des tunnels non valides",
  },
  launcher: {
    sessionGone: "Sa session enregistrée n'existe plus ; modifiez le tunnel pour en choisir une autre.",
    startFailed: "Impossible de démarrer le tunnel : {error}",
  },
};
