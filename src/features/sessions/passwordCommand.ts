import { isSshSession, type LibrarySession } from "./library";

/**
 * "Password from a command" (S5): an SSH login whose password, or a key's passphrase, is what a
 * password manager's command line prints. Sessions keep the command, never its output; the
 * backend runs it at every connection (`src-tauri/src/ssh/secret_command.rs`).
 */

/** Longest command line accepted; the backend refuses longer ones too (`MAX_COMMAND_LEN`). */
export const MAX_COMMAND_LENGTH = 2000;

export interface CommandPreset {
  label: string;
  /** A template: the words in capitals are to be replaced with the user's own. */
  command: string;
}

/** Templates for the usual password managers' command-line tools. */
export const PASSWORD_COMMAND_PRESETS: readonly CommandPreset[] = [
  { label: "1Password", command: 'op read "op://VAULT/ITEM/password"' },
  { label: "Bitwarden", command: "bw get password ITEM" },
  { label: "pass", command: "pass show PATH" },
  { label: "GNOME Keyring / libsecret", command: "secret-tool lookup service NAME" },
  { label: "KeePassXC", command: "keepassxc-cli show -s -a Password DATABASE ENTRY" },
];

/**
 * Every command `sessions` would run on this computer to get a password or passphrase, by session
 * name: the import preview lists them, so a file from someone else cannot hide one.
 */
export function passwordCommandsOf(sessions: LibrarySession[]): { name: string; command: string }[] {
  return sessions.filter(isSshSession).flatMap((session) => {
    const { auth } = session;
    if (auth.method === "passwordCommand") return [{ name: session.name, command: auth.command }];
    if (auth.method === "key" && auth.passphraseCommand) return [{ name: session.name, command: auth.passphraseCommand }];
    return [];
  });
}
