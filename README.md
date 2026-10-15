# NexusTerm

A Linux terminal and remote-session manager inspired by another app's feature set (clean-room; see `docs/reference/another app-feature-inventory.md`).

Stack: Tauri 2 (Rust backend) + React/TypeScript + xterm.js.

## Development

```bash
pnpm install
pnpm tauri dev                     # run the app
pnpm test                          # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
scripts/openssh-interop.sh         # SSH/SFTP against a real OpenSSH server (needs Docker)
```

`scripts/openssh-interop.sh` starts a disposable Alpine container with `sshd` and `sftp-server` bound to `127.0.0.1`, runs the ignored interoperability tests (host-key trust flow, key login, shell, resize, SFTP round trip) and removes the container.

## SSH sessions

Open **SSH** (or Ctrl+Shift+S) and enter a host; the field also accepts `user@host:port`.
Authentication: password, private key file (`~/` is expanded, optional passphrase) or the running SSH agent (`SSH_AUTH_SOCK`).

Host keys are verified against `~/.ssh/known_hosts`, like OpenSSH:

- a known, matching key connects directly;
- an unknown host shows its SHA256 fingerprint and is only recorded after you choose **Trust and connect**;
  if keys of another type are already recorded for that host, the dialog warns about it (the server may have changed its key type);
- a key that differs from the recorded one is always refused. Remove the old entry with `ssh-keygen -R <host>` if the change is expected.

Known limitations of the known_hosts parser (russh): `@revoked` / `@cert-authority` markers and wildcard patterns are not supported, and hostnames are matched case-sensitively; in those cases you get the unknown-host prompt instead of a silent connection.

## Saved sessions

The **Sessions** panel on the left keeps SSH sessions in folders (`Prod/DB` style paths).
Use **New** / **Folder** or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name or host.

Sessions are stored in `~/.config/dev.nexusterm.app/sessions.json` (written atomically, mode `0600`).
Passwords and key passphrases are never saved: password sessions ask for it on every connection.
If the file cannot be read, the panel shows the error and disables editing so the file is never overwritten.

## SFTP browser

The sidebar has two tabs, **Sessions** and **SFTP**. SFTP browses the remote files of the active SSH tab over the same connection (it is disabled for local terminals) and opens automatically when an SSH session connects.

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- Double-click a folder to open it, or a file to download it (a save dialog asks where).
- **Upload** picks one or more local files; dropping files from the desktop onto the panel uploads them too. Both go into the current folder.
- **New folder**, **Rename**, **Delete** (asks for confirmation; only empty folders can be deleted) and **Download** act on the selected entry.

With **Follow terminal folder** on (the default), the browser follows the shell's working directory. This needs the remote shell to report it with an OSC 7 sequence; for bash, add this to the remote `~/.bashrc`:

```bash
PROMPT_COMMAND='printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"'
```

Paths containing special characters may need percent-encoding; many distributions' `vte.sh` already emit OSC 7 that way.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New local terminal tab |
| Ctrl+Shift+S | New SSH session (quick connect) |
| Ctrl+Shift+W | Close current tab |
| Middle click on a tab | Close that tab |
