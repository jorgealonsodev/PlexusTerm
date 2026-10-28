# PlexusTerm user guide

How each feature works, its limits and where its data is stored. For installing, see the [README](../README.md#install).

| Section | Covers |
| --- | --- |
| [SSH sessions](#ssh-sessions) | Quick connect, authentication, host-key checks |
| [Serial consoles](#serial-consoles) | Ports, line settings, permissions |
| [Telnet and Mosh](#telnet-and-mosh) | Built-in Telnet client, Mosh over SSH |
| [Saved sessions](#saved-sessions) | Folders, saved passwords, jump hosts, session import |
| [SFTP browser](#sftp-browser) | Remote files of the active SSH tab |
| [File explorer](#file-explorer) | Local files of the active local tab, VS Code-style lists and workspaces in DEV mode, viewing files, dropping files on terminals and on the AI chat |
| [SSH tunnels](#ssh-tunnels) | Local, remote and dynamic (SOCKS5) forwards |
| [Split panes and multi-execution](#split-panes-and-multi-execution) | Panes, typing into several terminals |
| [Sharing a tab](#sharing-a-tab) | A link to watch and type into a tab from another computer or a phone, through your own relay |
| [Interface language](#interface-language) | The ten languages, the system default and getting back to English |
| [Terminal settings](#terminal-settings) | Colour schemes, font, tab and window colours, AI command-line tools and DEV mode, copy and paste, find, copy mode and quick select, saving and logging output |
| [Command suggestions and AI](#command-suggestions-and-ai) | Inline suggestions from your history, AI completion, the AI chat |
| [Macros](#macros) | Recording and playing keystroke sequences |
| [Tools](#tools) | SSH key generator, port and network scanners, Wake On LAN, remote monitor |
| [Updates](#updates) | Being told about a new release |
| [Reporting a problem](#reporting-a-problem) | Sending a bug report or a suggestion |
| [Windows](#windows) | What differs on Windows 10/11 |
| [Command palette](#command-palette) | One box for every action, session, macro, tab and setting |
| [Keyboard shortcuts](#keyboard-shortcuts) | Every shortcut |

## SSH sessions

Open **SSH** (or Ctrl+Shift+S) and enter a host; the field also accepts `user@host:port`.
Authentication: password, private key file (`~/` is expanded, optional passphrase) or the running SSH agent (`SSH_AUTH_SOCK`).

While a host takes time to answer (switched off, unreachable, behind a VPN that is down), the tab says **Waiting for the host… N s (Ctrl+C cancels)** after 3 seconds, counting up; **Ctrl+C** cancels the connection there and then, and the tab stays open with **[Connection cancelled]**. Telnet and Mosh tabs do the same. A connection that would open after it was cancelled is closed at once.

**Reconnecting by itself:** when the network drops or the computer wakes from sleep, an SSH tab is not closed. It says **[Connection lost]** and reconnects with the same login (the saved password in the keyring, a password typed in the tab, the jump hosts' logins), showing **Reconnecting… attempt N of 10 in S s (Ctrl+C cancels)** while it waits. It waits 1, 2, 5, 10 and 30 seconds, then 30 seconds between attempts, 10 attempts at most (about three minutes); the network coming back or the window regaining focus tries at once. A connection that drops again less than 30 seconds after coming back keeps counting (a host that accepts the login and drops it at once runs out of attempts too); one that stayed up longer starts again from the first attempt. **Ctrl+C**, while waiting or during an attempt, stops it with **[Reconnection cancelled. Press Enter to reconnect.]**, and **Enter** then starts the attempts again; after the 10th failed attempt Enter tries again too. A rejected login, a missing password or a host key to trust stops the attempts and shows the usual password or host key prompt; the attempts never prompt by themselves. A clean end of the shell (`exit`, the server ending the session) still closes the tab. The reconnected tab runs a new shell: what was running in the old one is gone, unless it ran in `tmux` or `screen`. A shared tab stops being shared when its connection drops; share it again once it is back. Turn this off with **Reconnect SSH sessions automatically** (Settings → Connections; on by default), and a dropped tab closes as before; turning it off while a tab waits stops its attempts there (Enter still reconnects it). Telnet, serial and Mosh tabs are not affected (Mosh roams by itself). A dead link is noticed within about a minute: terminal tabs send a keepalive every 15 seconds and give up after 3 unanswered. When the network comes back (and when the window regains the focus, at most every 10 seconds), each open SSH tab checks its connection at once: a server that does not answer within 3 seconds is reconnected right away, without waiting for the keepalives. SFTP, tunnels, key installs and the start of Mosh, which do not reconnect, keep a keepalive every 30 seconds.

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
The icons at the top of the Sessions panel are, in order, **New session** (+), **New folder**, **Import sessions** and **Export sessions**; hover one for its name. Use them or the hover actions on a folder; double-click a session (or press Enter) to connect, and the search box filters by name, host, serial device or shell. Drag a session onto a folder (its row, or any session in it) to move it there, or below the list to move it out of every folder; Escape cancels the drag. When a session of the same name (ignoring case) is already there, PlexusTerm asks before moving it.
Right-click a session for **Connect**, **Copy SSH command** (SSH sessions: `ssh -p <port> [-i <key>] user@host`, quoted for a shell, without jump hosts), **Edit…**, **Duplicate** (a copy named "<name> (copy)" next to it; a saved keyring password is not copied) and **Delete**. Right-click a folder for **New session here…**, **New folder here…**, **Connect all** (every session in it and its subfolders, each in its own tab) and **Delete folder**. While the sessions file cannot be read, the menus only offer connecting and copying the SSH command.
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

**Import sessions → From an .ini file…** in the Sessions panel reads a sessions `.ini` file with `[Bookmarks]` sections (UTF-8, or the Windows-1252 code page these files are often written in) and shows a preview before anything is saved:

- SSH sessions from the `[Bookmarks]` / `[Bookmarks_N]` sections are imported with their host, port (22 when missing or invalid) and username, and Telnet sessions with their host and port (23 when missing or invalid), under an **Imported** folder that keeps the folder path saved in the file.
- Imported SSH sessions use password authentication; change it later with **Edit**. Private key paths are not imported.
- Other session types (RDP, VNC, Serial, WSL, FTP, ...), entries without a host and unrecognized lines are skipped and counted per type in the preview.
- Sessions already saved with the same type, folder, name, host, port and username are skipped as duplicates.
- Passwords are never imported: the `[Passwords]` section and any other section are not read.

### Import hosts from ~/.ssh/config

**Import sessions → From ~/.ssh/config** reads the OpenSSH client config of your home folder (`~/.ssh/config`, also on Windows) and shows the same preview:

- Each concrete `Host` alias becomes an SSH session named after it, under **Imported/SSH config**. Wildcard (`*`, `?`) and negated (`!`) patterns are not imported as sessions, but their options apply to the hosts they match, as do options before the first `Host`; like ssh, the first value of each option wins.
- `HostName` (the alias when missing; `%h` is replaced by the alias), `User` (empty when missing), `Port` (22 when missing or invalid) and the first `IdentityFile` are read. A host with an `IdentityFile` uses that private key (`%d` becomes `~`); one without uses password authentication.
- `ProxyJump` hops that are hosts of the same file become the session's jump hosts (at most 3). Other hops, such as `user@gateway:2222`, and `ProxyCommand` are not supported: the host is imported without them and counted in the preview.
- `Include` lines and `Match` blocks are not followed and are counted in the preview. Every other option is ignored.
- Hosts already imported the same way are skipped as duplicates, so importing again only adds new hosts.

### Export sessions

**Export sessions**, the icon after **Import sessions**, saves every saved session and folder to one file (`plexusterm-sessions.json` by default), to back them up or to take them to another computer. It is the format of PlexusTerm's own sessions file: SSH, Telnet, Mosh, serial and local sessions with their folders, jump hosts and key paths. Passwords are not in it (saved ones stay in the system keyring), nor are the private keys themselves, only their paths.

### Sync sessions between computers

Settings → Connections → **Synced folder** keeps the saved sessions in step between your computers through a folder you already sync (Syncthing, Google Drive, Dropbox, Nextcloud…): choose the same folder on each computer. PlexusTerm writes its sessions and folders there in `plexusterm-sessions-sync.json` and reads the changes of the other computers when it opens, when its window gets the focus, every minute and two seconds after you change a session.

- When the same session changed on two computers, the change made last wins (by each computer's clock).
- A session or folder deleted on one computer is deleted on the others too, unless it was changed on another one after the deletion. Deletions are remembered for a year.
- The first time a computer syncs, a session it has that the folder also has takes the folder's version; sessions only on that computer are added for the others. Sessions both computers imported from the same export (each import gives them new ids) are recognised as the same and are not duplicated.
- A change goes to the folder about two seconds after you make it. If PlexusTerm's own sync record (`sessions-sync.json` in the app config folder) is deleted, a deletion made in those last seconds can come back from the folder; delete the session again.
- Passwords never go to the folder (saved ones stay in each computer's keyring), nor do private keys, only their paths: the file is exactly as private as the folder it is in.
- A file in that folder that is not a PlexusTerm sync file is never changed; Settings says so under the folder. The last sync time, or why it failed, shows there too.
- Leave the field empty to stop syncing; the sessions stay as they are.

**Import sessions → From a PlexusTerm export (.json)** reads such a file and shows the same preview. Its sessions go under **Imported**, keeping their own folders below it, and their jump hosts and Mosh logins point to the imported sessions; sessions already imported the same way are skipped, so importing the file again adds nothing.

### Sync settings between computers

Settings → Connections → **Settings synced folder** does the same for the settings, through a folder of its own: the same as the sessions' one or another, and empty (the default) when the settings are not synced. PlexusTerm keeps them there in `plexusterm-settings-sync.json`; for each setting, the change made last wins. The first time a computer syncs, it takes the settings already in the folder; if there are none yet, its own settings start the file. Settings that belong to each computer never leave it: the shell, arguments and starting folder of local terminals, the text editor, the diagnostic log folder, GPU acceleration, both synced folders, and the width and folding of the sidebar and of DEV mode's tab column. API keys and the relay token stay in each computer's keyring. While the Settings window is open the settings are not synced; they sync when it closes.

## SFTP browser

The sidebar has five tabs, **Explorer**, **Sessions**, **SFTP**, **Tunnels** and **Macros**. **Ctrl+Shift+B** or the sidebar button at the left of the toolbar folds it to a strip of the tab icons (click an icon to open the sidebar on that tab) and opens it again; PlexusTerm remembers it. With Settings → General → **Hide the sidebar completely when folded**, folding hides it entirely. Settings → General → **Sidebar when PlexusTerm opens** chooses how it starts: **As I left it** (the default), **Open** or **Folded**. Drag the sidebar's edge to change its width (between 160 and 640 px) and double-click the edge to go back to the default width; PlexusTerm remembers the width too. When the sidebar is too narrow for every icon of a file list's toolbar (SFTP or Explorer), the ones that do not fit go to a second row. SFTP browses the remote files of the active SSH tab (its focused pane) over the same connection (it is disabled for local terminals) and opens automatically when an SSH session connects.

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

The **Explorer** tab of the sidebar browses the local disk while the active tab is a local terminal (it is disabled for other tabs). A new local terminal brings it to the front when the sidebar shows **Sessions** (any other tab you chose stays); PlexusTerm opens on the sidebar tab it was closed on, Sessions included, without the terminal it starts with changing it. In Sessions, the folders you folded stay folded the next time. Switching between a local and an SSH tab swaps the Explorer and the SFTP browser. It works like the [SFTP browser](#sftp-browser) on this computer's files:

- Edit the path bar and press Enter, or use **↑** (parent), **⌂** (home folder) and **⟳** (refresh).
- File icons come in four packs, chosen in Settings → Files, one for the plain lists (the Explorer and the SFTP browser outside DEV mode) and one for DEV mode's trees: **Material** (the colourful icons of VS Code's Material Icon Theme: one per language and format, and folders such as `src`, `docs`, `.git` or `node_modules` with their own; the default for the plain lists), **Seti** (VS Code's own icons; the default for DEV mode) **Classic** (PlexusTerm's first icons: 📁 for folders, 📄 for files and 🔗 for links) and **Lines** (simple line icons: folders tinted, links with a link, files by what they hold, such as code, data, configuration, scripts, documents, images, audio, video, archives, spreadsheets and keys).
- Double-click a folder to open it, or a file to open it in its default program. In DEV mode the list looks like VS Code's Explorer instead (see [DEV mode file lists](#dev-mode-file-lists)).
- The toolbar's icons (hover one for its name) are **New folder**, **New file** (an empty file; an existing one is never replaced), **Rename** (an existing name is never replaced) and **Delete**, which act on the selected entry. Deleting a folder deletes everything in it, after a confirmation.
- Right-click an entry for **Open**, **View** (files: see [Viewing files](#viewing-files)), **Open with default text editor** (the **Text editor** of [Settings](#terminal-settings)), **Open with…**, **Rename…**, **Delete**, **Copy file path**, **Copy file path to terminal** (also a middle click; quoted for the terminal's shell), **Properties** and, on Linux and macOS, **Permissions…**. Files open in place: there is no temporary copy. On folders, **Open in terminal** (right after **Open**) opens a new local terminal tab, with the same shell as the active one, that starts in that folder.

**Show folder in Explorer**, in the right-click menu of a local or SSH tab, makes that tab active and opens the sidebar on the Explorer (the SFTP browser for SSH) at its terminal's folder: the sidebar unfolds, **Follow terminal folder** turns on and a pinned DEV Explorer view of another tab is unpinned.

With **Follow terminal folder** on (the default), the Explorer shows the folder the terminal's shell is in. Shells that report it with OSC 7 (fish, zsh or bash with `vte.sh`), or with OSC 9;9 as the Windows shells below, are followed at once. For other shells PlexusTerm reads the shell's working folder every second while the tab is shown, on Linux and macOS; it is the shell's own folder, not that of a program it runs. On Windows PlexusTerm makes PowerShell, cmd and Git Bash report their folder by themselves at every prompt (OSC 9;9, as Windows Terminal reads it): PowerShell's prompt, including one set by oh-my-posh or Starship in your profile, is wrapped when it starts without arguments of yours; cmd gets the report in front of its `PROMPT`; Git Bash gets it through `PROMPT_COMMAND` (a `PROMPT_COMMAND` set in your `.bashrc` replaces it). WSL is not followed.

### DEV mode file lists

In [DEV mode](#dev-mode) the Explorer and the SFTP browser start at the project the AI tool runs in, and look and work like VS Code's Explorer:

- The list is a tree: click a folder (or its chevron) to expand it in place, and again to collapse it; its entries are listed when it is first expanded, indented under it with thin guide lines. Several folders can be open at once, and they stay open when the list is refreshed. Double-click a folder to list from it (it becomes the top of the tree); double-click a file to show it in the [viewer](#viewing-files) next to the terminal. **Rename…** on a nested entry renames it in its own folder.
- Right-click an entry for VS Code's Explorer menu, with the same keys on the selected entry: **Open to the Side** (Ctrl+Enter, a file in the viewer next to the terminal), **Open Containing Folder** (Ctrl+Alt+R, in the system's file manager), **Open With…**, **Open in Integrated Terminal** (a new terminal tab in that folder), **Cut** (Ctrl+X), **Copy** (Ctrl+C) and **Paste** (Ctrl+V, into the folder right-clicked or the file's folder: a cut entry moves there, a copied one is copied, folders with everything inside, and named `name copy`, `name copy 2`… when the name is taken; nothing is ever replaced), **Copy Path** (Ctrl+Alt+C), **Copy Relative Path** (Ctrl+Shift+Alt+C, from the workspace folder it is in), **Rename…** (F2) and **Delete** (Del). Below them stay PlexusTerm's own: **Open with default text editor**, **Copy file path to terminal**, **Properties**, **Permissions…** and, on a workspace folder, **Remove folder from workspace**.
- Rename in place, as in VS Code: select an entry and press **F2**, and its name becomes a field, with a file's name before its extension selected. **Enter** or clicking elsewhere renames it; **Escape** leaves it as it was.
- Drag a file or folder onto a folder of the tree to move it there (onto a file, it goes to that file's folder; onto the empty space of the list, to the listed folder). PlexusTerm asks first, so an entry dropped by mistake stays where it was. A move never replaces an entry with the same name, and a folder cannot go into itself. Moves stay within the same computer or SSH session.
- The toolbar's last two icons, as in VS Code: **Refresh Explorer** lists everything again (open folders stay open) and **Collapse Folders in Explorer** closes every open folder. You rarely need Refresh: while the terminal prints (an AI tool creating or deleting files) and each time its prompt comes back, the Explorer lists its folders again by itself, at most every 1.5 seconds and only while it is on screen, keeping the selection and the open folders.
- **Open recent** (the clock icon after them) lists the workspace files last opened or saved, then, below a line, the last local folders DEV mode was used in, each list newest first (10 of each by default; Settings → DEV mode → **Recent DEV mode folders to remember** keeps from 1 to 50). Choosing a folder opens a new local terminal there, already in DEV mode, ready to start the tool; choosing a workspace file reads it again and opens it as **Open workspace** does, or says so when it no longer lists any folder. The lists are kept across restarts and shared by every PlexusTerm window. Settings → Shortcuts → **Open recent (DEV mode)** binds a shortcut that shows the same menu from anywhere (none by default).
- With the keyboard: **↓** / **↑** move between entries, **→** expands a folder or moves into it, **←** collapses it or moves to its parent folder, and **Enter** opens a file or expands a folder.
- By default each file has the icon VS Code shows for its type with its default Seti icon theme (chosen by the file's name, its extension or its language, coloured as in VS Code for dark and light schemes), and folders a folder icon; Settings → Files → **DEV mode tree icons** chooses another pack (see [File explorer](#file-explorer)).
- Inside a git repository, entries show their git status (below).
- Select an entry in the Explorer and the bottom of the Explorer shows its repository, as VS Code's status bar does: the project's folder and the branch checked out, with `*` when the repository has uncommitted changes (ignored files do not count). Nothing shows outside a repository or with git status off in Settings.

#### Workspaces

As in VS Code, a DEV tab's Explorer can show several folders at once, a project and the libraries or services it works with, for example. The toolbar's workspace icons (Explorer only):

- In DEV mode the Explorer's folder shows as a root, and **Add folder** adds another folder to the tab's workspace. Every folder, the main one first, shows as a root: a row with a chevron and the folder's name that folds its tree, and a dot coloured by its git changes; each one has its own tree and its own git status. A root's row works like a folder of its tree: right-click it for the same menu, drag it onto a terminal or middle-click it to type its path. Their menu also has **Remove folder from workspace**, which takes the folder out (the folder itself is not touched); removing the main folder makes the first added one the main folder, and the Explorer moves to it; alone, the main folder cannot be removed. **Collapse Folders in Explorer** also closes the roots when there are several, and leaves a lone root open. The added folders belong to that tab and are kept while it is open.
- **Save workspace** writes the main folder and the added ones to a workspace file in VS Code's format (`.code-workspace`, `{ "folders": [{ "path": "..." }] }`), so the same file opens the same folders in VS Code. It is written as VS Code writes it: each folder relative to the file's folder (`.` for the file's own folder; absolute only on another drive), and a new file gets empty `settings`. Saving over an existing workspace file changes only its folders: its comments, settings, extensions, folder names and remote folders stay as they were.
- **Open workspace** opens a workspace file, saved here or by VS Code: a new DEV tab starts in its first folder and adds the others. Folders given relative to the file are taken from the file's folder, and comments and trailing commas of VS Code's files are accepted; remote folders of VS Code workspaces are left out, and a file that lists no folder says so.
- A `.code-workspace` file can also be opened with PlexusTerm itself: `plexusterm project.code-workspace`, or *Open with → PlexusTerm* in the file manager (the deb package registers the file type). PlexusTerm then starts with that DEV tab instead of its usual terminal; when it is already running (Linux), the workspace opens as a new DEV tab of the open window, which comes to the front. Launching PlexusTerm without a workspace file or folder still opens a PlexusTerm of its own.
- A folder can be given the same way, for a file manager's action such as Thunar's custom actions: `plexusterm ~/src`, `plexusterm --working-directory ~/src`, or the `PLEXUSTERM_START_DIR` variable set by a launcher (`PLEXUSTERM_START_DIR=~/src plexusterm`). PlexusTerm starts with its usual terminal in that folder; when it is already running (Linux), the folder opens as a new terminal of the open window. The terminals PlexusTerm opens do not inherit `PLEXUSTERM_START_DIR`. A Thunar custom action, for folders and files (a file opens its folder): `sh -c 'd="$1"; [ -d "$d" ] || d="$(dirname "$d")"; exec plexusterm --working-directory "$d"' _ %f`.

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

### Viewing files

Right-click a file in the Explorer or the SFTP browser and choose **View** (in [DEV mode](#dev-mode), double-clicking a file does the same): it opens in a viewer pane next to the terminal, in the same tab: at its left by default, or at its right or below it with Settings → Files → **Open the file viewer**.

- The text is shown with line numbers; long lines wrap to the pane's width (like **Alt+Z** in VS Code). **Ctrl+F** searches it.
- You can edit it: type in the viewer, with **Ctrl+Z** / **Ctrl+Shift+Z** to undo and redo. A dot in the viewer's title marks unsaved changes; save with the **save** button next to its **×** or with **Ctrl+S**. With Settings → Files → **Save edited files automatically**, the file is saved by itself a second after you stop typing. A file someone else (or an AI tool) changed since it was opened is never overwritten: saving says so and keeps your edits, so you can copy them before closing the viewer. Closing a viewer with unsaved changes (its **×**, its terminal, its tab, or viewing another file in it) asks first, so edits are never thrown away by mistake. The **reload** button (the circular arrow in the viewer's header) reads the file from disk again, for a file another program changed; with unsaved changes it asks first. Files longer than 4 MB (shown only in part) stay read-only, and so does the Markdown preview (edit in **Code**).
- **Changed lines**: for a local file in a git repository, a bar at the left of the text marks the lines that differ from its last commit, as VS Code does: green for added lines, blue for modified ones, and a red mark where lines were deleted. The marks follow the text as you edit it or as the file changes on disk, and are read again when the terminal's prompt comes back (after a commit, for instance). Untracked files and files outside a repository show none. The button next to **save** turns them off and on; the choice is remembered. Files viewed over SFTP are not compared.
- **Status bar**: the bar under the text shows, as in VS Code, the file's encoding, its line endings and its language; click one to choose another from a list. **Encoding** offers **Reopen with encoding** (read the file again decoded with the chosen one, such as Windows 1252 for an old Western file; not while there are unsaved changes) and **Save with encoding** (write it in that encoding from now on). Opening finds UTF-8, UTF-8 with BOM and UTF-16 by themselves; saving keeps the file's encoding and its BOM, and refuses, leaving the file as it was, when the text has characters the encoding cannot hold. **LF** / **CRLF** converts every line break, which is an edit to save (files shown only in part cannot). The **language** list (type to filter it) highlights the text as another language, or as **Plain Text**, only in that viewer.
- The language is recognised by the file's name (TypeScript, Rust, Python, JSON, YAML, shell scripts, and many more) and highlighted with the colour scheme's colours.
- Markdown files open rendered; the **Code** / **Preview** switch in the viewer's title shows their source. In the preview, web links open in your browser; other links do nothing. Scripts, forms and embedded pages in a Markdown file are never run or shown. Images show too: those of the file itself (a path, relative to the file's folder) are read from the same computer or SSH server as the file, only if they are image files (PNG, JPEG, GIF, WebP, SVG, BMP, ICO, AVIF) of up to 20 MiB and never from a network share; web images load over `https:` only (opening the file then contacts their sites), and plain `http:` ones are not shown. A `<picture>` shows the image of its first source that matches (such as a logo for dark themes), as on GitHub. An image that cannot be shown leaves its alternative text.
- The viewer follows its file: while its terminal prints (an AI tool at work) the file is read again at most once a second, and again when the prompt comes back; a changed file is shown in place, at the same scroll position. While you have unsaved changes, the file is not reloaded over them.
- Viewing another file from the same terminal shows it in the same viewer. Close it with its **×**; it also closes with its terminal. Files longer than 4 MB show their first 4 MB; binary files and folders cannot be viewed.
- The viewer counts as one of the tab's 4 panes: when the tab is full, close a pane first.

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

## Restoring tabs at startup

With **Settings → General → Restore tabs at startup** on (the default), PlexusTerm reopens the tabs you had open when it last closed: their order, the active tab, each tab's split panes and their sizes, and the colour you gave a tab.

- A tab opened from a saved session reconnects to that session as it is saved now (edit its host and the restored tab uses the new one). If the session was deleted, its tab is skipped.
- Other SSH, Mosh, Telnet and serial tabs reconnect to the same host or port. A password typed when connecting is never kept, so the terminal asks for it again; a password saved in the keyring is used as usual.
- Local terminals open their shell in the last folder each pane reported (shell integration, OSC 7), else in the folder they started in.
- Tabs that were in DEV mode come back in DEV mode on their folder, with the folders added to their workspace.

Not restored: what the terminals showed (scrollback and output), AI chat and file viewer panes, shared tabs opened from a link, and the tab titles set by the shell. Opening PlexusTerm with a folder or a VS Code workspace file (a file manager's action) opens only that, as before, and that window's tabs are not saved, so the next usual start still brings back the earlier ones; when nothing can be restored, the usual local terminal opens.

The tabs are saved to `tabs.json` in the app config directory (atomic, mode `0600`) a moment after they change and when the window closes. Only what reopens a tab is written: the saved session's id, or the host, port, user and kind of login (no passwords, key passphrases or typed logins), and each local pane's folder. Turning the setting off stops saving and restoring.

## Sharing a tab

**Share…** in a tab's right-click menu gives the tab a link that opens it live in a browser, on another computer or a phone, through a [plexusterm-relay](https://github.com/jorgealonsodev/plexusterm-relay) you run yourself. Nothing moves: the programs keep running on this computer, and the share ends with it.

**Setting up** (Settings → **Sharing**): the relay's **Relay URL** (`wss://…`), the **Viewer origin** that serves the viewer page (`https://…`) and the **Relay token**, which is kept only in the system keyring and is never shown again. `ws://` and `http://` are accepted only for `localhost`. **How to install the relay** there links to its project, which explains how to deploy it.

**Sharing:** the dialog offers **View only** (the default) and **Can type** links, both at once if you want, each with **Copy link** and a QR code; when the share ends (**When I stop sharing**, in 1 hour or in 12 hours: every share ends after 12 hours at most); and the **History sent on join** (the current screen only, or the last 1 000 or 5 000 lines; earlier output may contain secrets). The share uses the tab's focused pane.

- The tab shows a mark with the number of people connected; clicking it opens the dialog again, with the links, who is connected (label, access, address, since when) and **Disconnect**, which also replaces that link, so the viewer cannot come back with it.
- **Joining:** each request shows a desktop notification and a message in the tab with **Allow** and **Deny**. Can type joins ask; View only joins ask too unless **View only joins need approval** is off. **Allow everyone automatically** in the Share dialog lets every join in without asking, Can type included (the dialog warns that this gives a shell to anyone with the link); each join is still notified.
- **While sharing:** **Change to view only** (typing again needs a new share), **Pause viewer input**, and a new end time. A timed share warns 10 minutes before it ends, with **Extend 1 hour**.
- **Viewer typing** is held, never dropped, while you type, while another viewer typed less than 2 seconds ago, while input is paused, and at a password prompt (you are told a password is needed). Password detection is best effort.
- **Can type is a remote shell on your computer:** anything you authorized (sudo, ssh-agent, gh auth) is usable by typing viewers. With **Run sudo -k when a Can type share starts** (on by default) the tab runs ` sudo -k` when the share goes live.
- **Ending:** **Stop sharing**, the expiry, the shared program exiting, or 30 minutes without viewers end it, and viewers are told. Closing a shared tab, or quitting, asks first. If PlexusTerm crashes, the next start says when the share ended.
- **Staying awake:** while any tab is shared the computer does not sleep when idle (Linux: logind; Windows and macOS: their power APIs). On Linux, **Also block lid-close sleep while sharing** blocks lid-close sleep too; on macOS and Windows closing the lid still sleeps.
- **Privacy:** output and input are encrypted end to end for each viewer; the relay sees neither. Browser viewers trust the viewer page's server.
- **Audit log** (**Audit log…** in the dialog or Settings → Sharing): share start and end, join requests, approvals, denials, disconnects, and each viewer's typing (time and byte count; the typed text only with **Record what viewers type in the audit log**). It is kept 30 days in `~/.config/dev.plexusterm.app/share-audit.log`.

**Opening a shared link in PlexusTerm:** **More → Open shared link…** takes a link someone shared with you. PlexusTerm reads the relay from the link's viewer page and asks "Connect to share on <relay-host>?" before connecting; nothing needs setting up on the viewing side. The share opens as a tab at the sharer's size, with copy (Ctrl+Shift+C) and find (Ctrl+Shift+F); you type into it only with a Can type link, while the sharer has not paused input. Its bar says **Terminal of another computer** (hover it for what is blocked) and shows your access. It is an untrusted pane: what the remote program prints never reaches your clipboard, never gets terminal query answers, titles, notifications or links, and is never logged or sent to the AI. While the connection is lost it reconnects by itself (no input is sent meanwhile); when the share ends the pane is cleared and says why. To leave a share, close its tab or choose **Disconnect** in the tab's right-click menu; the share goes on for the others. A share made with a newer protocol asks to update PlexusTerm and offers the browser instead.

## Interface language

PlexusTerm's interface comes in English, Spanish, German, French, Japanese, Portuguese (Brazil), Simplified Chinese, Korean, Arabic and Hindi.

- **Default:** the language of the operating system; when it is none of these, English.
- **Choosing one:** Settings → General → **Language** lists **System** and each language by its own name; choosing one applies it.
- **Getting back:** next to the list, **System language** and **English** are never translated and apply and save at once, without **Save**. If you chose a language you cannot read, open Settings with the gear button and click one of them.
- **Arabic** mirrors the interface right to left. Terminals, commands, code and file paths stay left to right, and split panes keep their places, so **Split right** still opens a pane on the right.
- **Not translated yet:** error messages that come from the connection backend (SSH, SFTP, serial, AI providers) are shown in English. Product names, protocol names, shortcuts and the text sent to AI providers are never translated.

## Terminal settings

**Settings → Appearance → Show only icons in the toolbar** hides the top toolbar labels even in wide windows. Hover an icon to see its action and shortcut; accessible button names are kept. Turn it off to restore labels (narrow windows still switch to icons automatically). The choice is saved for the next launch.

**Settings → Toolbar** arranges the toolbar. It shows the bar, with its drop-down groups (**More** and **Tools** at first), and a **Hidden** area. Drag a button to move it along the bar, into or out of a group, or to Hidden; drag a group by its handle to move it along the bar (groups do not go inside other groups). Every action can go anywhere, including the ones that start inside More and Tools (Telnet, Mosh, Open shared link, the SSH key generator, the port and network scanners, Wake On LAN and the remote monitor). Clicking a button or a group's handle opens a menu with the same moves (move left or right, to the toolbar, to a group, hide), for when dragging is not handy. **New group** adds a group; type its name in place, and the bin deletes it, putting its buttons back on the bar where it was. An empty group is not shown on the toolbar. **Reset** goes back to the default toolbar. Keyboard shortcuts keep working wherever an action sits, also when it is hidden. The logo and the Settings button always stay.

Web links in PlexusTerm (such as **How to install the relay** in Settings → Sharing) open in your default browser, never inside the PlexusTerm window.

The gear button at the right of the toolbar opens **Settings**, shared by every tab and saved in `settings.json` in the app config directory. A side menu splits it into sections, each in named groups: **General** (*Language*; *At startup*: the sidebar when PlexusTerm opens, restoring the tabs of the last run, checking for updates), **Appearance** (*Colours*; *Terminal font*; *Text sizes* of the interface, the AI chat and the file viewer; *Window and panes*: toolbar icons only, hiding the folded sidebar, the focused pane's border, the height of the bar under the terminals), **Toolbar** (where each toolbar button goes: on the bar, in a group or hidden), **Terminal** (*Session*: shell and folder of local terminals, shell integration, date and time in logs; *Keyboard and clipboard*: copy and paste, Shift+Enter; *Display*: error colours, GPU acceleration; *Notifications*: attention notifications, long commands; *Highlight rules*), **DEV mode** (*Commands and folders*: the commands that turn it on, where its + opens, recent folders; *Tab column*; *Bar under the terminal*: its folder, AI plan usage and the OpenCode Go key for it), **Connections** (remote monitor bar; *Sync sessions*: the synced folder, see [Sync sessions between computers](#sync-sessions-between-computers)), **Files** (*File lists*: details, git status, icons, following the terminal; *Viewer and editor*), **AI** (*Command suggestions*, *AI provider*, *Chat*; see [Command suggestions and AI](#command-suggestions-and-ai)), **Sharing**, **Shortcuts** (every keyboard shortcut, see [Keyboard shortcuts](#keyboard-shortcuts)) and **About** (version, project links, updates, diagnostic log and **Open-source licenses**, the libraries PlexusTerm is built with and their license texts, searchable by name or license). The search box at the top of Settings, focused when it opens, finds any option in every section at once: each word you type must appear in the option's name, its choices or its (?) help, in any order and ignoring case and accents; a section or group name shows all its options. Esc empties the search, and a second Esc closes Settings. There is no Save button: every change is applied by itself a moment after you make it (a number or a path is applied when you stop typing), and anything still being edited is applied when Settings closes with **Close** or Esc:

- **Terminal font size** (8-32, default 14). Ctrl+= / Ctrl+- / Ctrl+0 (changeable in Settings → Shortcuts) change it too; every terminal follows at once.
- **Terminal font weight**: Light, Regular (the default), Medium or Semibold; bold text is drawn a step heavier. The fonts shipped with PlexusTerm are variable and draw every weight; other fonts use the nearest weight they have.
- **Terminal line height**: the height of each row as a multiple of the font size, from 1.0 to 1.3 (1.0 by default). Keep 1.0: with GPU acceleration, taller rows no longer fall on whole pixels and the text can look blurred; without it, block and box characters (the logos and borders AI command-line tools draw) come from the font and only touch at 1.0, so taller rows leave thin gaps between them. A height chosen before is kept.
- **Interface text size** (10-20, default 13): the text of the bars, lists and dialogs, apart from the terminals, the AI chat and the file viewer's text.
- **AI chat text size** (10-24, default 13): the text of the [AI chat](#ai-chat); with the focus in the chat, Ctrl+= / Ctrl+- / Ctrl+0 change it.
- **File viewer text size** (10-24, default 13): the text of a file in the [file viewer](#viewing-files), code and Markdown; the viewer's bar follows the interface size.
- **Focused pane border**: the border that marks the pane with the keyboard focus. Its colour is the colour scheme's accent, or one you pick (**Scheme accent** goes back to it), and **Intensity** (10-100%, default 55%) mixes it with the background, from a faint line to the full colour; the sample next to it shows the result.
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
- **New terminal (+) opens in** (default: the starting folder) and **In DEV mode, the + opens in** (default: the active terminal's folder): where the **+** of the tab bar, and the one of the DEV tab column, open a new local terminal. **The active terminal's folder** is the folder of the program running in the active local terminal when you click **+**, else of its shell; from an SSH, Telnet, serial or Mosh tab the terminal opens in the starting folder.
- **Shell integration** (on by default): local shells mark where their prompt ends, when a command starts and how it ended (OSC 133, as VS Code and Windows Terminal read it), so [inline suggestions](#inline-suggestions), the command history and the prompt detection read exactly the command line you type instead of guessing it from the screen. bash, zsh, fish and PowerShell get it only when started without arguments of yours; cmd and Git Bash get it through environment variables either way. bash (with `--rcfile`), zsh (through `ZDOTDIR`) and fish (with `--init-command`) load a small script from `shell-integration` in the app config directory, after your own `.bashrc`, `.zshrc` or `config.fish`, so your prompt theme keeps working and still sees the last exit code. On Windows, PowerShell's prompt is wrapped as described in [File explorer](#file-explorer), Git Bash gets the marks through `PROMPT_COMMAND` and `PS0`, and cmd through `PROMPT`. Limits: PowerShell and cmd have no mark for a command starting, cmd does not report exit codes, bash older than 4.4 gets no end-of-prompt mark, and a `PROMPT_COMMAND` set in Git Bash's `.bashrc` replaces PlexusTerm's. The marks also split the terminal into commands: a command that ends with an error code gets a dot in the colour scheme's red beside its prompt (hover it for the exit code and how long the command ran; click it to open the terminal's AI chat with the command, its exit code and its output attached and the question *Why did this command fail, and how do I fix it?* typed, ready to send), Ctrl+Shift+Up and Ctrl+Shift+Down scroll the previous or next prompt to the top of the terminal and highlight its row for a moment (past the last one, back to the bottom; without marks, or in a full-screen program such as vim, the keys go to the program as before), and **Scroll to the previous / next failed command** in Settings → Shortcuts (no keys by default) or the command palette do the same with the failed commands only; **Run the last failed command again** (no keys by default; also in the command palette) sends it once more at the prompt, after you fixed what made it fail, and does nothing while a command runs, at a password prompt or in a full-screen program, and **Copy command output** in the terminal menu copies what the command under the click printed, without its prompt or command line. A command that runs longer than Settings → Terminal → **Notify when a command takes longer than (seconds)** says when it finishes. A command run inside a full-screen program, and one that never ran (an empty line, Ctrl+C at the prompt), is not marked. The marks also tell the Explorer which folder reports are the shell's: while a command runs, a folder a program reports (an AI tool such as gentle-shell, an ssh session to another computer) does not move it; only the shell's own report at its prompt does. Remote shells get none of this unless they send the same marks themselves. Turn it off to start shells exactly as they are; on Windows they still report their folder for the Explorer. It applies to terminals opened from then on.
- **Copy on select** (on by default): selecting text with the mouse copies it to the clipboard.
- **Right click pastes** (on by default). When it is off, right click opens the terminal menu; Ctrl+right click always opens it, and so does a right click on selected text.
- **Confirm multi-line paste** (on by default): pasting more than one line shows the line count and the first lines before anything is sent. **Don't ask again** turns it off.
- **Show errors in red** (on by default): output lines that look like errors (`error:`, `fatal:`, `command not found`, `Permission denied`, `No such file or directory`, a Python `Traceback`, and the messages of `cmd` and PowerShell on Windows, also when the system speaks Spanish, Portuguese, German, French, Japanese, Korean, Chinese or Arabic) are shown in the colour scheme's red. A terminal cannot tell errors apart, because programs write errors and normal output to the same stream, so lines are recognised by their text: a line that only mentions an error can be coloured too. The output itself is not changed, and programs that use the whole window (`vim`, `htop`) are left alone. The last 1,000 error rows of a terminal stay red; older ones go back to their own colour, so very long sessions stay fast.
- **Shift+Enter starts a new line** (on by default): see [AI command-line tools](#ai-command-line-tools). Off, Shift+Enter sends the same carriage return as Enter.
- **Desktop notifications when a terminal needs attention** (on by default): see [AI command-line tools](#ai-command-line-tools). Off, a terminal asking for attention only marks its tab.
- **Notify when a command takes longer than (seconds)** (10 by default; 0 turns it off): with shell integration, a command that runs at least this long says when it finishes, as a program asking for attention does. In a terminal you are not looking at, its tab is marked; while PlexusTerm is in the background a desktop notification says **Command finished** or **Command failed (exit N)**, with the command and how long it took (for example `npm test · 2 min 14 s`). A terminal you are looking at says nothing.
- **Highlight rules** (one to start with, as an example: IPv4 addresses such as `192.168.1.20` in cyan; remove it and the list stays empty): regular expressions whose matches are coloured in every terminal as output arrives, only the matched text and in the colour you pick, like the error colours: `ERROR|FATAL`, an IP address (`\d+\.\d+\.\d+\.\d+`), a log level or a word you are waiting for. **Add rule** adds one; each has its expression, a colour, **Match case** (off: `error` also finds `ERROR`) and **Notify**, which makes new output that matches mark its tab and, while PlexusTerm is in the background, show a desktop notification with the line (at most once every 10 s per rule). An expression that cannot be used says why and is ignored, and a rule left empty is dropped when Settings close. Rows already on screen are coloured again when the rules change, without notifying again; full-screen programs (vim, htop) are left alone. Up to 50 rules; only the first 4096 characters of a very long line are searched.
- **Commands that turn DEV mode on** (default: `claude, codex, agy, opencode, pi, gentle-shell`): see [DEV mode](#dev-mode). Names are separated by commas or spaces; an empty list turns DEV mode on only by hand. Once DEV mode is on, the default tools are recognised for their icon even when left out of the list.
- **GPU acceleration** (on by default): terminals are drawn with WebGL on the graphics card, which keeps programs that redraw the whole screen many times a second (AI command-line tools, `htop`, `btop`) smooth. When the system has no WebGL 2, or the graphics card drops the context (a driver reset, waking from sleep), terminals switch to the standard renderer by themselves without losing anything. Error colours and selection work the same with both. Turn it off if text looks wrong or flickers with your graphics driver; open terminals switch at once. On Linux, WebKitGTK shows a WebGL terminal several frames late (about 50-70 ms a key, against about 11 ms with the standard renderer) and draws its text without the desktop's font hinting, so letters can look softer; turn it off if typing feels slow or text looks blurry. With NVIDIA's own driver, PlexusTerm makes WebKitGTK hand its frames over through shared memory (`WEBKIT_FORCE_DMABUF_RENDERER=1` and `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`), which removes that delay, so GPU acceleration can be turned on there without lag; it leaves these variables alone when you set any WebKitGTK DMA-BUF variable yourself. NVIDIA's EGL driver can also freeze the window for good (the interface stops answering and the diagnostic log shows `interface (window) not responding` with no recovery), so when the computer also has an Intel or AMD graphics card with Mesa's driver, PlexusTerm draws with that card instead (`__EGL_VENDOR_LIBRARY_FILENAMES` set to Mesa's file); your monitors can stay on the NVIDIA card. Programs started in a terminal do not inherit this choice, and PlexusTerm makes none when you set `__EGL_VENDOR_LIBRARY_FILENAMES` or `__EGL_VENDOR_LIBRARY_DIRS` yourself.
- **Text editor** (default: empty, the system default text editor): the program **Open with default text editor** uses in the SFTP browser. **Browse…** picks a program; you can also type a command with arguments, such as `code --wait` or `"/opt/My Editor/editor" -n`. The file is added as the last argument, or in place of `%f` when the command has one. The command runs directly, never through a shell, and a path to an existing program counts as one program even when it contains spaces. **Use system default** empties the field. A value that is not text or is longer than 1024 characters loads as the system default.

- **Show size and date in file lists** (Settings → Files, off by default): the SFTP browser and the Explorer show each entry's size and modification date next to its name.
- **Show git status in file lists** (Settings → Files, on by default): DEV mode's file lists colour entries by their git status (see [Git status in file lists](#git-status-in-file-lists)). Off, nothing is read and no entry is coloured.
- **Change the terminal's folder when you open a folder in the file browser** (Settings → Files, on by default): opening a folder in the SFTP browser or the Explorer (path bar, double-click, **↑**, **⌂**) runs `cd` to it in the terminal of the same machine (Git Bash gets the path in its `/c/...` form), only when that panel's **Follow terminal folder** is on (turning it off unlinks the panel and the terminal both ways), nothing is typed on its command line and no full-screen program runs. Folders the browser opens by following the terminal never send `cd`.

Pasted text is sent like typed text, so multi-exec forwards it too, and shells that support bracketed paste receive it as a paste.

With text selected, the terminal menu starts with what can be done with it: **Copy**, **Ask the AI about it** (opens the terminal's AI chat with the selection attached, or attaches it to the chat already open), **Type at the prompt** (types the selection at the cursor, asking first when it has several lines), **Find in terminal** (opens the find bar with the selection's first line) and, when the selection is one `http://` or `https://` address, **Open link** (opens it in the browser).

Links in a terminal open with **Ctrl+click** (Cmd+click on macOS); a plain click still selects text. Web addresses (`https://…`) open in your browser. In a local terminal, file paths and file names it prints (such as `docs/PRD.md`, `./src/app.ts:42`, `~/notes/todo.txt`, `README.md` or an absolute path) are underlined when the mouse is over them and the file exists; Ctrl+click opens the file in the [file viewer](#viewing-files), where it can be edited, and shows it in the Explorer, selected, with its folders opened. Relative paths are read from the folder of the program running in the terminal (an AI tool that moved to another folder), else of its shell. Hyperlinks that programs print with a hidden address (OSC 8), web or `file://`, open the same way.

The terminal menu has **Copy**, **Copy command output** (with [shell integration](#terminal-settings), what the command under the click printed), **Paste**, **Select all**, **Clear scrollback**, **Find…** (Ctrl+Shift+F: next/previous, match case, regex; Escape closes it), **Save output to file…** (the whole scrollback of that pane as plain text) and **Log to file…**.

**Copy mode** (Ctrl+Shift+X, or **Copy mode** in the [command palette](#command-palette)) selects and copies from the scrollback without the mouse, as in tmux. A cursor appears on the terminal's cursor and a **COPY** badge at the top right. Move it with the arrows or `h` `j` `k` `l`, `w` / `b` to the next / previous word, `0` / `$` to the start / end of the line, PgUp / PgDn a screen at a time and `g` / `G` to the top of the scrollback / the last line; the terminal scrolls to keep the cursor in sight. `v` starts a selection at the cursor (a second `v` drops it), and `y` or Enter copies it to the clipboard and leaves (a short **Copied** note confirms it). Esc, `q` or Ctrl+Shift+X again leave without copying. While copy mode is on, no key and no paste reaches the shell.

**Quick select** (Ctrl+Shift+Q, or **Quick select** in the command palette) puts a label (`a`, `s`, `d`, `f`…, two letters when there are many) on every web address, file path with a folder in it (`docs/PRD.md`, `/etc/hosts`), IPv4 and IPv6 address, git hash (7 to 40 hexadecimal characters with digits and letters) and e-mail address on screen. Typing a label copies that text and leaves, with a **Copied** note; Shift with the label opens it instead: a web address in your browser, a path as Ctrl+click opens it (when the file exists); the other kinds are copied. Esc leaves. Nothing on screen to label shows **Nothing to select on screen**. Like copy mode, quick select keeps every key from the shell. Labels are placed by character position, so on lines with wide characters (CJK, emoji) they may sit a little to the left of their text.
Logging appends everything the pane receives from then on to the chosen file, without colours or other escape sequences, until **Stop logging** or the pane closes. Each line starts with its date and time, as `[2026-10-27 09:05:07] ` (the time of the half-second batch it was written in; empty lines are left as they are); Settings → Terminal → **Date and time on each line of logs** turns that off for logs started from then on. Tabs being logged show a red dot.

### Tab and window colours

Colours tell windows, tabs and projects apart at a glance, as VS Code's Peacock extension does.

To tell PlexusTerm windows apart, right-click an empty part of the toolbar and pick a colour for this window's toolbar (or **Custom colour…** for any other, **No colour** to go back); its buttons take a shade of the same colour, and the text of the toolbar and of each button turns black or white, whichever contrasts more, so it stays readable (at least 4.5:1, WCAG AA). Each window keeps its own colour while it is open, a reload included; a new window starts without one.

Tabs take colours too: right-click a tab (on top or in DEV mode's column) and choose **Tab colour…** for the same colours; the tab is tinted and gets a bar of its colour (on top, or on the left in the column). **Duplicate tab** keeps the colour.

**Custom colour…** opens a dialog: type the colour's code (`#rrggbb`), choose it in the system's colour picker, or click the eyedropper to pick it from anywhere on the screen: the pointer becomes a crosshair, a click takes the colour under it and Escape or right-click cancels (Windows, Linux with any X11 desktop such as XFCE, MATE or Cinnamon, and Wayland through the desktop portal of GNOME and KDE). **Accept** is painted with the colour, so you see it before you choose it.

In [DEV mode](#dev-mode) on a local tab the colours belong to the project, like VS Code's Peacock: the tab's colour and the toolbar's are saved in the project folder the tool was opened in, in `.plexusterm/settings.json` (`tabColor`, `toolbarColor`), and a tab that goes into DEV mode in that folder gets them again. The toolbar shows the project's colour while one of its tabs is active, and the window's own colour otherwise. The `.plexusterm` folder holds a `.gitignore` of its own, so git ignores it without changing the project's `.gitignore`.

### AI command-line tools

Claude Code, Codex, Gemini CLI, OpenCode and similar tools run in any PlexusTerm terminal, local or remote (SSH, Mosh, Telnet, serial).

- **Shift+Enter** starts a new line in their prompt instead of sending it. A terminal normally sends the same carriage return for Shift+Enter as for Enter, so PlexusTerm sends a line feed instead, the character Ctrl+J sends, which all four tools read as "new line". In a shell a line feed runs the command just like Enter, so nothing changes there. Enter, Ctrl+Enter and Alt+Enter send what they always did. Shift+Enter cannot be given to an application shortcut (shortcuts need Ctrl, Alt or Meta), so it never clashes with one. Turn it off with **Shift+Enter starts a new line** in Settings → Terminal.
- **Attention marks and notifications.** When a program rings the terminal bell or sends a desktop notification sequence (OSC 9 as iTerm2 uses it, OSC 777 `notify` as Ghostty uses it, or kitty's OSC 99) in a terminal you are not looking at, its tab shows an amber dot, and so does the pane when the tab is split. The mark stays until you focus that pane. While PlexusTerm is in the background, a desktop notification also shows the message, or the tab's title and "Needs your attention" for a bell. A program that keeps ringing produces one notification every ten seconds at most, and no more than three notifications come from all terminals together in ten seconds. Nothing happens for the pane you are looking at, so the bell of tab completion while you type stays quiet. Progress reports (OSC 9;4, which Claude Code sends while it works) are not notifications. Turn the desktop notifications off with **Desktop notifications when a terminal needs attention** in Settings → Terminal; the tab mark stays. The first notification asks the system for permission.
  - Codex rings the bell by default in terminals it does not know, PlexusTerm included; set `notification_method = "osc9"` under `[tui]` in `~/.codex/config.toml` to get its message in the notification.
  - Claude Code notifies only in the terminals it recognises (iTerm2, Ghostty, Kitty) unless told otherwise: add `"preferredNotifChannel": "iterm2"` to `~/.claude/settings.json` (or choose it in `/config` → **Local notifications**) to get its message in the notification; `"kitty"` and `"ghostty"` work too, and `"terminal_bell"` only rings the bell.
- **Smooth redraws.** With **GPU acceleration** on (see above), tools that repaint their whole interface while they stream output stay fluid.

### DEV mode

DEV mode turns a tab into a workspace for an AI command-line tool. It belongs to each tab: other tabs keep their normal look.

#### Getting started

A typical session with Claude Code (Codex, OpenCode and the others work the same way):

1. Open a local terminal and go to your project (`cd ~/code/my-app`), or right-click the project folder in the Explorer and choose **Open in terminal**.
2. Run `claude`. The tab turns to DEV mode at once: the tabs move to a column at the right with Claude's icon, the Explorer jumps to the project folder and looks like VS Code (a tree with file icons and git colours), and the bar under the terminal shows the git branch.
3. Ask Claude for a change. While it works, its row shows a turning ring, the files it edits change colour in the Explorer (**M**, **U**...), and a file you opened in the [viewer](#viewing-files) (double-click it) shows its new text as soon as it is written. When Claude needs you and you are in another tab or window, its row gets an amber dot, and a desktop notification tells you once Claude is set to send them (see [AI command-line tools](#ai-command-line-tools)).
4. Open more tabs for other tools or projects with the **+** under the rows: they start in DEV mode too. Give each project a [colour](#tab-and-window-colours) so you always know where you are; PlexusTerm remembers it in the project.
5. Exit Claude (`/exit`). Back at the shell's prompt the tab leaves DEV mode, unless you turned it on by hand with the **DEV** button.

- **On by itself.** A tab turns to DEV mode when a command sent with Enter in its terminal starts one of the commands listed in Settings → DEV mode → **Commands that turn DEV mode on** (by default `claude`, `codex`, `agy`, `opencode`, `pi` and `gentle-shell`). Only the first word counts, also with a path such as `~/.local/bin/claude`, so `claude --resume` turns it on but `echo claude` or `claude-foo` do not. A command recalled from history (Up arrow) or completed with Tab counts too: it is read from the screen. As a fallback, a terminal whose title names one of them (Claude Code sets `✳ Claude Code`, pi `π - <folder>`) turns it on too. This works in local, SSH and Mosh terminals.
- **Off by itself.** It turns off when the shell's prompt comes back in the terminal that started the tool: the shell marks its prompt (OSC 7 or OSC 133, see [Git branch](#git-branch)), the output stops on the same prompt the tool was started from, or the terminal's title becomes the shell's again (any title that does not name the tool and does not start with a symbol such as Claude Code's `✳`). A prompt that changes every time (a clock, the duration of the last command) is compared without its numbers; with a prompt that changes otherwise and no OSC 7 or OSC 133, turn DEV mode off by hand.
- **By hand.** The **DEV** button at the right end of the bar under each local, SSH and Mosh terminal turns the tab's DEV mode on or off (it is highlighted while on; hover it to read whether it is on), and so does **DEV mode on or off** in Settings → Shortcuts (no shortcut by default). Turned on by hand, DEV mode stays on when a tool ends; only the button or the shortcut turns it off.

While a tab is in DEV mode:

- The tab shows the DEV mode icon (`</>`, the same as on the **DEV** button), and while it is the active tab the tabs move to a **column at the right** of the terminals: one row per tab with an icon for the tool it runs (Claude Code, Codex, Antigravity for `agy`, OpenCode, pi, gentle-ai's rose for `gentle-shell`; a terminal icon otherwise), its title (without the mark the tool puts in front, such as the `π -` of pi and gentle-shell; a title that only names the tool, such as `Claude Code`, is left out because the icon says it), the folder the tool was opened in, in grey and a **×** that closes it. The **+** under the rows opens a new local terminal already in DEV mode, by default in the folder the active terminal is in when you click it (the folder of the tool running in it, else of its shell); from an SSH DEV tab it opens in the starting folder. Settings → DEV mode → **In DEV mode, the + opens in** chooses between that and the starting folder. **Duplicate tab** on a DEV tab, and **Open in terminal** on a folder of its file list, open the new terminal in DEV mode too. While the tool in a tab is working (printing on its own, not just echoing what you type), a small turning ring shows next to its icon, in the column and in the tab bar; it stops 1.5 s after the output does (with reduced motion on in the system it is a still ring). The active row is highlighted; clicking a row, middle-clicking it to close it, its right-click menu and its attention and logging marks work as in the tab bar. Drag a row up or down to put its tab in another place (a line shows where it lands). Drag the column's left edge to change its width (between 140 and 480 px) and double-click the edge to go back to the default width; PlexusTerm remembers the width. The toolbar button next to Settings (shown in DEV mode) folds the column to a narrow strip of the rows' icons, each with its tab's title as tooltip, as the sidebar folds; click it again to open the column. Settings → DEV mode → **Hide the DEV tab column completely when folded** hides it instead, and **DEV tab column when PlexusTerm opens** chooses whether it opens as you left it, open or folded. Settings → Shortcuts → **Toggle DEV tab column** binds a shortcut for it (none by default).
- The bar under the terminal names the folder the terminal is in first (with a laptop icon, only its last part; hover it for the whole path), to tell the terminals of a tab apart, then the [git branch](#git-branch); Settings → DEV mode → **Show the terminal's folder in the bar under it in DEV mode** turns it off. In a split tab, a terminal with another terminal below it shows only the **DEV** option, without the bar; the bar of the terminal below shows the branch. Turning DEV mode on with the **DEV** option of one terminal in a split tab shows only that terminal (with its file viewer and AI chat); the tab's other terminals keep running out of sight. The column at the right lists all of the tab's terminals under it, as rows like the tab's (their title, or Terminal 1, Terminal 2…, their folder and **×** to close one), with the one on screen marked; a click on another shows it instead, and they come back, split as they were, when DEV mode is turned off. Splitting while in DEV mode shows the new terminals too.
- The Explorer (local tabs) or the SFTP browser (SSH tabs) goes to the folder the tool was opened in; with its **Follow terminal folder** box on (the default) it then goes wherever the terminal goes, and with the box off it stays at that folder. It also looks like VS Code (see [DEV mode file lists](#dev-mode-file-lists)). Opening folders in it never types `cd` in the terminal, where the tool is running.
- In DEV mode both options show as chips in one row under the toolbar, lit while on: **Follow terminal** (**Follow terminal folder**) and **Pin view**. **Pin view** (Pin Explorer view, off by default) keeps the Explorer on the tab where you turned it on: its folder and the folders added to its workspace stay on screen while you open another terminal (the **+** button, **Open in Integrated Terminal**, a recent folder) or switch to another tab. Turn it off to see the active tab's folders again; closing the pinned tab, or turning its DEV mode off, unpins it.
- Desktop notifications for that tab are sent even when **Desktop notifications when a terminal needs attention** is off.

### The bar under the terminal

**Settings → Appearance → Height of the bar under the terminals (px)** sets the height of the bar under every terminal and file viewer (folder, branch, AI usage, DEV), from 18 to 48 px; 22 by default. Its text and icons grow with it, up to 1.6 times their usual size. Like every setting, it is kept for the next time PlexusTerm opens.

### Git branch

In [DEV mode](#dev-mode), when a terminal's current folder is inside a git repository, a bar under the terminal shows the branch with a branch icon, for example `main`, like the remote monitor bar; on SSH tabs with the remote monitor on, the branch opens that same bar. With no branch checked out (a detached `HEAD`) it shows the short commit instead, such as `72e8845`; outside a repository nothing is shown. A split tab shows the branch of its focused pane.

On a local terminal, click the branch to list the repository's other branches: its local ones, then the remote ones that have no local branch yet, marked **(remote)**. Choose one and PlexusTerm runs `git switch` with it in the terminal's folder, without typing anything into the terminal, so it also works while an AI command-line tool runs there; a remote branch becomes a local branch that tracks it. When git refuses (uncommitted changes the switch would overwrite, for example) a notice gives git's reason and the branch stays as it was. On SSH tabs the branch is only shown.

- **Local terminals** read the branch from the repository's files, without starting `git`: worktrees and submodules (whose `.git` is a file pointing elsewhere) work too.
- **SSH terminals** run one read-only command on the server over the same connection (`git -C <folder> symbolic-ref --short -q HEAD`, or `git rev-parse --short HEAD` when detached). A server without git shows no branch.
- Mosh, Telnet and serial terminals show no branch: PlexusTerm has no separate channel to ask through.

The folder is the one the shell reports with OSC 7; for shells that do not, PlexusTerm asks for the shell's folder (Linux servers for SSH). The branch is read again when the folder changes and when the prompt comes back after a command, so `git checkout` or `git switch` shows up as soon as it finishes. While an AI tool runs in the terminal its prompt does not come back, so the branch is also read every 1.5 seconds (every 5 seconds over SSH, where each read runs commands on the server), in the folder of the tool itself: a branch it switches or a git worktree it moves to shows at once. On Windows, where the tool's folder cannot be read, the shell's is used. Outside DEV mode no branch is shown and nothing is read.

### AI plan usage

The bar under a terminal can show how much of an AI plan's limits is spent, next to the DEV button: for example `5h 42%  7d 18%`, the 5-hour window and the week. A window at 80% or more turns amber, a reached limit red. Hover over it for each window's reset time (OpenCode Go also has a monthly window, shown there).

It is **Off** until you choose what it shows: the bar keeps only an "off" icon. **Auto** follows the [DEV mode](#dev-mode) command-line tool running in the terminal: Claude Code, Codex, Antigravity (`agy`), or OpenCode for OpenCode Go; other programs show nothing. Click it to show one provider in every terminal instead, back to **Auto**, or **Refresh now**. **Off** stops reading the usage and leaves only an "off" icon in the bar; click it and choose a provider or **Auto** to turn it on again. **Settings → DEV mode → Show AI plan usage in the bar under each terminal** turns it off, and **Usage shown** makes the same choice.

- **Codex**: read from ChatGPT's usage service (`chatgpt.com/backend-api/wham/usage`, the one the Codex CLI itself reads) with the ChatGPT sign-in Codex keeps in `~/.codex/auth.json` (or `$CODEX_HOME`). The token is sent only there and never saved or shown. An API key sign-in has no plan limits to show; when the sign-in has expired, run `codex` once to sign in again.
- **Antigravity**: asked of Antigravity's own language server on this computer (`127.0.0.1`), the way its quota panel does, so it works while the Antigravity IDE or `agy` runs; nothing leaves the computer. Its limits are per group of models (Gemini; Claude and GPT): the bar shows the fullest group and the tooltip each one.
- **OpenCode Go**: read from OpenCode's usage API with **OpenCode Go API key for the usage** (Settings → AI, kept in the system keyring apart from the AI one), or, when none is saved there, the OpenCode Go key in **Settings → AI**.
- **Claude Code**: read from Anthropic's usage service (`api.anthropic.com/api/oauth/usage`, what Claude Code's `/usage` shows) with the Claude plan sign-in Claude Code keeps in `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`; the Keychain on macOS). The token is only read: PlexusTerm never renews it, saves it or shows it. When it has expired, open Claude Code once and it renews it. An API key sign-in has no plan limits to show.

Each provider is read only while a bar showing it is on screen, and every PlexusTerm window shares the reads: Claude Code, Codex and OpenCode Go are asked at most once every 5 minutes (their services limit how often an account may ask, and Claude Code and Codex ask too), Antigravity, which answers on this computer, once a minute. After a failed read (a limit reached, no connection) the wait doubles each time, up to 30 minutes, and a good read brings it back. **Refresh now** reads again at once, but never sooner than a minute after the last read. OpenCode with other providers only keeps a cost total (`opencode stats`), so it is not offered.

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
- Settings → Appearance → **AI chat text size** (10-24, default 13) sets the size of the chat's text apart from the terminals and the rest of the interface; with the focus in the chat, Ctrl+= / Ctrl+- / Ctrl+0 change it too.
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

When PlexusTerm starts it asks GitHub for the latest published release, once. A newer release appears in a card at the bottom right of the window. The close button hides the card until the next start, and a failed startup check (no network, GitHub unavailable) shows nothing. Nothing downloads until you choose **Download**.

The notice and **Settings → About** offer these independent actions:

- **Download** downloads, verifies and installs the package matching your current installation. Linux `.deb` and `.rpm` updates request administrator authorization through the system; Windows installers use UAC. Unknown formats or missing matching packages fail visibly rather than switching formats.
- **Visit download page** opens that release in your browser for manual installation. It stays available during installation and after an error.
- **See what's new** shows the release's notes from GitHub under the actions, before or while it downloads; **Hide changes** folds them again. Links in the notes open in your browser. Releases without notes show no such button.

Supported matching formats are Linux `.deb`, `.rpm`, user-owned portable `.tar.gz` and AppImage, plus Windows MSI and NSIS. **pacman/AUR installations stay with their package manager**: when pacman owns the running executable, Download stops with guidance to update using your package manager or AUR helper, without downloading a substitute package or running an installation. Retrying does not bypass this protection. Windows package-manager ownership (including winget) is not inferred from MSI registration. Real Windows, AppImage and ARM acceptance testing remains unavailable.

Both entrypoints show shared progress and prevent duplicate installations. Closing either UI does not cancel the operation; reopen About to see its progress or result. A failure shows its reason and **Retry download**. After an installed update or a completed Windows installer, **restart PlexusTerm manually when ready**. PlexusTerm never restarts itself, closes the app, or terminates your sessions. See [installation matching and safety](update-installation.md) for supported formats and limits.

**Check for updates** in About still checks manually and reports up-to-date versions or check failures. Turn off **Check for updates at startup** in Settings → General to disable only the startup check; manual checking still works. The check requests the latest release of the public repository, with PlexusTerm's version as the user agent; choosing Download then requests the matching official release assets.

## Reporting a problem

Settings → About has **Report a problem** and **Suggest an improvement**. Each opens a form on GitHub in your browser; the bug form already has your PlexusTerm version filled in. Nothing is sent until you submit the form there, and a GitHub account is needed. Remove passwords, keys and host names from what you write. Report security vulnerabilities privately, as the [security policy](https://github.com/jorgealonsodev/PlexusTerm/security/policy) explains, not in a public issue.

### Diagnostic log

If PlexusTerm sometimes stops responding, turn on **Write a diagnostic log** in Settings → About. It writes `plexusterm.log` in **Log folder**; leave the field empty to use the folder it shows (on Linux `~/.local/share/dev.plexusterm.app/logs`). The log records the version, the graphics cards (with their driver), the sessions opened and closed, errors and panics, graphics problems (the GPU WebGL uses, the graphics variables of the session, a terminal's WebGL renderer failing to start or losing its context after a driver reset or sleep), and when the window or the backend stops responding and for how long (or the window's thread was blocked for a second or more; a hidden window, whose timers the system slows down, is never counted) (`interface (window) not responding for 6.0 s`, `backend async runtime not responding …`). It never records what you type or what the terminals show; SSH entries name the user, host and port. At 5 MB the file moves to `plexusterm.log.1` and a new one starts. Attach it, after checking the host names, to a problem report.

## Windows

PlexusTerm also builds for Windows 10/11. Everything works as on Linux except:

- **Local terminal**: the default shell is PowerShell 7 (`pwsh.exe`) when it is on `PATH`, otherwise Windows PowerShell (`powershell.exe`), with `%COMSPEC%` as the last fallback; it starts in `%USERPROFILE%`. Settings → Terminal → **Shell for local terminals** picks another one, such as cmd, WSL or Git Bash.
- **File explorer**: following the terminal folder needs the shell to send OSC 7 (see [File explorer](#file-explorer) for PowerShell); Windows does not let PlexusTerm read another program's working folder. **Permissions…** is not offered.
- **DEV mode**: the AI tools are recognised in PowerShell and cmd as in other shells (cmd's `C:\path>` prompt and its window titles included). The Explorer opens at the tool's folder, and the git branch shows, only when the shell reports its folder with OSC 7 (the PowerShell prompt of [File explorer](#file-explorer)); otherwise they stay where they were.
- **Error colouring**: errors are coloured from their English wording and from the C library's and bash's translated messages; the translated messages of cmd and PowerShell are not recognised yet.
- **Eyedropper**: **Custom colour…** picks colours from the screen with the webview's own eyedropper.
- **Home directory**: `~` is `%USERPROFILE%`, so host keys go to `%USERPROFILE%\.ssh\known_hosts` and key paths accept both `~/` and `~\`.
- **SSH agent**: `SSH_AUTH_SOCK` when set, otherwise the Windows OpenSSH agent pipe `\\.\pipe\openssh-ssh-agent` (start the "OpenSSH Authentication Agent" service and add keys with `ssh-add`).
- **Saved files** (sessions, settings, macros) rely on the permissions of your user profile instead of Unix file modes.
- **Serial consoles** list the COM ports reported by Windows (`COM3`, ...) and accept a typed port name.
- **Port and network scanners**: Windows retries a refused connection for about two seconds, longer than the one-second probe, so closed ports may be listed as **filtered**. Open ports are found as on Linux.
- **Mosh** is not offered: there is no packaged `mosh-client` for Windows. A Mosh session imported or saved elsewhere reports "Mosh is not available on Windows" unless a `mosh-client.exe` is on `PATH`.

## Command palette

**Ctrl+Shift+P** opens a box at the top of the window that reaches everything without the mouse. Type to narrow the list; each word must appear, in any order and ignoring case and accents, and the names that start with what you typed come first. It lists:

- **Actions**: every action of Settings → Shortcuts, with its shortcut when it has one (new terminal, split, find, copy the last command's output, the tools…). The terminal's own actions (find, copy, clear…) act on the focused terminal.
- **Sessions**: your saved sessions, also found by their folder; choosing one connects, as a double-click in the Sessions tab does.
- **Macros**: plays the macro in the focused terminal.
- **Tabs**: the open tabs, to switch to one.
- **Settings**: opens Settings at that section.

↑ and ↓ move through the list, Enter or a click runs the highlighted item, and Esc or a click outside closes it.

**Ctrl+Shift+H** opens the same kind of box with the **command history** of the focused terminal's computer (this computer for local terminals, the server for SSH ones), newest first: type part of a command to narrow it, and Enter types the chosen one at the prompt without running it, so you can change it before pressing Enter. Ctrl+R stays the shell's own history search. Its shortcut can be changed in Settings → Shortcuts (**Command palette**, under Tools).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New local terminal tab |
| Ctrl+Shift+S | New SSH session (quick connect) |
| Ctrl+Shift+P | Command palette: every action, session, macro, tab and setting in one box |
| Ctrl+Shift+H | Search the command history of the focused terminal's computer and type the chosen command |
| Ctrl+Shift+D | Split the focused pane right |
| Ctrl+Shift+E | Split the focused pane down |
| Ctrl+Shift+W | Close the focused pane (the tab closes with its last pane) |
| Alt+Arrow | Move the focus to the neighbouring pane |
| Ctrl+Shift+M | Turn multi-execution on or off |
| Ctrl+Shift+F | Find in the focused terminal |
| Ctrl+Shift+X | [Copy mode](#terminal-settings): move a cursor over the scrollback with the keyboard, `v` selects, `y` copies, Esc leaves |
| Ctrl+Shift+Q | [Quick select](#terminal-settings): type a label to copy a URL, path, IP address, git hash or e-mail on screen (Shift+label opens it) |
| Ctrl+Shift+C | Copy the selection |
| Ctrl+Shift+V | Paste |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Scroll to the previous / next command's prompt (with shell integration; otherwise the keys go to the program) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Larger / smaller / default font size (every terminal; with the focus in the AI chat, the chat's text) |
| Ctrl+Shift+R | Start or stop recording a macro |
| Ctrl+Shift+B | Fold the sidebar to its icons (or hide it) and open it again |
| Ctrl+Alt+1 … Ctrl+Alt+9 | Play the macro bound to that key in the focused terminal |
| Escape (while a macro plays) | Stop the macro |
| Right Arrow / End (with a grey suggestion) | Accept the suggested command |
| Ctrl+Right (with a grey suggestion) | Accept the next word of the suggestion |
| Ctrl+Shift+Space (changeable) | Open the AI chat below the focused terminal, or switch between a terminal and its chat |
| Shift+Enter | New line in AI command-line tools (sends a line feed, like Ctrl+J; see [AI command-line tools](#ai-command-line-tools)) |
| Middle click on a tab | Close that tab |
| Drag a tab | Put it in another place, on top or in DEV mode's column; a line shows where it lands |
| Right click on a tab | Share… (Sharing… while shared), Copy host address (SSH, Telnet and Mosh tabs), Show folder in Explorer (local and SSH tabs), Duplicate tab, Tab colour…, Close tab, Close other tabs, Close tabs to the right (Close tabs below in DEV mode's column), Close all tabs |

These are the defaults. Shortcuts handled by the app never reach the shell.

### Changing shortcuts

Settings → **Shortcuts** lists every action PlexusTerm can run from the keyboard, grouped as **Tabs and panes**, **Connections**, **Terminal**, **Font size**, **Sidebar and macros**, **Tools** and **AI assistant**:

- Click a shortcut and press the new combination; Escape keeps the current one. A shortcut needs Ctrl, Alt or Meta with a key. A combination another action already uses is refused, naming that action; so are the fixed keys below and the AI assistant's shortcut.
- **Clear** removes an action's shortcut: the action shows **Not set** and the keys go to the terminal again. **Reset** gives one action back its default, and **Restore defaults** does it for all of them, the AI assistant included. Changes apply on **Save**.
- Many actions have no shortcut until you set one: close tab, next and previous tab, new serial, Telnet and Mosh connections, select all, copy the last command's output, scroll to the previous or next failed command, run the last failed command again, clear the terminal, save output to a file, start or stop logging, turn the tab's DEV mode on or off, fold or open DEV mode's tab column, show DEV mode's Open recent menu, ask the AI about the focused terminal, show each sidebar tab (Sessions, SFTP, Explorer, Tunnels, Macros), the SSH key generator, port scanner, network scanner and Wake on LAN, the remote monitor bar, and opening Settings. Terminal actions (find, copy, paste, select all, copy mode, quick select, previous and next command, copy the last command's output, clear, save output, logging, ask the AI) act on the focused terminal.
- Tooltips and help texts show the shortcuts as they are set; an action without one shows none.
- **Fixed keys** are listed for reference and cannot be changed: Ctrl+Alt+1–9 (play the macro bound to that key), Right Arrow / End (accept an inline suggestion) and Ctrl+Right (accept one word of it).

Only the changed shortcuts are saved, under `shortcuts` in `settings.json` (an empty value means **Not set**); the others follow the defaults of the installed version. A changed shortcut that is not valid or clashes with another one loads as that action's default.
