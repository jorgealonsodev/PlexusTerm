# PlexusTerm user guide

How each feature works, its limits and where its data is stored. For installing, see the [README](../README.md#install).

| Section | Covers |
| --- | --- |
| [SSH sessions](#ssh-sessions) | Quick connect, authentication, host-key checks |
| [Serial consoles](#serial-consoles) | Ports, line settings, permissions |
| [Telnet and Mosh](#telnet-and-mosh) | Built-in Telnet client, Mosh over SSH |
| [Saved sessions](#saved-sessions) | Folders, saved passwords, jump hosts, another app import |
| [SFTP browser](#sftp-browser) | Remote files of the active SSH tab |
| [SSH tunnels](#ssh-tunnels) | Local, remote and dynamic (SOCKS5) forwards |
| [Split panes and multi-execution](#split-panes-and-multi-execution) | Panes, typing into several terminals |
| [Terminal settings](#terminal-settings) | Colour schemes, font, copy and paste, find, saving and logging output |
| [Macros](#macros) | Recording and playing keystroke sequences |
| [Tools](#tools) | SSH key generator, port and network scanners, Wake On LAN, remote monitor |
| [Windows](#windows) | What differs on Windows 10/11 |
| [Keyboard shortcuts](#keyboard-shortcuts) | Every shortcut |

## SSH sessions

Open **SSH** (or Ctrl+Shift+S) and enter a host; the field also accepts `user@host:port`.
Authentication: password, private key file (`~/` is expanded, optional passphrase) or the running SSH agent (`SSH_AUTH_SOCK`).

Password logins (terminal tabs, SFTP, tunnels, jump hosts and the Mosh login) first try your keys, like OpenSSH: the keys of the SSH agent, then the default files `~/.ssh/id_ed25519`, `~/.ssh/id_ecdsa` and `~/.ssh/id_rsa`, at most 5 keys in all. Only unencrypted files are tried; a passphrase-protected one is skipped without asking unless the agent holds it. The password is sent only when the server rejects every key. If the server closes the connection after too many rejected keys, PlexusTerm reconnects once and tries only the password. When a key logs in, a typed password is never checked, so it is not saved in the keyring.

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

## Telnet and Mosh

The toolbar **More** menu opens **Telnet…** and **Mosh…** quick-connect dialogs; both can also be saved as sessions (see [Saved sessions](#saved-sessions)).

**Telnet** uses a built-in client (host, port 23 by default, 15 s connect timeout).

- Telnet is not encrypted: everything typed, passwords included, crosses the network in clear text. The tab starts with a yellow "Telnet is not encrypted." line.
- Option negotiation: the server may enable ECHO and SUPPRESS-GO-AHEAD; PlexusTerm offers TERMINAL-TYPE (`xterm-256color`) and the window size (NAWS, sent again on every resize) and refuses every other option.
- Enter is sent as CR NUL (a bare carriage return as RFC 854 requires); byte 255 is escaped in what you type and Telnet commands never reach the terminal.

**Mosh** keeps a session alive across roaming, sleep and flaky links. It logs in with a saved SSH session (its key, agent or password, saved keyring password and jump hosts all apply), runs `mosh-server new -s -c 256 -l LANG=en_US.UTF-8` there (override it per session with **Server command**), closes the SSH connection and starts the local `mosh-client` in the tab.

- Requirements: mosh installed on both machines (`sudo apt install mosh`), and UDP ports 60000-61000 on the server reachable from this machine (open them in the server's firewall). Jump hosts are only used for the SSH login: the UDP traffic goes straight to the server's address.
- The Mosh session key reaches `mosh-client` only through its environment (`MOSH_KEY`): never on its command line, in a log or in the user interface.
- `mosh-client not found — install mosh` means mosh is missing on this machine; `mosh-server not found on the server — install mosh there` means it is missing on the server. If `mosh-client` fails, the tab stays open with its message and exit code.

## Saved sessions

Confirmations and questions (deleting sessions, folders, tunnels and macros, naming a new folder, the SFTP actions) open in PlexusTerm's own dialogs: Enter submits a typed name and presses the focused button of a confirmation, Escape cancels, and Cancel has the focus when the action deletes something. Cancelling never performs the action.

The **Sessions** panel on the left keeps SSH, serial, Telnet and Mosh sessions in folders (`Prod/DB` style paths).
Use **New** / **Folder** or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name, host or serial device.
Right-click a session for **Connect**, **Edit…**, **Duplicate** (a copy named "<name> (copy)" next to it; a saved keyring password is not copied) and **Delete**. Right-click a folder for **New session here…**, **New folder here…**, **Connect all** (every session in it and its subfolders, each in its own tab) and **Delete folder**. While the sessions file cannot be read, the menus only offer connecting.
The edit dialog has a **Session type** selector (SSH, Serial, Telnet or Mosh) that shows the matching fields. Serial sessions keep the device path and line settings and Telnet sessions the host and port; both open directly, without any password. Mosh sessions name the saved SSH session they log in with and an optional server command.

Sessions are stored in `~/.config/dev.plexusterm.app/sessions.json` (written atomically, mode `0600`); each entry has a `kind` (`ssh`, `serial`, `telnet` or `mosh`), and entries written by earlier versions without it load as SSH sessions.
The file never contains passwords or key passphrases (see [Saved passwords](#saved-passwords)).
If the file cannot be read, the panel shows the error and disables editing so the file is never overwritten.

### Saved passwords

Saved password sessions (terminal tabs, Mosh and tunnels) connect first: PlexusTerm tries your keys (see [SSH sessions](#ssh-sessions)), then the password saved in the keyring, and asks for the password only when the server still needs it. That prompt has a **Save password in the system keyring** checkbox, unchecked by default. Quick-connect sessions take the password in the connect dialog and never save it. **Install** in the SSH key generator still asks before connecting.

- Passwords are kept only in the system keyring through the Secret Service API (GNOME Keyring, KWallet), under the service `dev.plexusterm.app` with the session id as the account and the label `PlexusTerm: user@host:port`. They are never written to `sessions.json` or `tunnels.json`.
- A password is saved only after a successful login. Later connections read it in the backend; it is never sent back to the user interface.
- A saved password is bound to the `user@host:port` it was typed for and is only ever sent there. Changing the host, port or username of a session (or switching it away from password authentication) forgets the saved password; passwords saved by earlier versions, which carry no such binding, are asked again once.
- If the keyring cannot save or delete the password (for example because it is locked and does not answer within 10 seconds), the connection still opens and a warning is shown: a yellow line in the terminal tab, or a note under the tunnel.
- If the saved password is rejected, the prompt appears with the checkbox ticked: a successful login replaces it, and unticking the checkbox deletes it. If no usable password is saved, the prompt appears unticked, like a first login.
- **Forget saved password** in the session's edit dialog deletes it; deleting a session, or a folder containing it, deletes it too.
- Without a Secret Service the checkbox is disabled and passwords are asked on every connection.
- Key passphrases are never saved.

### Jump hosts

A saved SSH session can reach its server through up to 3 jump hosts (bastions), like `ssh -J`. In the session's edit dialog, **Jump hosts** lists other saved SSH sessions in the order they are crossed: add them from the list, move them up or down, or remove them. Quick-connect sessions have no jump hosts.

- PlexusTerm logs into the first jump host, opens a forwarded connection from it to the next host's address and port, logs into that one, and so on until the session's own server. Each host is reached from the previous one, so its address must make sense there (e.g. a private IP behind the bastion).
- Every host is checked against `~/.ssh/known_hosts` with its own address and port; an unknown jump host shows the trust prompt naming it ("bastion — jump host 1 of 2").
- Every host logs in with its own saved session's method (key, agent or password). Password hosts try your keys first, then the password saved in the keyring; a host that still needs a password is asked while connecting, one at a time ("Password for bastion — jump host 1 of 2"), each prompt with its own **Save password in the system keyring** checkbox.
- If a jump host has its own jump hosts, they are crossed first. A session cannot be its own jump host, and chains with cycles, repeated sessions, more than 3 hosts in total, or deleted or non-SSH jump sessions are refused with an error.
- Errors name the host that failed, e.g. `via bastion (jump host 1): authentication failed`.
- The SFTP browser of the tab uses the same connection, and SSH tunnels whose session has jump hosts go through them too. Closing the tab (or stopping the tunnel) closes every connection of the chain.
- Deleting a session that other sessions use as a jump host asks for confirmation and removes it from their jump hosts.

### Import from another app

**Import** in the Sessions panel reads a `sessions.ini` file (UTF-8, or the Windows-1252 code page another app usually writes) and shows a preview before anything is saved:

- SSH sessions from the `[Bookmarks]` / `[Bookmarks_N]` sections are imported with their host, port (22 when missing or invalid) and username, and Telnet sessions with their host and port (23 when missing or invalid), under a **Imported** folder that keeps the folder path saved in the file.
- Imported SSH sessions use password authentication; change it later with **Edit**. Private key paths are not imported.
- Other session types (RDP, VNC, Serial, WSL, FTP, ...), entries without a host and unrecognized lines are skipped and counted per type in the preview.
- Sessions already saved with the same type, folder, name, host, port and username are skipped as duplicates.
- Passwords are never imported: the `[Passwords]` section and any other section are not read.

## SFTP browser

The sidebar has three tabs, **Sessions**, **SFTP** and **Tunnels**. SFTP browses the remote files of the active SSH tab (its focused pane) over the same connection (it is disabled for local terminals) and opens automatically when an SSH session connects.

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- Double-click a folder to open it, or a file to download it (a save dialog asks where).
- **Upload** picks one or more local files; dropping files from the desktop onto the panel uploads them too. Both go into the current folder.
- **New folder**, **New file** (an empty file; an existing one is never replaced), **Rename**, **Delete** (asks for confirmation; only empty folders can be deleted) and **Download** act on the selected entry.

Right-click an entry for more:

- **Open** (enters a folder; opens a file in its default program, like **Open with default program** below), **Download…**, **Rename…**, **Delete**.
- **Copy file path** copies the full remote path; **Copy file path to terminal** types it into the focused pane of the active tab, quoted for the shell when needed. Middle-clicking an entry does the same.
- **Properties** shows the name, path, type, size, modification time, owner, group and permissions (`rwxr-xr-x (0755)`).
- **Permissions…** changes the mode (`chmod`) with read/write/execute checkboxes for owner, group and others, kept in sync with the octal value.
- For files: **Open with default text editor** (the **Text editor** chosen in [Settings](#terminal-settings), or the system's default one), **Open with default program**, **Open with…** (choose a program) and **Compare file with…** (choose a local file; opens both in Meld, KDiff3, Kompare or Visual Studio Code, the first one installed). The open options download the file to a private temporary folder and watch it: each time the copy is saved, PlexusTerm asks the first time whether to upload it to the same remote path, then uploads it and reports the result. The temporary copies are deleted when the SSH session closes.

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
Starting a tunnel whose session uses a password tries your keys, then the password saved in the keyring, and asks for the password only if the server still needs it (see [Saved passwords](#saved-passwords)), and an unknown host asks to trust its fingerprint like SSH tabs do. A tunnel deleted or changed while one of these prompts is open is not started.
Stopping closes the listener, the open connections and the SSH connection; running tunnels stop when the app exits.

Tunnels are stored in `~/.config/dev.plexusterm.app/tunnels.json` with the same rules as sessions (atomic, mode `0600`, no secrets, editing disabled if the file cannot be read).

## Split panes and multi-execution

**Split right** (Ctrl+Shift+D) and **Split down** (Ctrl+Shift+E) divide the focused pane of the current tab in two, up to 4 panes per tab.
The new pane opens another terminal for the same target: a local shell, or a new SSH connection to the same host that reuses the credentials the tab already holds in memory (nothing new is stored).
Drag the divider between two panes to resize them (each side keeps at least 15%). The focused pane has an accent border; click a pane or use Alt+Arrow to move the focus.
Ctrl+Shift+W, or the shell exiting, closes only that pane; the tab closes with its last pane. While a tab is split, moving the pointer over a pane shows a **×** in its top-right corner that closes that pane.

**Multi-exec** (Ctrl+Shift+M) sends what you type in the focused pane to every other open terminal pane, in every tab. A banner shows how many terminals receive the input and has a **Turn off** button.
While it is on, each pane shows an **exclude** toggle in its top-right corner to leave that pane out; panes that are still connecting do not receive input either. Typing in an excluded pane only reaches that pane.
Multi-execution is off when the app starts and is never saved.

The SFTP browser and **Follow terminal folder** use the focused pane of the active tab.

## Terminal settings

The gear button at the right of the toolbar opens **Settings**, shared by every tab and saved in `settings.json` in the app config directory. A side menu splits it into **Appearance** (colour scheme, font family and size), **Terminal** (copy and paste), **SSH** (remote monitor bar), **Files** (text editor), **AI** (command suggestions, history and AI provider, see [Command suggestions](#command-suggestions)) and **About** (version and project links); **Save** keeps the changes of every section:

- **Font size** (8-32, default 14). Ctrl+= / Ctrl+- / Ctrl+0 change it too; every terminal follows at once.
- **Font family** (default `"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`): one installed font name, such as `Hack Nerd Font`, or a CSS font list. A single name falls back to the system monospace font when it is not installed; leaving the field empty restores the default.
- **Colour scheme** (default Catppuccin Mocha): 57 schemes grouped as Dark and Light, with a preview of the prompt, file colours and the 12 accent colours before saving. Every terminal and the rest of the window switch at once, without restarting any session.

| Family | Schemes |
| --- | --- |
| Catppuccin | Mocha, Macchiato, Frappé, Latte |
| Tokyo Night | Tokyo Night, Storm, Light |
| Gruvbox | Dark, Light, Material Dark |
| Nord | Nord, Nord Light |
| Rosé Pine | Rosé Pine, Moon, Dawn |
| Everforest | Dark, Light |
| Kanagawa | Wave, Dragon |
| Ayu | Dark, Mirage, Light |
| GitHub | Dark, Dark Default, Light, Dimmed |
| Material | Dark, Ocean |
| Atom One / One Half | Atom One Dark, Atom One Light, One Half Dark, One Half Light |
| Solarized / Tango | Solarized Dark, Solarized Light, Tango Dark, Tango Light |
| Tomorrow | Tomorrow Night, Night Eighties, Night Bright, Tomorrow |
| Monokai | Monokai, Monokai Soda |
| Others | PlexusTerm, Dracula, Afterglow, Adventure Time, AlienBlood, Andromeda, Argonaut, Blue Matrix, 3024 Night, 3024 Day, JetBrains Darcula, Jellybeans, Red Sands, Retro, Laser |

The palettes come from iTerm2-Color-Schemes (MIT); [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) credits each scheme's author and original project. The whole window follows the colour scheme, like an editor theme: the toolbar, sidebar, tabs and dialogs take their background, text and accent colours from it, and light schemes switch the window and the logo to their light versions.

Shell prompt themes (Starship, Powerlevel10k, Pure, Oh My Zsh themes such as `robbyrussell` or `agnoster`) are configured in the shell, on the machine where it runs (`~/.zshrc`, `~/.config/starship.toml`), not in PlexusTerm. Their colours follow the colour scheme. Themes that draw icons or powerline arrows need a [Nerd Font](https://www.nerdfonts.com/) installed on this machine and set as the font family.
- **Copy on select** (on by default): selecting text with the mouse copies it to the clipboard.
- **Right click pastes** (on by default). When it is off, right click opens the terminal menu; Ctrl+right click always opens it.
- **Confirm multi-line paste** (on by default): pasting more than one line shows the line count and the first lines before anything is sent. **Don't ask again** turns it off.
- **Text editor** (default: empty, the system default text editor): the program **Open with default text editor** uses in the SFTP browser. **Browse…** picks a program; you can also type a command with arguments, such as `code --wait` or `"/opt/My Editor/editor" -n`. The file is added as the last argument, or in place of `%f` when the command has one. The command runs directly, never through a shell, and a path to an existing program counts as one program even when it contains spaces. **Use system default** empties the field. A value that is not text or is longer than 1024 characters loads as the system default.

Pasted text is sent like typed text, so multi-exec forwards it too, and shells that support bracketed paste receive it as a paste.

The terminal menu has **Copy**, **Paste**, **Select all**, **Clear scrollback**, **Find…** (Ctrl+Shift+F: next/previous, match case, regex; Escape closes it), **Save output to file…** (the whole scrollback of that pane as plain text) and **Log to file…**.
Logging appends everything the pane receives from then on to the chosen file, without colours or other escape sequences, until **Stop logging** or the pane closes. Tabs being logged show a red dot.

### Command suggestions

While you type a command in any terminal pane (local, SSH, Telnet, Mosh or serial), PlexusTerm draws the rest of a command you ran before in grey after the cursor. Suggestions come from your own command history, so they work with no AI configured: commands of the same host first, then those of every host, the most recent and most often used first.

- **Right Arrow** or **End**, with the cursor at the end of the line, accepts the whole suggestion; **Ctrl+Right** accepts its next word. The accepted text is sent as if typed, so multi-execution and macro recording see it too.
- Every other key reaches the shell as usual: **Tab** stays the shell's own completion.
- Suggestions pause until the next Enter once PlexusTerm can no longer be sure what the line holds: after Up/Down (shell history), Ctrl+R, Tab completion, the left arrow or other cursor keys, Alt shortcuts, or a paste with several lines. They are also hidden in full-screen programs (vim, less, top), at password and passphrase prompts, while the pane is scrolled back or not focused, and when the shell draws something after the cursor (a right-hand prompt, or another autosuggestion plugin).

Every command sent with Enter is recorded on this computer in `history.json` in the app config directory (readable only by you), per host (`user@host:port` for SSH and Mosh, `telnet:host:port`, `serial:device`, `local`), without duplicates and capped at 2000 commands per host and 200 hosts. Never recorded: lines starting with a space, anything typed at a password or passphrase prompt, anything typed in a full-screen program, and commands that reach a pane only through multi-execution.

The **AI** section of Settings holds:

- **Inline suggestions** (on by default): the grey suggestions above.
- **Command history** (on by default): records commands and suggests from them. **Clear history** empties `history.json` at once.
- **AI suggestions** (off by default): when the history has nothing for the typed line, ask the AI provider after a short pause in typing. Only the typed line, the current folder (when the shell reports it) and the host's last history commands are sent, never the terminal output, and nothing typed at a password prompt.
- **Provider**: Anthropic, Gemini, OpenAI or OpenAI-compatible; **Base URL** for an OpenAI-compatible endpoint (for example `http://localhost:11434/v1` for Ollama).
- **Model** (Anthropic: `claude-opus-5-5`, Gemini: `gemini-3.5-flash-lite`, OpenAI and compatible: fill in your model). Changing the provider while the model is still a provider default switches it to the new provider's default.
- **API key**: stored in the system keyring, one per provider. The field only shows whether a key is saved; **Save key** and **Remove key** apply at once.
- **History commands sent as context** (0-20, default 5).
- **Assistant shortcut** (default Ctrl+Shift+Space): click the field and press the new combination; Escape keeps the current one. It needs Ctrl, Alt or Meta, and combinations PlexusTerm already uses are refused.

## Macros

A macro is a named list of steps played into the focused pane of the active tab:

- **Send text**: sent as if typed, so multi-exec forwards it too.
- **Wait**: pauses for a number of milliseconds.
- **Wait for text**: waits until the pane's output contains a text (colours and other escape sequences ignored), for up to a timeout in seconds (10 by default). If the text does not appear, the macro stops and the pane shows why.

**Record macro** in the toolbar (or Ctrl+Shift+R) records everything typed or pasted in the focused pane until you stop it; each line becomes a send step. A red **Recording** banner stays visible the whole time. When you stop, name the macro to save it, or discard it. Recordings do not include pauses: add **Wait** or **Wait for text** steps in the editor where a command needs time (e.g. before typing a password).

The **Macros** sidebar tab lists the macros with a search box; each one can be played, edited, duplicated or deleted. While a macro plays, a bar shows its progress; **Stop** or Escape ends it.
The editor changes the name, the hotkey and the steps (add, remove, move up or down, change the kind). Ctrl+Alt+1 to Ctrl+Alt+9 play the macro bound to that key; a hotkey belongs to one macro, so giving it to another macro moves it.

Text in send and wait-for steps accepts escapes: `\r` (Enter), `\n`, `\t`, `\e` (Escape), `\\`, `\xHH`, and `^A` to `^Z` (e.g. `^C`), `^[` (Escape) and `^?` (Delete). Anything else is sent as written.

**Macros are saved as plain text** in `macros.json` in the app config directory (readable only by you). Everything you type while recording is saved, including passwords; nothing is masked or filtered. If the file cannot be read, macros cannot be edited until it is fixed, so it is never overwritten.

## Tools

The **Tools** menu in the toolbar holds network and SSH utilities.

**SSH key generator…** creates or edits SSH keys, like PuTTYgen:

- **Generate** a new key of the chosen **Type** and **Size**: Ed25519 (default), RSA 2048/3072/4096 bits (3072 by default) or ECDSA P-256/P-384/P-521. DSA and SSH-1 keys are not offered: they are insecure and current OpenSSH rejects DSA. Keys come from the operating system's secure random generator, so there is no need to move the mouse.
- **Load…** opens an existing private key, in OpenSSH format or PuTTY `.ppk` (v2 or v3), asking for its passphrase when it has one. Its comment and passphrase can then be changed (an empty passphrase removes it).
- The dialog shows the public key in OpenSSH format and its `SHA256:` fingerprint, with **Copy**.
- **Save public key…** (`0644`), **Save private key…** (`0600`, encrypted with the passphrase when there is one) and **Save as PuTTY key (.ppk)…** (PPK v3, `0600`, for PuTTY or WinSCP) each ask before replacing an existing file.
- **Install** adds the public key to a saved SSH session's `~/.ssh/authorized_keys`, like `ssh-copy-id`: it logs in like a terminal tab (trust prompt, saved or typed password, jump hosts), creates `~/.ssh` (`0700`) and `authorized_keys` (`0600`) when missing, and adds the key only once, whatever the login shell of that account is.

The private key never reaches the window: it stays in PlexusTerm's backend until it is saved, and is discarded when the dialog closes.

**Port scanner…** checks which TCP ports are open on a host name, an IPv4 address, a range (`192.168.1.10-20`) or a CIDR block (`192.168.1.0/24`, at most 256 hosts), for the chosen ports: **Known ports** (the default: FTP, SSH, Telnet, SMTP, DNS, HTTP, POP3, IMAP, HTTPS, SMB, MySQL, RDP, PostgreSQL, VNC and 8080), a **Port range** given in two fields (`1 → 65535`), or a **Custom list** such as `22,80,8000-8100` (the known ports when left empty). It only opens TCP connections (no root needed): 1 second per port, at most 256 at a time and 65536 per scan. Open ports appear as they are found, with the usual service name; **Stop** (or closing the dialog) cancels the scan.

**Network scanner…** asks for the range in separate fields, `[192].[168].[1].[1] → [254]` by default (typing a dot or a third digit moves to the next field; pasting an address, an `a.b.c.d-e` range or an `a.b.c.0/24` network fills them all), and finds the machines in it by trying the common service ports (FTP 21, SSH 22, Telnet 23, HTTP 80, HTTPS 443, SMB 445, RDP 3389, VNC 5900). A machine is listed when one of them is open or actively refuses the connection, with its name (reverse DNS through `getent`, Linux), its MAC address (local ARP table, Linux, same subnet only) and its open services. **New SSH session** opens the session editor for a machine with SSH open. No ICMP is used, so machines that drop every connection are not found. Scan only networks you are allowed to scan.

**Wake On LAN…** powers on a machine of the local network: enter its MAC address (`aa:bb:cc:dd:ee:ff` or `aa-bb-cc-dd-ee-ff`) and send the magic packet. The broadcast address defaults to `255.255.255.255` and the UDP port to 9; use the subnet's broadcast address (for example `192.168.1.255`) when the machine is on another network segment reachable that way. The machine needs Wake On LAN enabled in its firmware and network card. PlexusTerm confirms that the packet was sent; it cannot tell whether the machine woke up.

**Show / Hide remote monitor** toggles a bar under every SSH pane (also **Remote monitor bar (SSH tabs)** in Settings; on by default) with the server's CPU use, used/total memory, used/total space of `/`, network download/upload rate and number of logged-in users, refreshed every 3 seconds. It runs one read-only command over the tab's existing SSH connection (`/proc`, `df`, `who`; nothing is installed or left running) and needs a Linux server; anything else shows "Monitoring unavailable".

## Windows

PlexusTerm also builds for Windows 10/11. Everything works as on Linux except:

- **Local terminal**: the default shell is PowerShell 7 (`pwsh.exe`) when it is on `PATH`, otherwise Windows PowerShell (`powershell.exe`), with `%COMSPEC%` as the last fallback; it starts in `%USERPROFILE%`.
- **Home directory**: `~` is `%USERPROFILE%`, so host keys go to `%USERPROFILE%\.ssh\known_hosts` and key paths accept both `~/` and `~\`.
- **SSH agent**: `SSH_AUTH_SOCK` when set, otherwise the Windows OpenSSH agent pipe `\\.\pipe\openssh-ssh-agent` (start the "OpenSSH Authentication Agent" service and add keys with `ssh-add`).
- **Saved files** (sessions, settings, macros) rely on the permissions of your user profile instead of Unix file modes.
- **Serial consoles** list the COM ports reported by Windows (`COM3`, ...) and accept a typed port name.
- **Mosh** is not offered: there is no packaged `mosh-client` for Windows. A Mosh session imported or saved elsewhere reports "Mosh is not available on Windows" unless a `mosh-client.exe` is on `PATH`.

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
| Ctrl+Shift+F | Find in the focused terminal |
| Ctrl+Shift+C | Copy the selection |
| Ctrl+Shift+V | Paste |
| Ctrl+= / Ctrl+- / Ctrl+0 | Larger / smaller / default font size (every terminal) |
| Ctrl+Shift+R | Start or stop recording a macro |
| Ctrl+Alt+1 … Ctrl+Alt+9 | Play the macro bound to that key in the focused terminal |
| Escape (while a macro plays) | Stop the macro |
| Right Arrow / End (with a grey suggestion) | Accept the suggested command |
| Ctrl+Right (with a grey suggestion) | Accept the next word of the suggestion |
| Middle click on a tab | Close that tab |
| Right click on a tab | Copy host address (SSH, Telnet and Mosh tabs), Duplicate tab, Close tab, Close other tabs, Close tabs to the right, Close all tabs |

These shortcuts are handled by the app and never reach the shell.
