# PlexusTerm user guide

How each feature works, its limits and where its data is stored. For installing, see the [README](../README.md#install).

| Section | Covers |
| --- | --- |
| [SSH sessions](#ssh-sessions) | Quick connect, authentication, host-key checks |
| [Serial consoles](#serial-consoles) | Ports, line settings, permissions |
| [Telnet and Mosh](#telnet-and-mosh) | Built-in Telnet client, Mosh over SSH |
| [Saved sessions](#saved-sessions) | Folders, saved passwords, jump hosts, session import |
| [SFTP browser](#sftp-browser) | Remote files of the active SSH tab |
| [File explorer](#file-explorer) | Local files of the active local tab, dropping files on terminals and on the AI chat |
| [SSH tunnels](#ssh-tunnels) | Local, remote and dynamic (SOCKS5) forwards |
| [Split panes and multi-execution](#split-panes-and-multi-execution) | Panes, typing into several terminals |
| [Interface language](#interface-language) | The ten languages, the system default and getting back to English |
| [Terminal settings](#terminal-settings) | Colour schemes, font, copy and paste, find, saving and logging output |
| [Command suggestions and AI](#command-suggestions-and-ai) | Inline suggestions from your history, AI completion, the AI chat |
| [Macros](#macros) | Recording and playing keystroke sequences |
| [Tools](#tools) | SSH key generator, port and network scanners, Wake On LAN, remote monitor |
| [Updates](#updates) | Being told about a new release |
| [Reporting a problem](#reporting-a-problem) | Sending a bug report or a suggestion |
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

The **Sessions** panel on the left keeps SSH, serial, Telnet, Mosh and local terminal sessions in folders (`Prod/DB` style paths).
Use **New** / **Folder** or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name, host, serial device or shell.
Right-click a session for **Connect**, **Edit…**, **Duplicate** (a copy named "<name> (copy)" next to it; a saved keyring password is not copied) and **Delete**. Right-click a folder for **New session here…**, **New folder here…**, **Connect all** (every session in it and its subfolders, each in its own tab) and **Delete folder**. While the sessions file cannot be read, the menus only offer connecting.
The edit dialog has a **Session type** selector (SSH, Serial, Telnet, Mosh or Local terminal) that shows the matching fields. Serial sessions keep the device path and line settings and Telnet sessions the host and port; both open directly, without any password. Mosh sessions name the saved SSH session they log in with and an optional server command. Local terminal sessions keep a shell (the system default, a detected one or any program, as in [Terminal settings](#terminal-settings)), its arguments and a **Starting directory** (`~` is your home directory; empty starts there too), so a PowerShell, a WSL distribution or a project folder is one double-click away; their tabs are titled with the shell's name.

Sessions are stored in `~/.config/dev.plexusterm.app/sessions.json` (written atomically, mode `0600`); each entry has a `kind` (`ssh`, `serial`, `telnet`, `mosh` or `local`), and entries written by earlier versions without it load as SSH sessions.
The file never contains passwords or key passphrases (see [Saved passwords](#saved-passwords)).
Versions before local terminal sessions cannot read a file that holds one, so they show the error below instead of the sessions.
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

### Import sessions from an .ini file

**Import → From an .ini file…** in the Sessions panel reads a sessions `.ini` file with `[Bookmarks]` sections (UTF-8, or the Windows-1252 code page these files are often written in) and shows a preview before anything is saved:

- SSH sessions from the `[Bookmarks]` / `[Bookmarks_N]` sections are imported with their host, port (22 when missing or invalid) and username, and Telnet sessions with their host and port (23 when missing or invalid), under an **Imported** folder that keeps the folder path saved in the file.
- Imported SSH sessions use password authentication; change it later with **Edit**. Private key paths are not imported.
- Other session types (RDP, VNC, Serial, WSL, FTP, ...), entries without a host and unrecognized lines are skipped and counted per type in the preview.
- Sessions already saved with the same type, folder, name, host, port and username are skipped as duplicates.
- Passwords are never imported: the `[Passwords]` section and any other section are not read.

### Import hosts from ~/.ssh/config

**Import → From ~/.ssh/config** reads the OpenSSH client config of your home folder (`~/.ssh/config`, also on Windows) and shows the same preview:

- Each concrete `Host` alias becomes an SSH session named after it, under **Imported/SSH config**. Wildcard (`*`, `?`) and negated (`!`) patterns are not imported as sessions, but their options apply to the hosts they match, as do options before the first `Host`; like ssh, the first value of each option wins.
- `HostName` (the alias when missing; `%h` is replaced by the alias), `User` (empty when missing), `Port` (22 when missing or invalid) and the first `IdentityFile` are read. A host with an `IdentityFile` uses that private key (`%d` becomes `~`); one without uses password authentication.
- `ProxyJump` hops that are hosts of the same file become the session's jump hosts (at most 3). Other hops, such as `user@gateway:2222`, and `ProxyCommand` are not supported: the host is imported without them and counted in the preview.
- `Include` lines and `Match` blocks are not followed and are counted in the preview. Every other option is ignored.
- Hosts already imported the same way are skipped as duplicates, so importing again only adds new hosts.

## SFTP browser

The sidebar has five tabs, **Explorer**, **Sessions**, **SFTP**, **Tunnels** and **Macros**. **Ctrl+Shift+B** or the sidebar button at the left of the toolbar folds it to a strip of the tab icons (click an icon to open the sidebar on that tab) and opens it again; PlexusTerm remembers it. With Settings → Appearance → **Hide the sidebar completely when folded**, folding hides it entirely. Settings → Appearance → **Sidebar when PlexusTerm opens** chooses how it starts: **As I left it** (the default), **Open** or **Folded**. Drag the sidebar's edge to change its width (between 160 and 640 px) and double-click the edge to go back to the default width; PlexusTerm remembers the width too. SFTP browses the remote files of the active SSH tab (its focused pane) over the same connection (it is disabled for local terminals) and opens automatically when an SSH session connects.

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- Double-click a folder to open it, or a file to download it (a save dialog asks where).
- In DEV mode the list looks like VS Code's Explorer instead (see [DEV mode file lists](#dev-mode-file-lists)).
- Drag an entry onto the terminal of the same SSH session: a folder dropped on an empty command line runs `cd` to it; otherwise its path is typed at the cursor. Dropped on the AI chat, a file is attached to the next question (see [File explorer](#file-explorer)).
- **Upload** picks one or more local files; dropping files from the desktop onto the panel uploads them too. Both go into the current folder.
- **New folder**, **New file** (an empty file; an existing one is never replaced), **Rename**, **Delete** (asks for confirmation; only empty folders can be deleted) and **Download** act on the selected entry.

Right-click an entry for more:

- **Open** (enters a folder; opens a file in its default program, like **Open with default program** below), **Download…**, **Rename…** (in the entry's own folder), **Delete**.
- On folders, **Open in terminal** (right after **Open**) opens another tab of the same SSH session, authenticated the same way as **Duplicate**, and once its shell is ready runs `cd` to the folder, quoted for the shell.
- **Copy file path** copies the full remote path; **Copy file path to terminal** types it into the focused pane of the active tab, quoted for the shell when needed. Middle-clicking an entry does the same.
- **Properties** shows the name, path, type, size, modification time, owner, group and permissions (`rwxr-xr-x (0755)`).
- **Permissions…** changes the mode (`chmod`) with read/write/execute checkboxes for owner, group and others, kept in sync with the octal value.
- For files: **Open with default text editor** (the **Text editor** chosen in [Settings](#terminal-settings), or the system's default one), **Open with default program**, **Open with…** (choose a program) and **Compare file with…** (choose a local file; opens both in Meld, KDiff3, Kompare or Visual Studio Code, the first one installed). The open options download the file to a private temporary folder and watch it: each time the copy is saved, PlexusTerm asks the first time whether to upload it to the same remote path, then uploads it and reports the result. The temporary copies are deleted when the SSH session closes.

With **Follow terminal folder** on (the default), the browser follows the shell's working directory. A remote shell that reports it with an OSC 7 sequence is followed at once. Otherwise, while the SFTP tab is shown, PlexusTerm reads the folder of the session's shell on the server every second over the same connection, without typing anything in the terminal; this works on Linux servers (it needs `/proc`) and follows the shell's own folder, not that of a program it runs or of a shell started inside it with `sudo -s` or `ssh`. On other servers, make the shell report OSC 7; for bash, add this to the remote `~/.bashrc`:

```bash
PROMPT_COMMAND='printf "\033]7;file://%s%s\007" "$HOSTNAME" "$PWD"'
```

Paths containing special characters may need percent-encoding; many distributions' `vte.sh` already emit OSC 7 that way.

## File explorer

The **Explorer** tab of the sidebar browses the local disk while the active tab is a local terminal (it is disabled for other tabs). A new local terminal brings it to the front when the sidebar shows **Sessions** (any other tab you chose stays), and switching between a local and an SSH tab swaps the Explorer and the SFTP browser. It works like the [SFTP browser](#sftp-browser) on this computer's files:

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- Double-click a folder to open it, or a file to open it in its default program. In DEV mode the list looks like VS Code's Explorer instead (see [DEV mode file lists](#dev-mode-file-lists)).
- **New folder**, **New file** (an empty file; an existing one is never replaced), **Rename** (an existing name is never replaced) and **Delete** act on the selected entry. Deleting a folder deletes everything in it, after a confirmation.
- Right-click an entry for **Open**, **Open with default text editor** (the **Text editor** of [Settings](#terminal-settings)), **Open with…**, **Rename…**, **Delete**, **Copy file path**, **Copy file path to terminal** (also a middle click; quoted for the terminal's shell), **Properties** and, on Linux and macOS, **Permissions…**. Files open in place: there is no temporary copy. On folders, **Open in terminal** (right after **Open**) opens a new local terminal tab, with the same shell as the active one, that starts in that folder.

### DEV mode file lists

In [DEV mode](#dev-mode) the Explorer and the SFTP browser start at the project the AI tool runs in, and look and work like VS Code's Explorer:

- The list is a tree: click a folder (or its chevron) to expand it in place, and again to collapse it; its entries are listed when it is first expanded, indented under it with thin guide lines. Several folders can be open at once, and they stay open when the list is refreshed. Double-click a folder to list from it (it becomes the top of the tree); double-click a file to open it as outside DEV mode. **Rename…** on a nested entry renames it in its own folder.
- With the keyboard: **↓** / **↑** move between entries, **→** expands a folder or moves into it, **←** collapses it or moves to its parent folder, and **Enter** opens a file or expands a folder.
- Each entry has an icon for its type (folders, source code by language, configuration, text, images, archives, keys and certificates, `Dockerfile`, `package.json`, `README`, ...), coloured like VS Code's usual icon themes.
- Inside a git repository, entries show their git status (below).
- **Add folder** (Explorer only) adds another folder to the tab's workspace, as in a VS Code workspace: then every folder, the main one first, shows as a root as in VS Code: a row with a chevron and the folder's name that folds its tree, a dot coloured by its git changes, its own tree and git status; right-click an added folder's row and choose **Remove folder from workspace** to take it out (the folder itself is not touched). The added folders belong to that tab and are kept while it is open.
- **Save workspace** writes the main folder and the added ones to a workspace file in VS Code's format (`.code-workspace`), and **Open workspace** opens one (saved here or by VS Code): a new DEV tab starts in its first folder and adds the others. Folders given relative to the file are taken from the file's folder; remote folders of VS Code workspaces are left out.

#### Git status in file lists

When a listed folder is inside a git repository, the Explorer and the SFTP browser colour each entry like VS Code, with the same colours for dark and light colour schemes, and show a letter at the right (hover it for its name):

| Letter | Status | Colour |
|---|---|---|
| **M** | Modified, or Modified (staged) | yellow-brown |
| **A** | Added (staged or intent to add) | green |
| **D** | Deleted, or Deleted (staged); struck through | red |
| **R** / **C** | Renamed / Copied | green |
| **T** | Type changed | yellow-brown |
| **U** | Untracked | green |
| **I** | Ignored; the entry is faded | grey |
| **!** | Conflict | red |

A file with a staged and an unstaged change shows the more important one (conflict, then ignored, then modified, then the others). A folder takes the colour of the most important change inside it and shows a **●** instead of a letter; deleted and ignored files do not colour their folders. A folder that git reports as a whole (untracked, or ignored like `node_modules`) gives its colour to everything inside it. Submodules are not marked.

The status is read with one read-only `git status` (no lock taken, so it never gets in the way of a `git` you or an AI tool run) when the list is loaded or refreshed, when the terminal's prompt comes back, and while the terminal tied to the list prints (so files changed by Claude Code, Codex, OpenCode and other AI command-line tools are marked as they work), at most once every 2 seconds and only while the list is shown; nothing is read while it is idle. SSH lists run that `git` on the server over the same connection. Without git, outside a repository or when it fails, entries are simply not coloured. Very large outputs (many thousands of entries) are cut short rather than slowing the list. Turn it off with Settings → Files → **Show git status in file lists**. Outside DEV mode git is never read for the file lists.

With **Follow terminal folder** on (the default), the Explorer shows the folder the terminal's shell is in. Shells that report it with OSC 7 (fish, zsh or bash with `vte.sh`, PowerShell with the prompt below) are followed at once. For other shells PlexusTerm reads the shell's working folder every second while the tab is shown, on Linux and macOS; it is the shell's own folder, not that of a program it runs. On Windows only OSC 7 is followed; add this to your PowerShell profile (`notepad $PROFILE`):

```powershell
function prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation
  if ($loc.Provider.Name -eq "FileSystem") {
    $url = "file:///" + ($loc.ProviderPath -replace "%", "%25" -replace "\\", "/")
    [Console]::Write("$([char]27)]7;$url$([char]7)")
  }
  "PS $loc$('>' * ($nestedPromptLevel + 1)) "
}
```

### Dropping files on a terminal

Files and folders dragged from the Explorer, the SFTP browser or the desktop onto a terminal pane:

- A folder dropped on an empty command line runs `cd` to it (`cd /d` in cmd). This only happens when the folder is on the machine the terminal runs on: local files in a local terminal, SFTP entries in the terminal of their own SSH session.
- Anything else types the paths at the cursor, quoted for the shell and followed by a space: a file, several entries, a folder while something is already typed, at a password prompt or in a full-screen program such as vim, or a path from another machine.
- A path with control characters is never typed; a notice says so. A Linux or macOS folder whose name contains a backslash is typed instead of run, since shells such as fish read it as an escape.

### Dropping files on the AI chat

Files dragged from the Explorer, the SFTP browser or the desktop onto the [AI chat](#ai-chat) are attached to the next question, each shown above the input with its **×** to leave it out. Their text is sent with the question as context, and only with that question:

- At most 5 files per question; the first 64 KB of each file are read ("(first 64 KB)" marks a longer one), and at most 100,000 characters in all are sent.
- Binary files (with a NUL byte or invalid UTF-8) are refused with a message. A dropped folder attaches the list of its entries (folders end with `/`).
- The text goes to the AI provider chosen in Settings → AI. Do not attach files whose contents must not leave this computer.

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

## Interface language

PlexusTerm's interface comes in English, Spanish, German, French, Japanese, Portuguese (Brazil), Simplified Chinese, Korean, Arabic and Hindi.

- **Default:** the language of the operating system; when it is none of these, English.
- **Choosing one:** Settings → Appearance → **Language** lists **System** and each language by its own name; **Save** applies it.
- **Getting back:** next to the list, **System language** and **English** are never translated and apply and save at once, without **Save**. If you chose a language you cannot read, open Settings with the gear button and click one of them.
- **Arabic** mirrors the interface right to left. Terminals, commands, code and file paths stay left to right, and split panes keep their places, so **Split right** still opens a pane on the right.
- **Not translated yet:** error messages that come from the connection backend (SSH, SFTP, serial, AI providers) are shown in English. Product names, protocol names, shortcuts and the text sent to AI providers are never translated.

## Terminal settings

The gear button at the right of the toolbar opens **Settings**, shared by every tab and saved in `settings.json` in the app config directory. A side menu splits it into **Appearance** (colour scheme, font family and size), **Terminal** (shell of local terminals, copy and paste, Shift+Enter, attention notifications, DEV mode commands, GPU acceleration), **Shortcuts** (every keyboard shortcut, see [Keyboard shortcuts](#keyboard-shortcuts)), **SSH** (remote monitor bar), **Files** (text editor), **AI** (command suggestions, history and AI provider, see [Command suggestions and AI](#command-suggestions-and-ai)) and **About** (version, project links and updates); **Save** keeps the changes of every section:

- **Font size** (8-32, default 14). Ctrl+= / Ctrl+- / Ctrl+0 (changeable in Settings → Shortcuts) change it too; every terminal follows at once.
- **Font**: picks the terminal font from a list. **Default** is the first of JetBrains Mono, Cascadia Mono and DejaVu Sans Mono installed on the computer. **Included with PlexusTerm** are JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro and Hack, which ship with the app and look the same everywhere. **Installed on this computer** lists the well-known monospaced fonts found here (Consolas, Ubuntu Mono, DejaVu Sans Mono, Nerd Fonts and others). Choosing one fills **Font family**.
- **Font family** (default `"JetBrains Mono", "Cascadia Mono", "DejaVu Sans Mono", monospace`): one installed font name, such as `Hack Nerd Font`, or a CSS font list. Type any font here that the list does not show; **Font** then reads **Custom**. A single name falls back to the system monospace font when it is not installed; leaving the field empty restores the default.
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
- **Shell for local terminals** (default: the system default shell): the shells found on this computer are listed (Linux and macOS: `$SHELL` and `/etc/shells`; Windows: PowerShell 7, Windows PowerShell, cmd, WSL and Git Bash when installed), or **Other…** runs any program, typed or chosen with **Browse…**. **Arguments** are separated by spaces; quote an argument that has spaces, e.g. `-NoLogo -Command "Set-Location 'C:\My Files'"`. New local terminals use it; terminals already open keep their shell. Command suggestions name it to the AI provider, and **Run** clears the line with the keys that shell understands.
- **Starting folder for local terminals** (default: empty, the home folder): the folder new local terminals start in, typed (`~` is the home folder) or chosen with **Browse**. Saved local sessions keep their own starting directory.
- **Copy on select** (on by default): selecting text with the mouse copies it to the clipboard.
- **Right click pastes** (on by default). When it is off, right click opens the terminal menu; Ctrl+right click always opens it, and so does a right click on selected text.
- **Confirm multi-line paste** (on by default): pasting more than one line shows the line count and the first lines before anything is sent. **Don't ask again** turns it off.
- **Show errors in red** (on by default): output lines that look like errors (`error:`, `fatal:`, `command not found`, `Permission denied`, `No such file or directory`, a Python `Traceback`, and the messages of `cmd` and PowerShell on Windows, also when the system speaks Spanish, Portuguese, German, French, Japanese, Korean, Chinese or Arabic) are shown in the colour scheme's red. A terminal cannot tell errors apart, because programs write errors and normal output to the same stream, so lines are recognised by their text: a line that only mentions an error can be coloured too. The output itself is not changed, and programs that use the whole window (`vim`, `htop`) are left alone.
- **Shift+Enter starts a new line** (on by default): see [AI command-line tools](#ai-command-line-tools). Off, Shift+Enter sends the same carriage return as Enter.
- **Desktop notifications when a terminal needs attention** (on by default): see [AI command-line tools](#ai-command-line-tools). Off, a terminal asking for attention only marks its tab.
- **Commands that turn DEV mode on** (default: `claude, codex, agy, opencode, pi, gentle-shell`): see [DEV mode](#dev-mode). Names are separated by commas or spaces; an empty list turns DEV mode on only by hand.
- **GPU acceleration** (on by default): terminals are drawn with WebGL on the graphics card, which keeps programs that redraw the whole screen many times a second (AI command-line tools, `htop`, `btop`) smooth. When the system has no WebGL 2, or the graphics card drops the context (a driver reset, waking from sleep), terminals switch to the standard renderer by themselves without losing anything. Error colours and selection work the same with both. Turn it off if text looks wrong or flickers with your graphics driver; open terminals switch at once.
- **Text editor** (default: empty, the system default text editor): the program **Open with default text editor** uses in the SFTP browser. **Browse…** picks a program; you can also type a command with arguments, such as `code --wait` or `"/opt/My Editor/editor" -n`. The file is added as the last argument, or in place of `%f` when the command has one. The command runs directly, never through a shell, and a path to an existing program counts as one program even when it contains spaces. **Use system default** empties the field. A value that is not text or is longer than 1024 characters loads as the system default.

- **Show size and date in file lists** (Settings → Files, off by default): the SFTP browser and the Explorer show each entry's size and modification date next to its name.
- **Show git status in file lists** (Settings → Files, on by default): DEV mode's file lists colour entries by their git status (see [Git status in file lists](#git-status-in-file-lists)). Off, nothing is read and no entry is coloured.
- **Change the terminal's folder when you open a folder in the file browser** (Settings → Files, on by default): opening a folder in the SFTP browser or the Explorer (path bar, double-click, **↑**, **⌂**) runs `cd` to it in the terminal of the same machine, only when that panel's **Follow terminal folder** is on (turning it off unlinks the panel and the terminal both ways), nothing is typed on its command line and no full-screen program runs. Folders the browser opens by following the terminal never send `cd`.

Pasted text is sent like typed text, so multi-exec forwards it too, and shells that support bracketed paste receive it as a paste.

With text selected, the terminal menu starts with what can be done with it: **Copy**, **Ask the AI about it** (opens the terminal's AI chat with the selection attached, or attaches it to the chat already open), **Type at the prompt** (types the selection at the cursor, asking first when it has several lines), **Find in terminal** (opens the find bar with the selection's first line) and, when the selection is one `http://` or `https://` address, **Open link** (opens it in the browser).

The terminal menu has **Copy**, **Paste**, **Select all**, **Clear scrollback**, **Find…** (Ctrl+Shift+F: next/previous, match case, regex; Escape closes it), **Save output to file…** (the whole scrollback of that pane as plain text) and **Log to file…**.
Logging appends everything the pane receives from then on to the chosen file, without colours or other escape sequences, until **Stop logging** or the pane closes. Tabs being logged show a red dot.

### AI command-line tools

Claude Code, Codex, Gemini CLI, OpenCode and similar tools run in any PlexusTerm terminal, local or remote (SSH, Mosh, Telnet, serial).

- **Shift+Enter** starts a new line in their prompt instead of sending it. A terminal normally sends the same carriage return for Shift+Enter as for Enter, so PlexusTerm sends a line feed instead, the character Ctrl+J sends, which all four tools read as "new line". In a shell a line feed runs the command just like Enter, so nothing changes there. Enter, Ctrl+Enter and Alt+Enter send what they always did. Shift+Enter cannot be given to an application shortcut (shortcuts need Ctrl, Alt or Meta), so it never clashes with one. Turn it off with **Shift+Enter starts a new line** in Settings → Terminal.
- **Attention marks and notifications.** When a program rings the terminal bell or sends a desktop notification sequence (OSC 9 as iTerm2 uses it, OSC 777 `notify` as Ghostty uses it, or kitty's OSC 99) in a terminal you are not looking at, its tab shows an amber dot, and so does the pane when the tab is split. The mark stays until you focus that pane. While PlexusTerm is in the background, a desktop notification also shows the message, or the tab's title and "Needs your attention" for a bell. A program that keeps ringing produces one notification every ten seconds at most, and no more than three notifications come from all terminals together in ten seconds. Nothing happens for the pane you are looking at, so the bell of tab completion while you type stays quiet. Progress reports (OSC 9;4, which Claude Code sends while it works) are not notifications. Turn the desktop notifications off with **Desktop notifications when a terminal needs attention** in Settings → Terminal; the tab mark stays. The first notification asks the system for permission.
  - Codex rings the bell by default in terminals it does not know, PlexusTerm included; set `notification_method = "osc9"` under `[tui]` in `~/.codex/config.toml` to get its message in the notification.
  - Claude Code notifies only in the terminals it recognises (iTerm2, Ghostty, Kitty) unless told otherwise: add `"preferredNotifChannel": "iterm2"` to `~/.claude/settings.json` (or choose it in `/config` → **Local notifications**) to get its message in the notification; `"kitty"` and `"ghostty"` work too, and `"terminal_bell"` only rings the bell.
- **Smooth redraws.** With **GPU acceleration** on (see above), tools that repaint their whole interface while they stream output stay fluid.

### DEV mode

DEV mode turns a tab into a workspace for an AI command-line tool. It belongs to each tab: other tabs keep their normal look.

- **On by itself.** A tab turns to DEV mode when a command sent with Enter in its terminal starts one of the commands listed in Settings → Terminal → **Commands that turn DEV mode on** (by default `claude`, `codex`, `agy`, `opencode`, `pi` and `gentle-shell`). Only the first word counts, also with a path such as `~/.local/bin/claude`, so `claude --resume` turns it on but `echo claude` or `claude-foo` do not. A command recalled from history (Up arrow) or completed with Tab counts too: it is read from the screen. As a fallback, a terminal whose title names one of them (Claude Code sets `✳ Claude Code`, pi `π - <folder>`) turns it on too. This works in local, SSH and Mosh terminals.
- **Off by itself.** It turns off when the shell's prompt comes back in the terminal that started the tool: the shell marks its prompt (OSC 7 or OSC 133, see [Git branch](#git-branch)), the output stops on the same prompt the tool was started from, or the terminal's title becomes the shell's again (any title that does not name the tool and does not start with a symbol such as Claude Code's `✳`). A prompt that changes every time (a clock, the duration of the last command) is compared without its numbers; with a prompt that changes otherwise and no OSC 7 or OSC 133, turn DEV mode off by hand.
- **By hand.** The **DEV** button at the right end of the bar under each local, SSH and Mosh terminal turns the tab's DEV mode on or off (it is highlighted while on; hover it to read whether it is on), and so does **DEV mode on or off** in Settings → Shortcuts (no shortcut by default). Turned on by hand, DEV mode stays on when a tool ends; only the button or the shortcut turns it off.

While a tab is in DEV mode:

- The tab shows the DEV mode icon (`</>`, the same as on the **DEV** button), and while it is the active tab the tabs move to a **column at the right** of the terminals: one row per tab with an icon for the tool it runs (Claude Code, Codex, Antigravity for `agy`, OpenCode, pi, gentle-ai's rose for `gentle-shell`; a terminal icon otherwise),, its title (without the mark the tool puts in front, such as the `π -` of pi and gentle-shell; a title that only names the tool, such as `Claude Code`, is left out because the icon says it), the folder the tool was opened in, in grey and a **×** that closes it. The **+** under the rows opens a new local terminal already in DEV mode. **Duplicate tab** on a DEV tab, and **Open in terminal** on a folder of its file list, open the new terminal in DEV mode too. While the tool in a tab is working (printing on its own, not just echoing what you type), a small turning ring shows next to its icon, in the column and in the tab bar; it stops 1.5 s after the output does (with reduced motion on in the system it is a still ring). The active row is highlighted; clicking a row, middle-clicking it to close it, its right-click menu and its attention and logging marks work as in the tab bar. Drag the column's left edge to change its width (between 140 and 480 px) and double-click the edge to go back to the default width; PlexusTerm remembers the width.
- The bar under the terminal shows the [git branch](#git-branch).
- The Explorer (local tabs) or the SFTP browser (SSH tabs) goes to the folder the tool was opened in; with its **Follow terminal folder** box on (the default) it then goes wherever the terminal goes, and with the box off it stays at that folder. It also looks like VS Code (see [DEV mode file lists](#dev-mode-file-lists)). Opening folders in it never types `cd` in the terminal, where the tool is running.
- Desktop notifications for that tab are sent even when **Desktop notifications when a terminal needs attention** is off.

### Git branch

In [DEV mode](#dev-mode), when a terminal's current folder is inside a git repository, a bar under the terminal shows the branch with a branch icon, for example `main`, like the remote monitor bar; on SSH tabs with the remote monitor on, the branch opens that same bar. With no branch checked out (a detached `HEAD`) it shows the short commit instead, such as `72e8845`; outside a repository nothing is shown. A split tab shows the branch of its focused pane.

- **Local terminals** read the branch from the repository's files, without starting `git`: worktrees and submodules (whose `.git` is a file pointing elsewhere) work too.
- **SSH terminals** run one read-only command on the server over the same connection (`git -C <folder> symbolic-ref --short -q HEAD`, or `git rev-parse --short HEAD` when detached). A server without git shows no branch.
- Mosh, Telnet and serial terminals show no branch: PlexusTerm has no separate channel to ask through.

The folder is the one the shell reports with OSC 7; for shells that do not, PlexusTerm asks for the shell's folder (Linux servers for SSH). The branch is read again when the folder changes and when the prompt comes back after a command, so `git checkout` or `git switch` shows up as soon as it finishes; it is never polled. Outside DEV mode no branch is shown and nothing is read.

## Command suggestions and AI

### Inline suggestions

While you type a command in any terminal pane (local, SSH, Telnet, Mosh or serial), PlexusTerm draws the rest of a command you ran before in grey after the cursor. Suggestions come from your own command history, so they work with no AI configured: commands of the same host first, then those of every host, the most recent and most often used first.

- **Right Arrow** or **End**, with the cursor at the end of the line, accepts the whole suggestion; **Ctrl+Right** accepts its next word. The accepted text is sent as if typed, so multi-execution and macro recording see it too.
- Every other key reaches the shell as usual: **Tab** stays the shell's own completion.
- Suggestions pause until the next Enter once PlexusTerm can no longer be sure what the line holds: after Up/Down (shell history), Ctrl+R, Tab completion, the left arrow or other cursor keys, Alt shortcuts, or a paste with several lines. They are also hidden in full-screen programs (vim, less, top), at password and passphrase prompts, while the pane is scrolled back or not focused, and when the shell draws something after the cursor (a right-hand prompt, or another autosuggestion plugin).

Every command sent with Enter is recorded on this computer in `history.json` in the app config directory (readable only by you), per host (`user@host:port` for SSH and Mosh, `telnet:host:port`, `serial:device`, `local`), without duplicates and capped at 2000 commands per host and 200 hosts. Never recorded: lines starting with a space, anything typed at a password, passphrase, PIN or one-time-code prompt (recognised in the ten interface languages and Russian, as sudo, ssh, PAM, cryptsetup and gpg print them), anything typed in a full-screen program, and commands that reach a pane only through multi-execution.

The **AI** section of Settings holds:

- **Inline suggestions** (on by default): the grey suggestions above.
- **Command history** (on by default): records commands and suggests from them. **Clear history** empties `history.json` at once.
- **AI suggestions** (off by default): when the history has nothing for the typed line, ask the AI provider (see [AI suggestions](#ai-suggestions)).
- **Provider**: Anthropic, Gemini, OpenAI, OpenAI-compatible or OpenCode Go; **Base URL** for an OpenAI-compatible endpoint (for example `http://localhost:11434/v1` for Ollama).
- **Model** (Anthropic: `claude-opus-5-5`, Gemini: `gemini-3.5-flash-lite`, OpenAI and compatible: fill in your model; OpenCode Go: pick one from the list, see [OpenCode Go](#opencode-go)). Changing the provider while the model is still a provider default switches it to the new provider's default.
- **API key**: stored in the system keyring, one per provider. The field only shows whether a key is saved; **Save key** and **Remove key** apply at once.
- **History commands sent as context** (0-20, default 5).
- **AI assistant** shortcut (default Ctrl+Shift+Space): changed in Settings → **Shortcuts**, under **AI assistant**.

### AI suggestions

With **AI suggestions** on, when the history has no suggestion for the typed line PlexusTerm waits for a short pause in typing (about 400 ms; typing again cancels it) and asks the AI provider how the command goes on. The answer is drawn in grey like a history suggestion and accepted with the same keys.

- Sent: the typed line, the operating system, the current folder (only when the shell reports it through OSC 7) and the host's last history commands (**History commands sent as context**, 0 sends none; none either while **Command history** is off).
- Never sent: the terminal output, anything typed at a password or passphrase prompt, anything typed in a full-screen program.
- Each pane sends at most one request at a time and at most one per second; only the newest line waits, older ones are dropped.
- Failures never interrupt typing: the pane shows a small grey hint in its bottom right corner, such as **AI: no API key**, **AI: key rejected**, **AI: rate limited** or **AI: unavailable** (hover it for the provider's message). It goes away with the next answer.

### Providers and API keys

| Provider | Default model | Notes |
| --- | --- | --- |
| Anthropic (default) | `claude-opus-5-5` | Messages API. With the Claude Opus 5.5 models, PlexusTerm lets Anthropic retry on a recommended model when the chosen one cannot answer (server-side fallback). A faster, cheaper model can be typed in **Model**. |
| Gemini | `gemini-3.5-flash-lite` | Google Gemini API. |
| OpenAI | none: type your model | OpenAI API. |
| OpenAI-compatible | none: type your model | Any endpoint with the OpenAI API at **Base URL**: Ollama (`http://localhost:11434/v1`), LM Studio (`http://localhost:1234/v1`), OpenRouter (`https://openrouter.ai/api/v1`). A key is optional; local servers usually need none. When the base URL is on `opencode.ai`, the OpenCode session header is sent too. |
| OpenCode Go | none: pick a model from the list | Only the API key is needed: the model list and each model's API come from OpenCode (see below). |

API keys are stored only in the system keyring (one per provider), never in `settings.json`; Settings shows only whether a key is saved. Requests go from the PlexusTerm backend straight to the provider over HTTPS (or to the base URL you set), identified as `PlexusTerm/<version>`. Redirects are not followed, so a key is never sent on to another host; a redirect shows up as an error asking you to check the base URL.

### OpenCode Go

Choose **OpenCode Go** as the provider and save your OpenCode API key; nothing else is needed.

- **Model** becomes a list of the OpenCode Go models with their names. PlexusTerm reads it from OpenCode's public list (`https://opencode.ai/inference/go/v1/models`) and learns which API each model uses from [models.dev](https://models.dev). The list is kept for 24 hours in `opencode-go-models.json` in the app config directory; **Refresh models** fetches it again.
- Models served with the chat completions, Anthropic messages or OpenAI responses APIs work. Models on Google's API are shown as **not supported yet** and cannot be picked.
- If models.dev cannot be reached, every model is treated as chat completions and a note says so; if nothing can be fetched, the list saved earlier is shown, or you can type a model id.
- Every request carries a session ID (`x-opencode-session`), as OpenCode asks: one per terminal pane for inline suggestions and one per AI chat pane.
- OpenCode Go is meant for coding agents and monitors traffic; inline AI suggestions send many short requests. Settings shows this note when OpenCode Go is selected.

### AI chat

The AI chat answers any question or request in plain words (explanations, steps, what an error means, general help, any topic), in the language you write in, and offers a command for its terminal only when one fits. Press **Ctrl+Shift+Space** (changeable in Settings → Shortcuts → **AI assistant**; the key never reaches the shell) or click the PlexusTerm X at the left of the toolbar: the focused terminal is split and the chat opens in a pane below it, linked to that terminal. The X turns once each time the chat opens or takes the focus (not when the system asks for reduced motion).

- Each terminal has at most one chat: pressing the shortcut in a terminal that already has one moves the focus to it; pressing it in a chat goes back to its terminal. Clicking the X while a chat is open (it or its terminal has the focus) closes that chat, with the same turn of the X.
- The chat counts as one of the tab's 4 panes. When the tab is full, a notice says so and no chat opens; close a pane first.
- Type your question and press **Enter** or **Send** (**Shift+Enter** starts a new line). The conversation scrolls above the input. **Stop** cancels the answer being waited for and puts the question back in the input. An error is shown under the question it belongs to.
- Follow-up questions send the earlier questions and answers of the same chat as context: the last 10 at most, and at most 16,000 characters in all (the oldest are left out first). Each chat is one conversation (one session ID for OpenCode).
- The answer is shown as plain text: line breaks are kept and code between ``` fences is shown in monospace blocks; nothing in it is ever treated as HTML or run. Control and invisible formatting characters are removed (line breaks and tabs stay), and an answer longer than 8000 characters is shortened, ending with "… (answer shortened)".
- When a single shell command does what you asked, it is shown below the answer with **Copy**, **Insert** and **Run**; otherwise there is no command box. **Insert** types the command into the chat's terminal without Enter and moves the focus there, so nothing runs until you press Enter yourself. **Run** clears whatever was half typed in that terminal, types the command and presses Enter; it refuses (and says so) while the terminal is at a password prompt or in a full-screen program such as vim. **Copy** puts it on the clipboard. Nothing runs unless you click **Run** or press Enter. An inserted command is recorded in the command history once you send it with Enter, like one you typed. Commands always come back on one line, without control characters or invisible formatting characters (such as zero-width spaces or right-to-left overrides); a command longer than 2000 characters is left out and only the answer is shown.
- When text is selected in the terminal as you open the chat, it is attached to your first question and shown above the input before you send it; at most 2000 characters are sent. Click its **×** to leave it out. With text or files attached, **Send** works with an empty input: the question sent is "Explain this." (in the interface language).
- Files dropped on the chat are attached to the next question: see [Dropping files on the AI chat](#dropping-files-on-the-ai-chat).
- Besides your question, the chat sends the operating system, the terminal's current folder (when known) and the host's recent commands under the same rules as AI suggestions; never the terminal output.
- The chat's header shows the provider and model; click it to choose another model from a scrollable list. The list holds the models of every provider with an API key saved (and of the OpenAI-compatible server when its base URL is set; on `opencode.ai` only once that provider has its own key, since OpenCode answers only with one), each with its provider's name, and can be filtered by typing. Choosing one makes it the AI provider and model, as in Settings → AI, for every chat and for AI suggestions. A provider whose list cannot be read shows why, and the others are still listed.
- When no key is saved for the provider, the chat says so and **Open AI settings** opens Settings on the **AI** section, where the key is saved.
- **AI conversations** (the clock button in the chat's header) lists the conversations, newest first, with their first question and date; the current one is highlighted. Click one to continue it in this chat (its questions, answers and AI session come back), or its bin to delete it. With Settings → AI → **Keep AI conversations after closing PlexusTerm** (on by default) they are saved on this computer in `ai-chats.json` in the app config directory (only your user can read it; at most 100, the oldest go first) and listed again after a restart. Turned off, nothing is read or written and the list holds this run's conversations only. A question still waiting for its answer is never saved, and attached files keep only their paths.
- The chat closes with the **×** at the right of its header, or **Ctrl+Shift+W** while it has the focus. Closing the chat keeps its conversation: opening it again for the same terminal shows the earlier questions and answers and continues the same conversation. **New conversation** (the speech-bubble button next to the ×) starts over. A conversation stays in **AI conversations** when its terminal closes or PlexusTerm quits, unless keeping them is turned off. Closing its terminal (or the shell exiting) closes the chat too.
- The chat is never part of multi-execution, macros never play into it or record from it, typing in it is not recorded in the command history, and while it has the focus the SFTP browser keeps following its terminal.

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

## Updates

When PlexusTerm starts it asks GitHub for the latest published release, once. If it is newer than the version you run, a bar under the toolbar says so: **Download** opens the release page in your browser, where you pick the package for your system, and the close button hides the bar until the next start. PlexusTerm never downloads or installs anything by itself, and a failed check (no network, GitHub unavailable) shows nothing.

Settings → About has **Check for updates** to ask at any time; it says whether PlexusTerm is up to date, offers **Download** for a newer release or shows why the check failed. Turn off **Check for updates at startup** there to stop the startup check; the only data sent is a request for the latest release of the public repository, with PlexusTerm's version as the user agent.

## Reporting a problem

Settings → About has **Report a problem** and **Suggest an improvement**. Each opens a form on GitHub in your browser; the bug form already has your PlexusTerm version filled in. Nothing is sent until you submit the form there, and a GitHub account is needed. Remove passwords, keys and host names from what you write. Report security vulnerabilities privately, as the [security policy](https://github.com/jorgealonsodev/PlexusTerm/security/policy) explains, not in a public issue.

## Windows

PlexusTerm also builds for Windows 10/11. Everything works as on Linux except:

- **Local terminal**: the default shell is PowerShell 7 (`pwsh.exe`) when it is on `PATH`, otherwise Windows PowerShell (`powershell.exe`), with `%COMSPEC%` as the last fallback; it starts in `%USERPROFILE%`. Settings → Terminal → **Shell for local terminals** picks another one, such as cmd, WSL or Git Bash.
- **File explorer**: following the terminal folder needs the shell to send OSC 7 (see [File explorer](#file-explorer) for PowerShell); Windows does not let PlexusTerm read another program's working folder. **Permissions…** is not offered.
- **Home directory**: `~` is `%USERPROFILE%`, so host keys go to `%USERPROFILE%\.ssh\known_hosts` and key paths accept both `~/` and `~\`.
- **SSH agent**: `SSH_AUTH_SOCK` when set, otherwise the Windows OpenSSH agent pipe `\\.\pipe\openssh-ssh-agent` (start the "OpenSSH Authentication Agent" service and add keys with `ssh-add`).
- **Saved files** (sessions, settings, macros) rely on the permissions of your user profile instead of Unix file modes.
- **Serial consoles** list the COM ports reported by Windows (`COM3`, ...) and accept a typed port name.
- **Port and network scanners**: Windows retries a refused connection for about two seconds, longer than the one-second probe, so closed ports may be listed as **filtered**. Open ports are found as on Linux.
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
| Ctrl+Shift+B | Fold the sidebar to its icons (or hide it) and open it again |
| Ctrl+Alt+1 … Ctrl+Alt+9 | Play the macro bound to that key in the focused terminal |
| Escape (while a macro plays) | Stop the macro |
| Right Arrow / End (with a grey suggestion) | Accept the suggested command |
| Ctrl+Right (with a grey suggestion) | Accept the next word of the suggestion |
| Ctrl+Shift+Space (changeable) | Open the AI chat below the focused terminal, or switch between a terminal and its chat |
| Shift+Enter | New line in AI command-line tools (sends a line feed, like Ctrl+J; see [AI command-line tools](#ai-command-line-tools)) |
| Middle click on a tab | Close that tab |
| Right click on a tab | Copy host address (SSH, Telnet and Mosh tabs), Duplicate tab, Close tab, Close other tabs, Close tabs to the right, Close all tabs |

These are the defaults. Shortcuts handled by the app never reach the shell.

### Changing shortcuts

Settings → **Shortcuts** lists every action PlexusTerm can run from the keyboard, grouped as **Tabs and panes**, **Connections**, **Terminal**, **Font size**, **Sidebar and macros**, **Tools** and **AI assistant**:

- Click a shortcut and press the new combination; Escape keeps the current one. A shortcut needs Ctrl, Alt or Meta with a key. A combination another action already uses is refused, naming that action; so are the fixed keys below and the AI assistant's shortcut.
- **Clear** removes an action's shortcut: the action shows **Not set** and the keys go to the terminal again. **Reset** gives one action back its default, and **Restore defaults** does it for all of them, the AI assistant included. Changes apply on **Save**.
- Many actions have no shortcut until you set one: close tab, next and previous tab, new serial, Telnet and Mosh connections, select all, clear the terminal, save output to a file, start or stop logging, turn the tab's DEV mode on or off, ask the AI about the focused terminal, show each sidebar tab (Sessions, SFTP, Explorer, Tunnels, Macros), the SSH key generator, port scanner, network scanner and Wake on LAN, the remote monitor bar, and opening Settings. Terminal actions (find, copy, paste, select all, clear, save output, logging, ask the AI) act on the focused terminal.
- Tooltips and help texts show the shortcuts as they are set; an action without one shows none.
- **Fixed keys** are listed for reference and cannot be changed: Ctrl+Alt+1–9 (play the macro bound to that key), Right Arrow / End (accept an inline suggestion) and Ctrl+Right (accept one word of it).

Only the changed shortcuts are saved, under `shortcuts` in `settings.json` (an empty value means **Not set**); the others follow the defaults of the installed version. A changed shortcut that is not valid or clashes with another one loads as that action's default.
