# MobaXterm 26.5 — Clean-Room Feature Inventory

Source: `MobaXterm_Personal_26.5.exe` (PE32, Delphi VCL) and the bundled `CygUtils*.plugin` archives.
Method: REA static PE resource inventory (Evidence `ev_a896e964a12b8d02d7c183def9bd68c123b7ff457f140ac486098a1537e3ae09`)
plus visible UI captions from the form resources and zip member listings. No code was decompiled.
This document describes **observable features only**; OxyTerm is an independent implementation.

## Observations vs. unknowns

- Observed: 221 resources; 73 `RT_RCDATA` Delphi forms (`TPF0`), 22 named `EXEFILE` blobs (themes, icons, fonts, changelog).
- Unknown: `MOBASE`, `XW`, `SKINS`, `TXTRES`, `HOTKEYS`, `SEPARAMS`, `BASEPROF` are compressed/opaque; their contents were not inspected.
- The terminal core is PuTTY-based, X11 is an embedded Xorg (per the embedded changelog), and the Unix tooling is Cygwin.

## Session types (from `TFORMSESSIONEDIT`)

SSH, Telnet, Rsh, Xdmcp, RDP, VNC, FTP, SFTP, Serial, File/folder, Browser, Mosh, AWS S3 (experimental), WSL, local Shell.
Each one has "Basic" and "Advanced" settings tabs plus "Bookmark settings" (name, icon, folder).

## Feature areas → forms

| Area | Forms / evidence | Notes for OxyTerm (Linux) |
| --- | --- | --- |
| Main window, tabs | `TFORMXTERM`, `TFORMDETACHEDTAB` | Tabs: close / close others / left / right / inactive, duplicate, detach, cycle; compact mode |
| Session manager | `TFORMSESSIONEDIT`, `TFORMBOOKFOLDEREDIT`, `TFORMSELECTPRESETS`, `TFORMSHAREDSESSIONS`, `TFORMCSVIMPORT`, `TFORMIMPORTEXPORT` | Folder tree, presets, shared sessions, CSV import, "execute all sessions in folder" |
| Terminal settings | `TFORMADVANCEDTERMSETTINGS`, `TFORMFONTSELECTOR`, `TFORMCOLORSSELECTOR`, `TFORMSYNTAX`, `TFORMFINDINTERM`, `TFORMSAVETERM`, `TFORMPASTESETTINGS`, `TFORMCHECKCLIPBOARD` | Font size +/-, color schemes, syntax highlighting, find, save output, paste confirmation, ^H/^? backspace |
| SSH browser (SFTP side panel) | `TFRAMEFTP`, `TFORMCHMOD` | Follow terminal cwd, upload/download, drag & drop, chmod, open with editor, compare files |
| SSH extras | `TFORMSSHPROTOSETTINGS`, `TFORMJUMPHOSTS`, `TFORMHKFINGERPRINTDIALOG`, `TFORMSMARTCARDCHOOSER` | Jump hosts, host-key fingerprints, agent/smart card, remote monitoring bar (CPU/RAM/net/disk/users) |
| Tunnels | `TFORMPORTFORWARDING`, `TFORMPORTFORWARDINGEDIT` | Local/remote/dynamic forwards, start/stop all |
| Multi-exec | `TFORMXTERM` ("multi-execution mode") | Type into several tabs at once |
| Macros | `TFORMMANAGEMACROS`, `TFORMEDITMACROLINE`, `TFORMPOPUPMACRO` | Record, edit, duplicate, export, hotkeys |
| Credentials | `TFORMMANAGEPASSWORDS`, `TFORMMASTERPASSWORD`, `TFORMSTOREPASSWORDS` | Vault protected by a master password |
| Remote desktop | `TFRAMEVNC`, `TFRAMENEWVNC`, `TFORMADVANCEDRDPSETTINGS`, `TFRAMEX11` | On Linux: native X11 forwarding, embed VNC/RDP via external libs |
| Local servers | `TFORMSERVICES` | FTP, TFTP, HTTP, SSH/SFTP, Telnet, VNC, NFS, Cron, Iperf |
| Network tools | `TFORMNETSCAN`, `TFORMNETSTAT` | Port scanner, netstat |
| Serial | `TFORMCHOOSECOMPORT` | Serial ports (`/dev/ttyS*`, `/dev/ttyUSB*` on Linux) |
| Customization | `TFORMCUSTOMIZER`, `TFORMHOTKEYS`, `TFORMICONCHOOSER`, `TFORMRIGHTCLICKMENU`, `TFORMPARAMS` | Themes/skins, keyboard shortcuts, toolbar buttons, settings |
| Misc | `TFORMDESKTOPSHORTCUT`, popup terminal, text editor, update check | |

## Bundled tooling (Cygwin plugins)

ssh/scp/sftp/sshd, autossh, mosh, rsync, git, curl, openssl, kinit/klist (Kerberos), iperf, telnet/rsh/rlogin, vim, zsh/bash, lrz/lsz (ZMODEM), minicom, plus games.
On Linux these come from the system, so OxyTerm should call native binaries or libraries instead of shipping them.

## Excluded from the clone

Branding, icons, skins, fonts (`MOBAFONT`, `MOBAFIRA`, `MOBAFANTA`) and text resources are Mobatek's and are not reused. OxyTerm picks its own typography and visual identity.
