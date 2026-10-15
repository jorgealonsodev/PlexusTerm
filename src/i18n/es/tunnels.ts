import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "Local (-L)",
    remote: "Remoto (-R)",
    dynamic: "SOCKS5 dinámico (-D)",
  },
  panel: {
    title: "Túneles SSH",
    new: "Nuevo",
    startAll: "Iniciar todos",
    stopAll: "Detener todos",
    readError: "No se pudieron leer los túneles guardados: {message}. La edición está desactivada para proteger el archivo.",
    saveError: "No se pudieron guardar los túneles: {error}",
    empty: "Aún no hay túneles.",
    missingSession: "sesión inexistente",
    via: "{tunnel} a través de {session}",
    hint: "Los túneles escuchan en 127.0.0.1 a menos que elijas otra dirección.",
  },
  state: {
    stopped: "Detenido",
    starting: "Iniciando…",
    running: "En ejecución",
    error: "Error",
  },
  edit: {
    newTitle: "Nuevo túnel SSH",
    editTitle: "Editar túnel",
    namePlaceholder: "Generado a partir de los puertos",
    type: "Tipo",
    sshSession: "Sesión SSH",
    chooseSession: "Elige una sesión guardada…",
    noSessions: "Guarda primero una sesión SSH; los túneles usan su conexión.",
    listenAddressServer: "Dirección de escucha en el servidor",
    listenAddress: "Dirección de escucha",
    exposedRemote: "Escuchar en {host} permite que otras máquinas lleguen al puerto del servidor. Usa 127.0.0.1 para mantenerlo privado.",
    exposedLocal: "Escuchar en {host} permite que otras máquinas usen este túnel. Usa 127.0.0.1 para mantenerlo privado.",
    destinationFromHere: "Destino (desde esta máquina)",
    destinationFromServer: "Destino (desde el servidor)",
    dynamicHint: "Las aplicaciones usan este puerto como proxy SOCKS5; el servidor abre las conexiones.",
  },
  form: {
    chooseSession: "Elige una sesión SSH guardada",
    invalidListenPort: "El puerto de escucha debe ser un número entre 1 y 65535",
    destHostRequired: "El host de destino es obligatorio",
    invalidDestPort: "El puerto de destino debe ser un número entre 1 y 65535",
  },
  file: {
    invalidJson: "el archivo de túneles no es JSON válido: {error}",
    unsupportedVersion: "versión del archivo de túneles no admitida",
    invalidTunnels: "el archivo de túneles tiene túneles no válidos",
  },
  launcher: {
    sessionGone: "Su sesión guardada ya no existe; edita el túnel para elegir otra.",
    startFailed: "No se pudo iniciar el túnel: {error}",
  },
};
