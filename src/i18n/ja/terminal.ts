import type { terminal as en } from "../en/terminal";
import type { Messages } from "../types";

export const terminal: Messages<typeof en> = {
  find: {
    label: "ターミナル内を検索",
    placeholder: "検索",
    noMatches: "一致なし",
    matchCase: "大文字と小文字を区別",
    regexTitle: "正規表現",
    regex: "正規表現",
    previous: "前の一致",
    next: "次の一致",
    close: "検索を閉じる",
  },
  paste: {
    title: { other: "{count} 行を貼り付けますか？" },
    warning: "各行がコマンドとして実行される可能性があります。",
    dontAsk: "今後は確認しない",
    paste: "貼り付け",
  },
  menu: {
    askAi: "AI に質問",
    typeSelection: "プロンプトに入力",
    findSelection: "端末内を検索",
    openLink: "リンクを開く",
    paste: "貼り付け",
    selectAll: "すべて選択",
    clear: "スクロールバックを消去",
    find: "検索…",
    save: "出力をファイルに保存…",
    stopLogging: "ログ記録を停止",
    log: "ファイルにログを記録…",
  },
  view: {
    textFiles: "テキスト",
    connecting: "{target} に接続しています...",
    connectingVia: "{jumps} 経由で {target} に接続しています...",
    startingMosh: "SSH 経由で {target} の mosh-server を起動しています...",
    startingMoshVia: "SSH で {jumps} 経由で {target} の mosh-server を起動しています...",
    opening: "{target} を開いています...",
    telnetUnencrypted: "Telnet は暗号化されていません。",
    serialEnded: "セッションが終了しました。このタブを閉じるか、ポートをもう一度開いてください。",
    moshExited: "mosh-client が終了しました。このタブを閉じるか、セッションをもう一度開いてください。",
    moshExitedCode:
      "mosh-client がコード {code} で終了しました。このタブを閉じるか、セッションをもう一度開いてください。",
    clipboardError: "クリップボードを読み取れませんでした。",
    saveError: "出力を保存できませんでした: {error}",
    loggingStopped: "ログ記録を停止しました: {error}",
    hostKeyCancelled: "接続をキャンセルしました。ホストキーが信頼されていません。",
    cancelled: "接続をキャンセルしました。",
  },
};
