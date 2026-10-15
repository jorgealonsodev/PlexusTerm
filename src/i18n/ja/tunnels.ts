import type { tunnels as en } from "../en/tunnels";
import type { Messages } from "../types";

export const tunnels: Messages<typeof en> = {
  types: {
    local: "ローカル (-L)",
    remote: "リモート (-R)",
    dynamic: "ダイナミック SOCKS5 (-D)",
  },
  panel: {
    title: "SSH トンネル",
    new: "新規",
    startAll: "すべて開始",
    stopAll: "すべて停止",
    readError:
      "保存済みトンネルを読み込めませんでした: {message}。ファイルを保護するため、編集は無効になっています。",
    saveError: "トンネルを保存できませんでした: {error}",
    empty: "トンネルはまだありません。",
    missingSession: "セッションがありません",
    via: "{session} 経由の {tunnel}",
    hint: "別のアドレスを選択しない限り、トンネルは 127.0.0.1 で待ち受けます。",
  },
  state: {
    stopped: "停止",
    starting: "開始中…",
    running: "実行中",
    error: "エラー",
  },
  edit: {
    newTitle: "新しい SSH トンネル",
    editTitle: "トンネルの編集",
    namePlaceholder: "ポートから自動生成",
    type: "種類",
    sshSession: "SSH セッション",
    chooseSession: "保存済みセッションを選択…",
    noSessions: "先に SSH セッションを保存してください。トンネルはその接続を使用します。",
    listenAddressServer: "サーバー側の待ち受けアドレス",
    listenAddress: "待ち受けアドレス",
    exposedRemote:
      "{host} で待ち受けると、他のマシンからサーバーのポートに接続できるようになります。非公開にするには 127.0.0.1 を使用してください。",
    exposedLocal:
      "{host} で待ち受けると、他のマシンがこのトンネルを使用できるようになります。非公開にするには 127.0.0.1 を使用してください。",
    destinationFromHere: "接続先 (このマシンから)",
    destinationFromServer: "接続先 (サーバーから)",
    dynamicHint: "アプリケーションはこのポートを SOCKS5 プロキシとして使用し、接続はサーバーが確立します。",
  },
  form: {
    chooseSession: "保存済み SSH セッションを選択してください",
    invalidListenPort: "待ち受けポートは 1 から 65535 までの数値で指定してください",
    destHostRequired: "接続先ホストは必須です",
    invalidDestPort: "接続先ポートは 1 から 65535 までの数値で指定してください",
  },
  file: {
    invalidJson: "トンネルファイルが有効な JSON ではありません: {error}",
    unsupportedVersion: "サポートされていないトンネルファイルのバージョンです",
    invalidTunnels: "トンネルファイルに無効なトンネルがあります",
  },
  launcher: {
    sessionGone: "保存済みセッションが存在しません。トンネルを編集して別のセッションを選択してください。",
    startFailed: "トンネルを開始できませんでした: {error}",
  },
};
