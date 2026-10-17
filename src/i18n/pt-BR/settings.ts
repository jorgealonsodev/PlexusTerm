import type { settings as en } from "../en/settings";
import type { Messages } from "../types";

export const settings: Messages<typeof en> = {
  language: {
    label: "Idioma",
    system: "Sistema",
  },
  dialog: {
    title: "Configurações",
    sections: "Seções das configurações",
  },
  sections: {
    appearance: "Aparência",
    terminal: "Terminal",
    ssh: "SSH",
    files: "Arquivos",
    ai: "IA",
    about: "Sobre",
  },
  appearance: {
    colourScheme: "Esquema de cores",
    dark: "Escuro",
    light: "Claro",
    preview: "Prévia de {name}",
    fontFamily: "Fonte",
    fontSize: "Tamanho da fonte",
    fontHelp:
      "Ctrl+= / Ctrl+- / Ctrl+0 alteram o tamanho da fonte. Temas de prompt que desenham ícones (Powerlevel10k, agnoster, Starship) precisam de uma Nerd Font como fonte.",
    hideSidebar: "Ocultar completamente a barra lateral quando recolhida",
    sidebarHelp:
      "Ctrl+Shift+B ou o botão da barra de ferramentas recolhe a barra lateral aos ícones das abas, ou a oculta completamente com esta opção.",
  },
  terminal: {
    copyOnSelect: "Copiar ao selecionar",
    rightClickPastes: "Clique com o botão direito cola",
    confirmMultilinePaste: "Confirmar ao colar várias linhas",
    rightClickHelp: "Quando o clique com o botão direito cola, Ctrl+clique com o botão direito abre o menu do terminal.",
  },
  ssh: {
    remoteMonitor: "Barra do monitor remoto (abas SSH)",
    remoteMonitorHelp:
      "Uma barra abaixo de cada painel SSH com a CPU, a memória, o disco, a rede e os usuários do servidor, lidos pela mesma conexão. Também em Ferramentas.",
  },
  files: {
    textEditor: "Editor de texto",
    systemDefault: "Padrão do sistema",
    useSystemDefault: "Usar o padrão do sistema",
    chooseEditor: "Escolha um editor de texto",
    textEditorHelp:
      "O editor de texto abre arquivos do navegador SFTP: um programa ou um comando como {command}; deixe vazio para usar o padrão do sistema.",
  },
  ai: {
    inlineSuggestions: "Sugestões em linha",
    inlineSuggestionsHelp:
      "Uma sugestão em cinza do restante do comando enquanto você digita. Seta para a direita ou End a aceita; Ctrl+Seta para a direita aceita uma palavra.",
    commandHistory: "Histórico de comandos",
    clearHistory: "Limpar histórico",
    historyCleared: "Histórico limpo.",
    historyClearFailed: "Não foi possível limpar o histórico: {error}",
    historyHelp:
      "Os comandos que você executa ficam guardados neste computador, por host, para serem sugeridos novamente. Linhas que começam com espaço, senhas e programas em tela cheia nunca são registrados.",
    aiSuggestions: "Sugestões de IA",
    aiSuggestionsHelp:
      "Quando o histórico não tem nada, o provedor de IA é consultado. Somente a linha digitada, a pasta atual e os últimos comandos do histórico são enviados, nunca a saída do terminal.",
    provider: "Provedor",
    openCodeGoNote:
      "O OpenCode Go é destinado a agentes de programação e monitora o tráfego; as sugestões de IA em linha enviam muitas solicitações curtas.",
    baseUrl: "URL base",
    model: "Modelo",
    historyContext: "Comandos do histórico enviados como contexto",
    chooseModel: "Escolha um modelo",
    modelOption: "{name} ({id})",
    modelOptionUnsupported: "{name} ({id}) — ainda não suportado",
    refreshModels: "Atualizar modelos",
    loadingModels: "Carregando os modelos…",
    modelsError: "{error} Digite um id de modelo de {url}.",
    apiKey: "Chave de API",
    keyChecking: "Verificando o chaveiro…",
    keySaved: "Há uma chave salva",
    keyNone: "Nenhuma chave salva",
    keyUnavailable: "Chaveiro indisponível",
    keyReplacePlaceholder: "Digite uma nova chave para substituí-la",
    keyPastePlaceholder: "Cole a chave",
    saveKey: "Salvar chave",
    removeKey: "Remover chave",
    saveKeyFailed: "Não foi possível salvar a chave: {error}",
    removeKeyFailed: "Não foi possível remover a chave: {error}",
    assistantShortcut: "Atalho do assistente",
    shortcutInvalid: "Use Ctrl, Alt ou Meta com uma tecla.",
    shortcutTaken: "{shortcut} já é usado pelo PlexusTerm.",
    shortcutCapturing: "Pressione a nova combinação de teclas, ou Esc para mantê-la.",
    shortcutIdle: "Clique no campo para alterá-lo.",
  },
  about: {
    checkUpdates: "Procurar atualizações",
    checking: "Procurando atualizações…",
    upToDate: "O PlexusTerm está atualizado ({version}).",
    available: "O PlexusTerm {version} está disponível.",
    download: "Baixar",
    checkFailed: "Não foi possível procurar atualizações: {error}",
    checkAtStartup: "Procurar atualizações ao iniciar",
    checkHelp: "Pergunta ao GitHub pela última versão publicada quando o PlexusTerm inicia. Nada é baixado nem instalado: Baixar abre a página da versão.",
    version: "Versão {version}",
    description:
      "Um gerenciador de terminais e sessões remotas para Linux e Windows: shells locais, SSH, SFTP, túneis, serial, Telnet e Mosh em uma única janela.",
    credits: "Esquemas de cores do iTerm2-Color-Schemes (MIT) e de seus autores; veja os {notices}.",
    notices: "avisos de terceiros",
  },
};
