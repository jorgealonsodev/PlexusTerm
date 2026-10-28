import type { macros as en } from "../en/macros";
import type { Messages } from "../types";

export const macros: Messages<typeof en> = {
  recording: {
    title: "マクロを記録中",
    warning: "パスワードを含め、入力内容はすべて保存されます",
    stop: "記録を停止",
  },
  name: {
    title: "記録したマクロを保存",
    recorded: {
      other: "{count} ステップを記録しました。マクロはプレーンテキストで保存されます。",
    },
    discard: "破棄",
  },
  progress: {
    running: "「{name}」を実行中: ステップ {step}/{total}",
    label: "マクロ {name} の進行状況",
  },
  panel: {
    title: "マクロ",
    new: "新規",
    search: "マクロを検索",
    readError:
      "保存済みマクロを読み込めませんでした: {message}。ファイルを保護するため、編集は無効になっています。",
    saveError: "マクロを保存できませんでした: {error}",
    empty: "マクロはまだありません。{shortcut} で記録するか、［新規］で作成してください。",
    emptyNoShortcut: "マクロはまだありません。［マクロを記録］ボタンで記録するか、［新規］で作成してください。",
    noMatch: "一致するマクロはありません。",
    steps: { other: "{count} ステップ" },
    editNamed: "{name} を編集",
    duplicate: "複製",
    duplicateNamed: "{name} を複製",
    deleteNamed: "{name} を削除",
    playNamed: "{name} を再生",
    play: "フォーカス中のターミナルで再生",
    hint: "マクロはフォーカス中のターミナルで再生されます。Ctrl+Alt+1–9 でそのキーに割り当てられたマクロを再生します。マクロはプレーンテキストで保存されます。",
  },
  edit: {
    newTitle: "新しいマクロ",
    editTitle: "マクロの編集",
    hotkey: "ホットキー",
    none: "なし",
    hotkeyUsed: "{hotkey} ({name})",
    variablesHint: "テキスト内の {{name}} はマクロを再生するたびに値を尋ねます。{{name:default}} は既定値を入力済みにし、{{{{ はそのままの {{ を入力します。",
    escapes:
      "テキスト内のエスケープ: \\r Enter、\\n、\\t、\\e Escape、\\\\、\\xHH、^C などの ^A–^Z 制御キー、^[ と ^?。",
    kindSend: "テキストを送信",
    kindWait: "待機",
    kindWaitFor: "テキストを待機",
    stepKind: "ステップ {n} の種類",
    stepMs: "ステップ {n} のミリ秒",
    stepText: "ステップ {n} のテキスト",
    sendPlaceholder: "例: ls -la\\r",
    waitForPlaceholder: "例: password:",
    stepTimeout: "ステップ {n} のタイムアウト (秒)",
    moveUp: "ステップ {n} を上へ移動",
    moveDown: "ステップ {n} を下へ移動",
    removeStep: "ステップ {n} を削除",
    noSteps: "ステップはまだありません。",
    addStep: "ステップを追加",
  },
  form: {
    nameRequired: "名前を入力してください。",
    invalidWait: "ステップ {n}: 待機時間は 0 から {max} までの整数 (ミリ秒) で指定してください。",
    waitForTextRequired: "ステップ {n}: 待機するテキストを入力してください。",
    invalidTimeout: "ステップ {n}: タイムアウトは 1 から {max} までの整数 (秒) で指定してください。",
  },
  file: {
    invalidJson: "マクロファイルが有効な JSON ではありません: {error}",
    unsupportedVersion: "サポートされていないマクロファイルのバージョンです",
    invalidMacros: "マクロファイルに無効なマクロがあります",
    duplicateHotkey: "マクロファイルに {hotkey} を使用するマクロが 2 つあります",
  },
  copyName: "{name} (コピー)",
  variables: {
    title: "「{name}」を再生",
    message: "値は今回の再生にのみ使われ、保存されません。",
    play: "再生",
  },
  player: {
    timedOut:
      "マクロ「{name}」はステップ {step}/{total} で停止しました。{seconds} 秒以内に「{text}」が表示されませんでした。",
  },
};
