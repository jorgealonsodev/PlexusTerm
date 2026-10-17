import type { settings as en } from "../en/settings";
import type { Messages } from "../types";

export const settings: Messages<typeof en> = {
  language: {
    label: "言語",
    system: "システム",
  },
  dialog: {
    title: "設定",
    sections: "設定のセクション",
  },
  sections: {
    appearance: "外観",
    terminal: "ターミナル",
    ssh: "SSH",
    files: "ファイル",
    ai: "AI",
    about: "バージョン情報",
  },
  appearance: {
    colourScheme: "配色",
    dark: "ダーク",
    light: "ライト",
    preview: "{name} のプレビュー",
    fontFamily: "フォント",
    fontSize: "フォントサイズ",
    fontHelp:
      "Ctrl+= / Ctrl+- / Ctrl+0 でフォントサイズを変更できます。アイコンを描画するプロンプトテーマ (Powerlevel10k、agnoster、Starship) には、フォントに Nerd Font を指定する必要があります。",
    hideSidebar: "折りたたみ時にサイドバーを完全に隠す",
    sidebarHelp:
      "Ctrl+Shift+B またはツールバーのボタンで、サイドバーをタブアイコンだけに折りたたみます。このオプションを有効にすると完全に隠します。",
  },
  terminal: {
    shell: "ローカル端末のシェル",
    shellDefault: "システムの既定",
    shellDefaultNamed: "システムの既定 ({name})",
    shellOther: "その他…",
    shellProgram: "プログラム",
    shellArgs: "引数",
    chooseShell: "シェルを選択",
    shellHelp: "新しいローカル端末はこのシェルで開きます。引数はスペースで区切ります。スペースを含む引数は引用符で囲んでください。",
    copyOnSelect: "選択時にコピー",
    rightClickPastes: "右クリックで貼り付け",
    confirmMultilinePaste: "複数行の貼り付けを確認",
    rightClickHelp: "右クリックで貼り付ける場合、Ctrl+右クリックでターミナルメニューを開きます。",
  },
  ssh: {
    remoteMonitor: "リモートモニターバー (SSH タブ)",
    remoteMonitorHelp:
      "各 SSH ペインの下に、サーバーの CPU、メモリ、ディスク、ネットワーク、ユーザーを表示するバーです。同じ接続を通じて取得します。［ツール］からも利用できます。",
  },
  files: {
    textEditor: "テキストエディター",
    systemDefault: "システムの既定",
    useSystemDefault: "システムの既定を使用",
    chooseEditor: "テキストエディターを選択",
    textEditorHelp:
      "SFTP ブラウザーのファイルを開くテキストエディターです。プログラム、または {command} のようなコマンドを指定します。空欄にするとシステムの既定を使用します。",
  },
  ai: {
    inlineSuggestions: "インライン候補",
    inlineSuggestionsHelp:
      "入力中に、コマンドの残りの部分をグレーで候補表示します。右矢印キーまたは End で確定し、Ctrl+右矢印キーで 1 単語ずつ確定します。",
    commandHistory: "コマンド履歴",
    clearHistory: "履歴を消去",
    historyCleared: "履歴を消去しました。",
    historyClearFailed: "履歴を消去できませんでした: {error}",
    historyHelp:
      "実行したコマンドは、再度候補として表示するために、ホストごとにこのコンピューターに保存されます。スペースで始まる行、パスワード、全画面プログラムは記録されません。",
    aiSuggestions: "AI 候補",
    aiSuggestionsHelp:
      "履歴に候補がない場合、AI プロバイダーに問い合わせます。送信されるのは入力中の行、現在のフォルダー、直近の履歴コマンドのみで、ターミナルの出力は送信されません。",
    provider: "プロバイダー",
    openCodeGoNote:
      "OpenCode Go はコーディングエージェント向けで、トラフィックを監視しています。インライン AI 候補は短いリクエストを多数送信します。",
    baseUrl: "ベース URL",
    model: "モデル",
    historyContext: "コンテキストとして送信する履歴コマンド数",
    chooseModel: "モデルを選択",
    modelOption: "{name} ({id})",
    modelOptionUnsupported: "{name} ({id}) — 未対応",
    refreshModels: "モデルを更新",
    loadingModels: "モデルを読み込んでいます…",
    modelsError: "{error} {url} のモデル ID を入力してください。",
    apiKey: "API キー",
    keyChecking: "キーリングを確認しています…",
    keySaved: "キーは保存済みです",
    keyNone: "キーは保存されていません",
    keyUnavailable: "キーリングを利用できません",
    keyReplacePlaceholder: "置き換えるには新しいキーを入力",
    keyPastePlaceholder: "キーを貼り付け",
    saveKey: "キーを保存",
    removeKey: "キーを削除",
    saveKeyFailed: "キーを保存できませんでした: {error}",
    removeKeyFailed: "キーを削除できませんでした: {error}",
    assistantShortcut: "アシスタントのショートカット",
    shortcutInvalid: "Ctrl、Alt、Meta のいずれかとキーを組み合わせてください。",
    shortcutTaken: "{shortcut} はすでに PlexusTerm で使用されています。",
    shortcutCapturing: "新しいキーの組み合わせを押してください。Escape で現在の設定を維持します。",
    shortcutIdle: "クリックして変更します。",
  },
  about: {
    checkUpdates: "更新を確認",
    checking: "更新を確認しています…",
    upToDate: "PlexusTerm は最新です ({version})。",
    available: "PlexusTerm {version} が利用可能です。",
    download: "ダウンロード",
    checkFailed: "更新を確認できませんでした: {error}",
    checkAtStartup: "起動時に更新を確認",
    checkHelp: "PlexusTerm の起動時に GitHub で最新の公開リリースを確認します。何もダウンロード・インストールしません。ダウンロードはリリースページを開きます。",
    version: "バージョン {version}",
    description:
      "Linux と Windows 向けのターミナル兼リモートセッションマネージャーです。ローカルシェル、SSH、SFTP、トンネル、シリアル、Telnet、Mosh を 1 つのウィンドウで利用できます。",
    credits: "配色は iTerm2-Color-Schemes (MIT) とその作者によるものです。詳しくは{notices}をご覧ください。",
    notices: "サードパーティに関する通知",
  },
};
