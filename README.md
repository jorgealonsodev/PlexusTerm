# NexusTerm

A Linux terminal and remote-session manager inspired by another app's feature set (clean-room; see `docs/reference/another app-feature-inventory.md`).

Stack: Tauri 2 (Rust backend) + React/TypeScript + xterm.js.

## Development

```bash
pnpm install
pnpm tauri dev                     # run the app
pnpm test                          # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
```

## SSH sessions

Open **SSH** (or Ctrl+Shift+S) and enter a host; the field also accepts `user@host:port`.
Authentication: password, private key file (`~/` is expanded, optional passphrase) or the running SSH agent (`SSH_AUTH_SOCK`).

Host keys are verified against `~/.ssh/known_hosts`, like OpenSSH:

- a known, matching key connects directly;
- an unknown host shows its SHA256 fingerprint and is only recorded after you choose **Trust and connect**;
- a key that differs from the recorded one is always refused. Remove the old entry with `ssh-keygen -R <host>` if the change is expected.

## Saved sessions

The **Sessions** panel on the left keeps SSH sessions in folders (`Prod/DB` style paths).
Use **New** / **Folder** or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name or host.

Sessions are stored in `~/.config/dev.nexusterm.app/sessions.json` (written atomically, mode `0600`).
Passwords and key passphrases are never saved: password sessions ask for it on every connection.
If the file cannot be read, the panel shows the error and disables editing so the file is never overwritten.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New local terminal tab |
| Ctrl+Shift+S | New SSH session (quick connect) |
| Ctrl+Shift+W | Close current tab |
| Middle click on a tab | Close that tab |
