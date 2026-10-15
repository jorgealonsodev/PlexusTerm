import type { macros as en } from "../en/macros";
import type { Messages } from "../types";

export const macros: Messages<typeof en> = {
  recording: {
    title: "Enregistrement de la macro",
    warning: "Tout ce que vous saisissez est enregistré, mots de passe compris",
    stop: "Arrêter l'enregistrement",
  },
  name: {
    title: "Enregistrer la macro",
    recorded: {
      one: "{count} étape enregistrée. Les macros sont enregistrées en texte brut.",
      many: "{count} étapes enregistrées. Les macros sont enregistrées en texte brut.",
      other: "{count} étapes enregistrées. Les macros sont enregistrées en texte brut.",
    },
    discard: "Abandonner",
  },
  progress: {
    running: "Exécution de « {name} » : étape {step} sur {total}",
    label: "Progression de la macro {name}",
  },
  panel: {
    title: "Macros",
    new: "Nouvelle",
    search: "Rechercher des macros",
    readError:
      "Impossible de lire les macros enregistrées : {message}. La modification est désactivée pour protéger le fichier.",
    saveError: "Impossible d'enregistrer les macros : {error}",
    empty: "Aucune macro pour l'instant. Enregistrez-en une avec Ctrl+Shift+R ou créez-en une avec Nouvelle.",
    noMatch: "Aucune macro ne correspond.",
    steps: { one: "{count} étape", many: "{count} étapes", other: "{count} étapes" },
    editNamed: "Modifier {name}",
    duplicate: "Dupliquer",
    duplicateNamed: "Dupliquer {name}",
    deleteNamed: "Supprimer {name}",
    playNamed: "Lire {name}",
    play: "Lire dans le terminal actif",
    hint: "Les macros sont lues dans le terminal actif ; Ctrl+Alt+1–9 lit la macro associée à cette touche. Les macros sont enregistrées en texte brut.",
  },
  edit: {
    newTitle: "Nouvelle macro",
    editTitle: "Modifier la macro",
    hotkey: "Raccourci clavier",
    none: "Aucun",
    hotkeyUsed: "{hotkey} ({name})",
    escapes:
      "Séquences d'échappement dans le texte : \\r Enter, \\n, \\t, \\e Escape, \\\\, \\xHH, ^C et les autres touches de contrôle ^A–^Z, ^[ et ^?.",
    kindSend: "Envoyer du texte",
    kindWait: "Attendre",
    kindWaitFor: "Attendre un texte",
    stepKind: "Type de l'étape {n}",
    stepMs: "Millisecondes de l'étape {n}",
    stepText: "Texte de l'étape {n}",
    sendPlaceholder: "p. ex. ls -la\\r",
    waitForPlaceholder: "p. ex. password:",
    stepTimeout: "Délai d'attente de l'étape {n} en secondes",
    moveUp: "Monter l'étape {n}",
    moveDown: "Descendre l'étape {n}",
    removeStep: "Retirer l'étape {n}",
    noSteps: "Aucune étape pour l'instant.",
    addStep: "Ajouter une étape",
  },
  form: {
    nameRequired: "Saisissez un nom.",
    invalidWait: "Étape {n} : l'attente doit être un nombre entier de millisecondes de 0 à {max}.",
    waitForTextRequired: "Étape {n} : saisissez le texte à attendre.",
    invalidTimeout: "Étape {n} : le délai d'attente doit être un nombre entier de secondes de 1 à {max}.",
  },
  file: {
    invalidJson: "le fichier des macros n'est pas un JSON valide : {error}",
    unsupportedVersion: "version du fichier des macros non prise en charge",
    invalidMacros: "le fichier des macros contient des macros non valides",
    duplicateHotkey: "le fichier des macros contient deux macros sur {hotkey}",
  },
  copyName: "{name} (copie)",
  player: {
    timedOut: "La macro « {name} » s'est arrêtée à l'étape {step} sur {total} : « {text} » n'est pas apparu en {seconds} s.",
  },
};
