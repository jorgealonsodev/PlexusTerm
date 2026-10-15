# NexusTerm MVP

Objective: Linux terminal inspired by MobaXterm (clean-room, see `docs/reference/mobaxterm-feature-inventory.md`). Branch `feat/nexusterm-mvp`.
Stack: Tauri 2 + Rust backend + React/TypeScript + xterm.js. Delivery: ask-on-risk. Test runners: `cargo test` (src-tauri), `pnpm test` (Vitest).

## Specs

- S1: "Quiero crear un terminal como mobaxterm en linux" — the app runs on Linux and mirrors MobaXterm's observable feature set, not its code, branding or assets.
- S2: "la tipografia puede ser diferente" — NexusTerm uses its own typography; no Mobatek fonts, icons or skins.
- S3: Stack chosen by the user: "Tauri 2 + Rust + xterm.js".
- S4 (assumption, MVP scope): local shell tabs backed by a PTY (open, type, resize, close).
- S5 (assumption, MVP scope): SSH sessions (password and key/agent auth) in tabs.
- S6 (assumption, MVP scope): session manager — saved sessions in a folder tree, persisted locally.
- S7 (assumption, MVP scope): SFTP side browser for the active SSH session (list, upload, download, follow terminal cwd).
  - S7.1 Backend: SFTP over the existing SSH connection of a terminal session (one cached SFTP channel per session, opened lazily). Operations: home (canonicalize "."), list, download (streamed to a local path), upload (local file into a remote dir), mkdir, remove (file or empty dir), rename.
  - S7.2 List entries: name, full path, kind (file|dir|symlink), size, modified (unix seconds, optional), permissions (optional); "." and ".." excluded; directories first, then case-insensitive name order.
  - S7.3 UI: left sidebar gets two tabs, "Sessions" and "SFTP"; SFTP shows the browser of the active SSH tab (disabled for local tabs) and the sidebar switches to it automatically when an SSH session connects.
  - S7.4 Browser: editable path bar, up / home / refresh, double-click folder to enter, double-click file to download via a save dialog, toolbar Upload (multi-select open dialog), New folder, Rename, Delete (with confirmation), Download; dropping OS files on the panel uploads them to the current folder.
  - S7.5 Follow terminal folder (toggle, on by default): the terminal reports the remote cwd from OSC 7 sequences and the browser follows it; README explains how to make a remote bash emit OSC 7.
- S8 (assumption, later): tunnels, macros, multi-exec, password vault, split panes, serial, VNC/RDP.
- S9 (decided by the parent under L13 "haz lo que te creas mas optimo"): SSH tunnels, like MobaXterm's MobaSSHTunnel.
  - S9.1 Types: local (`-L`: listen on listenHost:listenPort, forward through the SSH server to destHost:destPort), remote (`-R`: the SSH server listens on listenPort and forwards to destHost:destPort reachable from this machine), dynamic (`-D`: SOCKS5 proxy on listenHost:listenPort; no-auth method, CONNECT command, IPv4/IPv6/domain addresses).
  - S9.2 Each tunnel uses its own SSH connection to a saved session (S6) chosen by id; key/agent sessions start directly, password sessions ask for the password when the tunnel starts (never stored). The known_hosts policy is the same as S5 (unknown host → fingerprint prompt → retry with trust; changed key → refused).
  - S9.3 Listeners bind to 127.0.0.1 by default; any other listen address must be typed explicitly and the editor shows a warning that other machines can reach it.
  - S9.4 Tunnel definitions persist in tunnels.json via the atomic 0600 storage (same rules as sessions: an unreadable file disables editing; no secrets stored). Fields: id, name, type, sessionId, listenHost, listenPort, destHost, destPort (dest fields unused for dynamic).
  - S9.5 UI: a third sidebar tab "Tunnels" listing every tunnel with its status (stopped / starting / running / error with message) and a start/stop toggle; New, Edit, Delete (confirm), Start all, Stop all. Stopping closes the listener, open forwarded connections and the SSH connection. Running tunnels stop when the app exits.

- S10 (decided by the parent under "haz lo que te creas mas optimo"): import saved sessions from a MobaXterm configuration file (`MobaXterm.ini`).
  - S10.1 The Sessions panel gets an "Import" action that opens a file picker for the .ini file (read in the webview; nothing is uploaded or stored besides the imported sessions).
  - S10.2 Sections `[Bookmarks]` and `[Bookmarks_N]` are read; `SubRep` is the folder (backslashes become "/"); `ImgNum` and other metadata keys are ignored. Imported sessions go under a top-level folder "MobaXterm" followed by their SubRep path.
  - S10.3 Session lines are `name=#<type>#<n>%field0%field1%...`. Type 109 is SSH: host = field0, port = field1 (default 22 when empty or invalid), username = field2. Imported SSH sessions use password authentication (asked at connect time; editable later). Lines with an empty host are skipped as invalid. Private key paths are not imported (their position in the line is not documented).
  - S10.4 Other session types (e.g. 98 Telnet, 1 RDP, 2 VNC, 131 Serial, 105 WSL, 4 FTP, unknown codes) are not imported yet; the import reports how many were skipped per type. The `[Passwords]` section and any stored secrets are never read into NexusTerm.
  - S10.5 A preview dialog shows: sessions to import, duplicates (same folder, name, host, port and username already saved) that will be skipped, and skipped counts per type/reason; the user confirms before anything is saved.
  - S10.6 Encoding: decode as UTF-8 when valid, otherwise as Windows-1252 (MobaXterm writes the ANSI code page).
  - Source for the line layout: open-source parser bobzzgm/mobaxterm-mcp (src/services/ini-parser.ts); no real MobaXterm.ini was available to verify against.

- S11 (decided by the parent under "haz lo que te creas mas optimo"): split panes and multi-execution, like MobaXterm's split and MultiExec modes.
  - S11.1 A tab can be split into panes: split right (side by side) and split down (stacked), as a binary layout tree with at most 4 panes per tab. A new pane opens a new terminal for the same target as the pane it was split from (local shell, or a new SSH connection with the same target, reusing the credentials already held in memory for that tab; nothing new is stored).
  - S11.2 Panes have a draggable divider (ratio clamped to 15%-85%); the focused pane is highlighted; clicking a pane focuses it; Alt+Arrow moves focus to the neighbouring pane. Closing a pane (its shell exits, or Ctrl+Shift+W) closes only that pane; the tab closes when its last pane closes.
  - S11.3 Shortcuts: Ctrl+Shift+D split right, Ctrl+Shift+E split down, Ctrl+Shift+W close the focused pane (previously closed the whole tab), Ctrl+Shift+M toggle multi-execution. The toolbar gets "Split right", "Split down" and "Multi-exec" buttons; README shortcut table updated.
  - S11.4 Multi-execution: when on, what is typed in the focused pane is also sent to every other open terminal pane in every tab. A clear banner shows "Multi-execution ON — input goes to N terminals" with a button to turn it off; each pane shows a small "excluded" toggle so a pane can be left out; excluded panes and panes still connecting do not receive input. Multi-execution is off at start and is never persisted.
  - S11.5 SFTP and OSC 7 cwd follow the focused pane of the active tab.

- S12 (decided by the parent under "haz lo que te creas mas optimo"): serial console sessions, like MobaXterm's Serial session type.
  - S12.1 A new terminal target "serial" with: device path (e.g. /dev/ttyUSB0), baud rate (default 115200; common values offered plus a custom value), data bits 5-8 (default 8), parity none/odd/even (default none), stop bits 1/2 (default 1), flow control none/software/hardware (default none). Input is sent as typed (Enter sends CR); resize is a no-op.
  - S12.2 A toolbar "Serial" button opens a dialog listing detected ports (refresh button) plus a free-text device path; the tab title is "<device> @ <baud>".
  - S12.3 Saved sessions support the serial type next to SSH: the saved format gains a `kind` field ("ssh" | "serial"); files written before this change (no `kind`) keep loading as SSH; the edit dialog switches fields by kind; double-click opens a serial tab. No secrets are involved.
  - S12.4 Errors are explicit: permission denied explains that the user must be in the "dialout" group (and log out/in); a missing or busy device says so; when the device disappears while open (USB unplugged) the tab shows the error and ends.
  - S12.5 Port listing must not require libudev development headers (they are not installed on the target machine); enumerate without the libudev feature (sysfs/device scan). Tests never open real devices: they use a pseudo-terminal pair as the serial device.

## Tasks

- [x] T1 — S1-S4 — inline — Scaffold Tauri 2 + React + xterm.js app with local PTY tabs. RED→GREEN: cargo 8/8, vitest 7/7; smoke test via `pnpm tauri dev` (UTF-8 + colors OK).
- [x] T2 — S5 — inline — SSH session backend (russh) + tab integration. RED→GREEN: cargo 20/20 (in-process russh server: password, key, host-key policy, resize, exit status), vitest 22/22; UI smoke OK (trust prompt → shell echo). Real OpenSSH interop not tested (no sshd installed).
- [x] T3 — S6 — inline — Session manager UI + persistence. RED→GREEN: cargo storage 6/6 (atomic write, 0600, concurrent saves RED without unique temp names), vitest library/sessionForm; panel component tests added after implementation (regression). UI smoke: folder via prompt, session saved without password, password prompt → connect error shown.
- [x] T2b — S5 — inline — Verifier advisories: reader/writer split (4 MiB paste test RED: stalled 20s → GREEN), otherKnownKeys warning, Debug redaction, IPv6 parsing, agent tries every identity (+ real ssh-agent test). cargo 31/31, vitest 49/49.
- [x] T4 — S7 (S7.1-S7.5) — delegated (writer trigger: long-session context backstop, parent context ~180k) — SFTP side browser. Writer: cargo 43/43, vitest 62/62 (RED→GREEN for sftp ops + helpers; panel tests regression). Independent verifier: no blockers, S7.1-S7.5 PASS. Parent fixes: download via temp file + rename (RED: existing file lost → GREEN), dialog capability narrowed to allow-open/allow-save. Smoke: connect → SFTP tab auto-switch → list → enter folder → download 300000 B byte-exact.

- [x] T5 — S9 (S9.1-S9.5) — delegated (writer trigger: long-session context backstop) — SSH tunnels. Writer: cargo 61 (+17 tunnel tests RED→GREEN), vitest 79. Verifier: 1 blocker (stop while Starting kept the listener bound up to 15 s) → parent fix with a oneshot cancel (RED: start hung >2 s → GREEN); cargo 62/62. Interop vs OpenSSH 9.7: local tunnel + shell + SFTP 3/3 (script now enables AllowTcpForwarding, Alpine default is "no"). UI smoke vs real sshd: create → trust prompt → running → nc through tunnel → stop closes port (4/4 cycles; 1 earlier failure not reproduced, consistent with the blocker).

- [x] T5c — S9.5 — delegated (context backstop) — Native review warnings for T5: SOCKS5 handshake timeout (R1-001/R4/R3), Running/Stopped notification ordering (R4/R3-start-notify-race), status snapshot vs newer events (R3-snapshot-overwrite), delete during password/host-key prompt (R4/R3-delete-during-prompt), silent start failures (R3-silent-start-failure), connection-drop watcher test (R3-watch-fail-untested). Done: SOCKS 10 s handshake deadline, notifications sent under the entries lock (ordered), snapshot only fills tunnels without live events, prompts re-check the tunnel before starting, IPC failures surfaced; watcher test via aborted TCP proxy. RED→GREEN per finding; cargo 67/67 (+3 ignored), vitest 86/86.

- [x] T6 — S10 (S10.1-S10.6) — delegated (writer trigger: long-session context backstop) — Import sessions from MobaXterm.ini. Writer: parser/planner/saveSessions/dialog RED→GREEN (vitest 101). Parent: hidden <input type=file> could not be confirmed in WebKitGTK → switched to the native dialog (plugin-dialog open) + bounded backend read `import_read_file` (5 MiB; storage::read_bounded RED→GREEN); header layout fix (buttons wrap). Smoke with a cp1252/CRLF ini: native dialog → preview "2 SSH sessions to import; RDP 1, Serial 1, SSH without a host 1" (correct). Confirm click not exercised in the GUI (user was using the desktop); covered by component + reducer tests. cargo 69/69, vitest 103/103.

- [x] T7 — S11 (S11.1-S11.5) — delegated (writer trigger: long-session context backstop) — Split panes and multi-execution. Writer: layout/neighbour/broadcast/tab actions RED→GREEN, App-level tests proven by temporary breaking changes; panes rendered as flat keyed siblings so splits never remount terminals; xterm custom key handler stops Ctrl+Shift+D reaching the shell as EOF. vitest 141/141. Parent smoke on a private Xvfb display (:99): split right/down, isolated input, multi-exec broadcast to 2 panes, Ctrl+Shift+W closes only the focused pane (other keeps its history and focus). Parent fix: exclude toggle moved to the bottom-right (it covered terminal text).

- [ ] T8 — S12 (S12.1-S12.5) — delegated (writer trigger: long-session context backstop) — Serial console sessions.

## Log

- L1 (2026-10-15): "Quiero crear un terminal como mobaxterm en linux usa la skill de SOA para clonar '/mnt/480GB/Descargas/MobaXterm_Portable_v26.5'"
- L2 (2026-10-15): "con REA perdon" — clean-room surface inventory done with REA (no decompilation).
- L3 (2026-10-15): "la tipografia puede ser diferente"
- L4 (2026-10-15): Stack selected: "Tauri 2 + Rust + xterm.js (Recomendado)". MVP scope S4-S7 is a proposal pending user confirmation.
- L5 (2026-10-15): T1 done. Bug found in smoke test: StrictMode double mount made the disposed PTY's exit event close the live tab; fixed by ignoring events after dispose.
- L6 (2026-10-15): "haz lo que creas mas optim" — user delegates scope/order; proceeding with T2→T4 as proposed (S4-S7 accepted).
- L7 (2026-10-15): T2 done. Smoke bug: terminal lost focus after the host-key overlay; fixed by refocusing. Host key policy: changed keys are always refused, unknown hosts need explicit fingerprint trust. Agent auth untested (no identities loaded).
- L8 (2026-10-15): T2 independent verifier: no blockers; advisories queued as correction batch T2b (writer/reader stall on large paste, different-algorithm host key shown as plain unknown, Debug leaks password, IPv6 parsing, agent loop stops on first error). T3 smoke bugs fixed: native select rendered light (color-scheme: dark).
- L9 (2026-10-15): T2b done. Mistake caught: an edit applied via a script silently did not match after cargo fmt, so the agent socket override was missing and the agent test failed; fixed with a checked edit. Remaining known limitations documented in README (russh known_hosts parser).
- L10 (2026-10-15): T4 design fixed by parent (S7.1-S7.5) and delegated to one bounded writer because of the context backstop; new dependencies: russh-sftp 3.0, tauri-plugin-dialog.
- L11 (2026-10-15): T4 done; native assess = high (review due). Not smoke-tested: OSC 7 follow (test server shell does not emit it; covered by component test), drag-and-drop upload, real OpenSSH sftp-server.
- L12 (2026-10-15): RDD assess (committed-only): range 0baed36..b68dcfc and 18c7dc2..b68dcfc → medium, review_due=false (under_budget); the uncommitted worktree had assessed high. No RDD review started; independent verifiers ran for T2 and T4. MVP S4-S7 complete; next candidates (S8): tunnels, macros, multi-exec, password vault, split panes, serial.
- L13 (2026-10-15): "haz lo que te creas mas optimo" — closed the OpenSSH interop gap: scripts/openssh-interop.sh + ignored tests pass against OpenSSH 9.7p1 (trust flow, key auth, shell, resize, known_hosts reuse, 3 MiB SFTP round trip). First failure was a test bug (blocking recv on a current-thread tokio runtime), not a product bug. Next: S8 SSH tunnels.
- L14 (2026-10-15): T5 done. Verifier advisories left open: SOCKS handshake has no idle timeout; status snapshot can overwrite a newer event; deleting a tunnel while its password prompt is open still starts it; no explicit stop hook on app exit (process exit closes sockets).
- L15 (2026-10-15): Native review. User granted consent twice: full branch (9177 lines) stopped with lens_context_budget_exceeded (no authority created); reduced candidate T5 slice 8dcc938..83f2383 (2624 lines, lenses risk/resilience/reliability) → approved with 10 WARNING/SUGGESTION findings, acknowledged (review-d390727a4f854a1a). Follow-up T5c created for the warnings. Earlier slices (T1-T4) were not natively reviewed (too large as one candidate); they had independent verifiers.
- L16 (2026-10-15): User on Windows support: "lo haremos cuando la app este terminada". Deferred until the feature set is complete. Known porting points (verified in code): storage.rs unix permissions, default shell/HOME in pty, HOME-based known_hosts path in ssh/tunnels, agent via named pipe (russh `connect_named_pipe`), unix-only tests, bash interop script; plus a Windows CI runner. New code should avoid adding more unix-only assumptions where it is free to do so.
- L17 (2026-10-15): Process mistake: a parent docs commit used `git commit -a` while the T5c writer was editing, sweeping part of its code into 76e2454 (local, never pushed). Fixed with `git reset --soft` and two clean commits. Parent now stages explicit paths only.
- L18 (2026-10-15): "haz lo que te creas mas optimo" — next unit T6 (MobaXterm.ini import), chosen because migrating existing sessions is the main adoption blocker.
- L19 (2026-10-15): GUI automation incidents: (1) a title-based xdotool search matched the user's Thorium browser window and typed Ctrl+L + a scratch file path + Enter into it (tab navigated to a local test file; nothing destructive); (2) a pid+name search returned the app main window. Rule adopted: only interact with windows detected as new after the click and owned by the app pid, and never steal focus while the user is active.
- L20 (2026-10-15): "haz lo que te creas mas optimo" — next unit T7 (split panes + multi-exec). GUI smoke tests only when the user is not using the desktop.
- L21 (2026-10-15): GUI smoke tests now run on a private Xvfb display (:99) with xdotool bound to it, so they never touch the user's desktop.
- L22 (2026-10-15): "haz lo que te creas mas optimo" — next unit T8 (serial). Machine facts: libudev dev headers missing; user in dialout; a real /dev/ttyUSB0 exists and must not be opened by tests.
