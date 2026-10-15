# SFTP browser right-click menu

Objective: MobaXterm-style options on the SFTP browser entries, in PlexusTerm's own style. Branch `feat/tools`. Delivery: ask-on-risk. Runners: cargo, Vitest.

## Specs

- **S1 — Entry menu.** User: "añade opciones al sftp" (screenshot of MobaXterm's SFTP menu: "Open", "Download", "Delete", "Rename", "Copy file path", "Copy file path to terminal (Middle mouse click)", "Properties", "Permissions"). Acceptance: right-clicking an entry of the SFTP browser opens a menu with: **Open** (enter a folder; download a file, like double-click today), **Download…**, **Delete** (with the existing confirmation; only empty folders, as today), **Rename…**, **Copy file path** (absolute remote path to the clipboard), **Copy file path to terminal** (types the path, shell-quoted when needed, into the focused pane of the active tab; middle-clicking an entry does the same), **Properties** (name, full path, type, size, modified time, owner/group ids or names when available, permissions in `rwx` and octal), **Permissions…** (dialog with read/write/execute checkboxes for owner, group and others plus the octal value kept in sync; applies `chmod` over SFTP; errors shown). The existing toolbar actions and their behaviour stay unchanged.

## Tasks

- [ ] T1 — S1 — delegated (writer trigger: parallel units — the SSH auth writer works on other files) — SFTP entry menu; parent wires "copy to terminal" and registers commands.

## Log

- L1 (2026-10-15): "añade opciones al sftp" with a screenshot of MobaXterm's SFTP right-click menu.
