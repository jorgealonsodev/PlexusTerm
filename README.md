# NexusTerm

A Linux terminal and remote-session manager inspired by MobaXterm's feature set (clean-room; see `docs/reference/mobaxterm-feature-inventory.md`).

Stack: Tauri 2 (Rust backend) + React/TypeScript + xterm.js.

## Development

```bash
pnpm install
pnpm tauri dev                     # run the app
pnpm test                          # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
scripts/openssh-interop.sh         # SSH/SFTP against a real OpenSSH server (needs Docker)
```

`scripts/openssh-interop.sh` starts a disposable Alpine container with `sshd` and `sftp-server` bound to `127.0.0.1`, runs the ignored interoperability tests (host-key trust flow, key login, shell, resize, SFTP round trip, local tunnel) and removes the container.

## SSH sessions

Open **SSH** (or Ctrl+Shift+S) and enter a host; the field also accepts `user@host:port`.
Authentication: password, private key file (`~/` is expanded, optional passphrase) or the running SSH agent (`SSH_AUTH_SOCK`).

Host keys are verified against `~/.ssh/known_hosts`, like OpenSSH:

- a known, matching key connects directly;
- an unknown host shows its SHA256 fingerprint and is only recorded after you choose **Trust and connect**;
  if keys of another type are already recorded for that host, the dialog warns about it (the server may have changed its key type);
- a key that differs from the recorded one is always refused. Remove the old entry with `ssh-keygen -R <host>` if the change is expected.

Known limitations of the known_hosts parser (russh): `@revoked` / `@cert-authority` markers and wildcard patterns are not supported, and hostnames are matched case-sensitively; in those cases you get the unknown-host prompt instead of a silent connection.

## Serial consoles

Open **Serial** to connect to a serial console (USB-serial adapters such as `/dev/ttyUSB0`, CDC-ACM devices such as `/dev/ttyACM0`, on-board UARTs such as `/dev/ttyS0`).
The dialog lists the ports detected on this machine (**Refresh** scans again) and also accepts any device path typed by hand.

| Setting | Values | Default |
| --- | --- | --- |
| Baud rate | 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600 or a custom value | 115200 |
| Data bits | 5, 6, 7, 8 | 8 |
| Parity | None, Odd, Even | None |
| Stop bits | 1, 2 | 1 |
| Flow control | None, XON/XOFF (software), RTS/CTS (hardware) | None |

The tab is titled `<device> @ <baud>`. Keys are sent as typed (Enter sends CR) and resizing the window does not affect the device.
The app shortcuts (Ctrl+Shift+...) work the same in serial tabs and never reach the device.

- **Permission denied**: serial devices belong to the `dialout` group. Run `sudo usermod -aG dialout $USER`, then log out and back in.
- A missing device, or one already open in another program (or in another tab or pane), is reported in the tab.
- If the device disappears while open (USB adapter unplugged), the tab shows the error and the session ends; close the tab or open the port again.

Port detection reads `/sys/class/tty` and does not need libudev; it never opens the devices.

## Saved sessions

The **Sessions** panel on the left keeps SSH and serial sessions in folders (`Prod/DB` style paths).
Use **New** / **Folder** or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name, host or serial device.
The edit dialog has a **Session type** selector (SSH or Serial) that shows the matching fields. Serial sessions keep the device path and line settings and open directly, without any password.

Sessions are stored in `~/.config/dev.nexusterm.app/sessions.json` (written atomically, mode `0600`); each entry has a `kind` (`ssh` or `serial`), and entries written by earlier versions without it load as SSH sessions.
The file never contains passwords or key passphrases (see [Saved passwords](#saved-passwords)).
If the file cannot be read, the panel shows the error and disables editing so the file is never overwritten.

### Saved passwords

Password sessions ask for the password when you connect. For saved sessions (terminal tabs and tunnels) the prompt has a **Save password in the system keyring** checkbox, unchecked by default; quick-connect sessions never save passwords.

- Passwords are kept only in the system keyring through the Secret Service API (GNOME Keyring, KWallet), under the service `dev.nexusterm.app` with the session id as the account and the label `NexusTerm: user@host:port`. They are never written to `sessions.json` or `tunnels.json`.
- A password is saved only after a successful login. Later connections read it in the backend; it is never sent back to the user interface.
- If the saved password is missing or rejected, the prompt appears again with the checkbox ticked: a successful login replaces it, and unticking the checkbox deletes it.
- **Forget saved password** in the session's edit dialog deletes it; deleting a session, or a folder containing it, deletes it too.
- Without a Secret Service the checkbox is disabled and passwords are asked on every connection.
- Key passphrases are never saved.

### Import from MobaXterm

**Import** in the Sessions panel reads a `MobaXterm.ini` file (UTF-8, or the Windows-1252 code page MobaXterm usually writes) and shows a preview before anything is saved:

- SSH sessions from the `[Bookmarks]` / `[Bookmarks_N]` sections are imported with their host, port (22 when missing or invalid) and username, under a **MobaXterm** folder that keeps their MobaXterm folder path.
- Imported sessions use password authentication; change it later with **Edit**. Private key paths are not imported.
- Other session types (Telnet, RDP, VNC, Serial, WSL, FTP, ...), SSH entries without a host and unrecognized lines are skipped and counted per type in the preview.
- Sessions already saved with the same folder, name, host, port and username are skipped as duplicates.
- Passwords are never imported: the `[Passwords]` section and any other section are not read.

## SFTP browser

The sidebar has three tabs, **Sessions**, **SFTP** and **Tunnels**. SFTP browses the remote files of the active SSH tab (its focused pane) over the same connection (it is disabled for local terminals) and opens automatically when an SSH session connects.

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- Double-click a folder to open it, or a file to download it (a save dialog asks where).
- **Upload** picks one or more local files; dropping files from the desktop onto the panel uploads them too. Both go into the current folder.
- **New folder**, **Rename**, **Delete** (asks for confirmation; only empty folders can be deleted) and **Download** act on the selected entry.

With **Follow terminal folder** on (the default), the browser follows the shell's working directory. This needs the remote shell to report it with an OSC 7 sequence; for bash, add this to the remote `~/.bashrc`:

```bash
PROMPT_COMMAND='printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"'
```

Paths containing special characters may need percent-encoding; many distributions' `vte.sh` already emit OSC 7 that way.

## SSH tunnels

The **Tunnels** tab of the sidebar keeps port forwards that run over a saved SSH session, each with its own connection:

- **Local (-L)**: listens on this machine and forwards each connection through the server to the destination (as seen from the server).
- **Remote (-R)**: the server listens on the port and forwards each connection back to the destination as seen from this machine.
- **Dynamic (-D)**: a SOCKS5 proxy on this machine (no authentication, CONNECT only, IPv4/IPv6/domain targets); the server opens the connections. A client that does not finish the SOCKS handshake within 10 seconds is disconnected.

Listeners bind to `127.0.0.1` by default; any other address must be typed explicitly and the editor warns that other machines can reach it.
Each tunnel shows its status (stopped, starting, running, or the error) and a Start/Stop toggle; **Start all** and **Stop all** act on every tunnel.
Starting a tunnel whose session uses a password uses the password saved in the keyring or asks for it (see [Saved passwords](#saved-passwords)), and an unknown host asks to trust its fingerprint like SSH tabs do. A tunnel deleted or changed while one of these prompts is open is not started.
Stopping closes the listener, the open connections and the SSH connection; running tunnels stop when the app exits.

Tunnels are stored in `~/.config/dev.nexusterm.app/tunnels.json` with the same rules as sessions (atomic, mode `0600`, no secrets, editing disabled if the file cannot be read).

## Split panes and multi-execution

**Split right** (Ctrl+Shift+D) and **Split down** (Ctrl+Shift+E) divide the focused pane of the current tab in two, up to 4 panes per tab.
The new pane opens another terminal for the same target: a local shell, or a new SSH connection to the same host that reuses the credentials the tab already holds in memory (nothing new is stored).
Drag the divider between two panes to resize them (each side keeps at least 15%). The focused pane has an accent border; click a pane or use Alt+Arrow to move the focus.
Ctrl+Shift+W, or the shell exiting, closes only that pane; the tab closes with its last pane.

**Multi-exec** (Ctrl+Shift+M) sends what you type in the focused pane to every other open terminal pane, in every tab. A banner shows how many terminals receive the input and has a **Turn off** button.
While it is on, each pane shows an **exclude** toggle in its top-right corner to leave that pane out; panes that are still connecting do not receive input either. Typing in an excluded pane only reaches that pane.
Multi-execution is off when the app starts and is never saved.

The SFTP browser and **Follow terminal folder** use the focused pane of the active tab.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New local terminal tab |
| Ctrl+Shift+S | New SSH session (quick connect) |
| Ctrl+Shift+D | Split the focused pane right |
| Ctrl+Shift+E | Split the focused pane down |
| Ctrl+Shift+W | Close the focused pane (the tab closes with its last pane) |
| Alt+Arrow | Move the focus to the neighbouring pane |
| Ctrl+Shift+M | Turn multi-execution on or off |
| Middle click on a tab | Close that tab |

These shortcuts are handled by the app and never reach the shell.
