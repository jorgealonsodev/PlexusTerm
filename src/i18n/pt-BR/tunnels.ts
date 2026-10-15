import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "Local (-L)",
    remote: "Remoto (-R)",
    dynamic: "SOCKS5 dinâmico (-D)",
  },
  panel: {
    title: "Túneis SSH",
    new: "Novo",
    startAll: "Iniciar todos",
    stopAll: "Parar todos",
    readError: "Não foi possível ler os túneis salvos: {message}. A edição está desativada para proteger o arquivo.",
    saveError: "Não foi possível salvar os túneis: {error}",
    empty: "Nenhum túnel ainda.",
    missingSession: "sessão ausente",
    via: "{tunnel} via {session}",
    hint: "Os túneis escutam em 127.0.0.1, a menos que você escolha outro endereço.",
  },
  state: {
    stopped: "Parado",
    starting: "Iniciando…",
    running: "Em execução",
    error: "Erro",
  },
  edit: {
    newTitle: "Novo túnel SSH",
    editTitle: "Editar túnel",
    namePlaceholder: "Gerado a partir das portas",
    type: "Tipo",
    sshSession: "Sessão SSH",
    chooseSession: "Escolha uma sessão salva…",
    noSessions: "Salve uma sessão SSH primeiro; os túneis usam a conexão dela.",
    listenAddressServer: "Endereço de escuta no servidor",
    listenAddress: "Endereço de escuta",
    exposedRemote: "Escutar em {host} permite que outras máquinas alcancem a porta do servidor. Use 127.0.0.1 para mantê-la privada.",
    exposedLocal: "Escutar em {host} permite que outras máquinas usem este túnel. Use 127.0.0.1 para mantê-lo privado.",
    destinationFromHere: "Destino (a partir desta máquina)",
    destinationFromServer: "Destino (a partir do servidor)",
    dynamicHint: "Os aplicativos usam esta porta como proxy SOCKS5; o servidor abre as conexões.",
  },
  form: {
    chooseSession: "Escolha uma sessão SSH salva",
    invalidListenPort: "A porta de escuta deve ser um número entre 1 e 65535",
    destHostRequired: "O host de destino é obrigatório",
    invalidDestPort: "A porta de destino deve ser um número entre 1 e 65535",
  },
  file: {
    invalidJson: "o arquivo de túneis não é um JSON válido: {error}",
    unsupportedVersion: "versão do arquivo de túneis não suportada",
    invalidTunnels: "o arquivo de túneis tem túneis inválidos",
  },
  launcher: {
    sessionGone: "A sessão salva dele não existe mais; edite o túnel para escolher outra.",
    startFailed: "Não foi possível iniciar o túnel: {error}",
  },
};
