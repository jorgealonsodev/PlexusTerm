<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/plexusterm-wordmark.svg">
    <img src="assets/brand/plexusterm-wordmark-light.svg" alt="PlexusTerm" height="80">
  </picture>
</h1>

<p align="center">
  A terminal and remote-session manager for Linux and Windows.<br>
  Local shells, SSH, SFTP, tunnels, serial, Telnet and Mosh in one window.
</p>

PlexusTerm brings the everyday feature set of another app to Linux as a native app: tabs and split panes, a saved-session library, an SFTP browser next to each SSH tab, port forwards, serial consoles and macros. It is a clean-room implementation (see `docs/reference/another app-feature-inventory.md`) built with Tauri 2 (Rust), React/TypeScript and xterm.js.

## Install

Download the file for your system from the [latest release](https://github.com/jorgealonsodev/PlexusTerm/releases/latest) (`<version>` is the release number, without the leading `v`):

| System | File | Install |
| --- | --- | --- |
| Debian / Ubuntu | `plexusterm_<version>_linux_amd64.deb` (or `arm64`) | `sudo apt install ./plexusterm_<version>_linux_amd64.deb` |
| Fedora / RHEL / openSUSE | `plexusterm_<version>_linux_x86_64.rpm` (or `aarch64`) | `sudo dnf install ./plexusterm_<version>_linux_x86_64.rpm` (`zypper install` on openSUSE) |
| Any Linux, per user | `plexusterm_<version>_linux_amd64.tar.gz` (or `arm64`) | `tar -xzf` it, then run `install.sh` inside the folder (`install.sh --uninstall` removes it) |
| Windows 10/11 | `plexusterm_<version>_windows_x86_64-setup.exe` or `.msi` | Run the installer |

The tarball installs into `~/.local/bin`, `~/.local/share/applications` and `~/.local/share/icons`, and needs the same system libraries as the `.deb` (`libwebkit2gtk-4.1-0`, `libgtk-3-0`).

To verify a download, put it next to the release's `checksums.txt` and run:

```bash
sha256sum --ignore-missing -c checksums.txt
```

## Features

| Feature | What you get | Guide |
| --- | --- | --- |
| Local terminals | Tabs with your shell, up to 4 split panes per tab | [Split panes](docs/user-guide.md#split-panes-and-multi-execution) |
| SSH | Password, key or agent login, `known_hosts` checks, up to 3 jump hosts | [SSH sessions](docs/user-guide.md#ssh-sessions) |
| Saved sessions | Folders, search, passwords in the system keyring, import from `sessions.ini` | [Saved sessions](docs/user-guide.md#saved-sessions) |
| SFTP | File browser for the active SSH tab, upload by drag and drop, follows the shell's folder | [SFTP browser](docs/user-guide.md#sftp-browser) |
| Tunnels | Local (-L), remote (-R) and SOCKS5 (-D) forwards | [SSH tunnels](docs/user-guide.md#ssh-tunnels) |
| Serial, Telnet, Mosh | Serial consoles with line settings, a built-in Telnet client, Mosh over SSH | [Serial](docs/user-guide.md#serial-consoles), [Telnet and Mosh](docs/user-guide.md#telnet-and-mosh) |
| Multi-execution | Type into every open terminal at once, with per-pane exclusion | [Multi-execution](docs/user-guide.md#split-panes-and-multi-execution) |
| Colour schemes | 57 terminal schemes (Catppuccin, Tokyo Night, Gruvbox, Nord, Dracula, Solarized, Rosé Pine, ...) with a live preview, and any font | [Terminal settings](docs/user-guide.md#terminal-settings) |
| Terminal comfort | Find, font size, copy on select, paste confirmation, save and log output | [Terminal settings](docs/user-guide.md#terminal-settings) |
| Macros | Record, edit and replay keystrokes, with waits and hotkeys | [Macros](docs/user-guide.md#macros) |
| Languages | Interface in English, Spanish, German, French, Japanese, Portuguese (Brazil), Simplified Chinese, Korean, Arabic (right to left) and Hindi; follows the system language | [Interface language](docs/user-guide.md#interface-language) |

On Windows everything works as on Linux except Mosh; see [Windows](docs/user-guide.md#windows) for the other differences (shell, home folder, SSH agent, COM ports).

## Quick start

1. Press **Ctrl+Shift+T** for a local terminal, or **Ctrl+Shift+S** to connect over SSH (the host field accepts `user@host:port`).
2. On a first connection, check the host's fingerprint and choose **Trust and connect**.
3. Save the hosts you use in the **Sessions** panel on the left, and double-click one to connect.

Every shortcut is listed in the [user guide](docs/user-guide.md#keyboard-shortcuts).

## Your data

| What | Where |
| --- | --- |
| Sessions, tunnels, settings, macros | `~/.config/dev.plexusterm.app/` on Linux (mode `0600`, never contains passwords) |
| Saved passwords | Only in the system keyring (GNOME Keyring, KWallet), and only if you tick the box |
| Host keys | `~/.ssh/known_hosts`, shared with OpenSSH |

Macros are saved as plain text, including anything typed while recording.

## Documentation

- [User guide](docs/user-guide.md): how every feature works and its limits.
- [Building and releasing](docs/building-and-releasing.md): running from source, tests, packaging and publishing a release.
- [Brand assets](assets/brand/README.md): logo, wordmark and colours.
- [Credits](THIRD_PARTY_NOTICES.md): the colour schemes' authors and original projects, and third-party licences.

## Development

```bash
pnpm install
pnpm tauri dev                                    # run the app
pnpm test                                         # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
```

Build dependencies on Debian/Ubuntu: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`. More in [Building and releasing](docs/building-and-releasing.md).
