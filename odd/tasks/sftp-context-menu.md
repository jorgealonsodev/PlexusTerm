# SFTP browser right-click menu

Objective: MobaXterm-style options on the SFTP browser entries, in PlexusTerm's own style. Branch `feat/tools`. Delivery: ask-on-risk. Runners: cargo, Vitest.

## Specs

- **S1 — Entry menu.** User: "añade opciones al sftp" (screenshot of MobaXterm's SFTP menu: "Open", "Download", "Delete", "Rename", "Copy file path", "Copy file path to terminal (Middle mouse click)", "Properties", "Permissions"). Acceptance: right-clicking an entry of the SFTP browser opens a menu with: **Open** (enter a folder; download a file, like double-click today), **Download…**, **Delete** (with the existing confirmation; only empty folders, as today), **Rename…**, **Copy file path** (absolute remote path to the clipboard), **Copy file path to terminal** (types the path, shell-quoted when needed, into the focused pane of the active tab; middle-clicking an entry does the same), **Properties** (name, full path, type, size, modified time, owner/group ids or names when available, permissions in `rwx` and octal), **Permissions…** (dialog with read/write/execute checkboxes for owner, group and others plus the octal value kept in sync; applies `chmod` over SFTP; errors shown). The existing toolbar actions and their behaviour stay unchanged.
- **S2 — File-only options.** User: "a los archivos lo mismo" and "no es necesario que mantega el mismo orden" (screenshot of MobaXterm's file menu: "Open", "Open with default text editor", "Open with...", "Open with default program...", "Compare file with...", "Download", "Delete", "Rename", "Copy file path", "Copy file path to terminal (Middle mouse click)", "Properties", "Permissions"). Acceptance: for files (not folders) the menu also offers **Open with default text editor**, **Open with default program**, **Open with…** (choose an application/executable), **Compare file with…** (choose a local file; opens both in an installed diff tool — Meld, KDiff3, Kompare or `code --diff`, in that order — or shows that none was found). The "open" options download the file to a private temporary directory, open it with the system handler or chosen program, then watch the temporary copy: when it is saved, the change is uploaded back to the same remote path after a confirmation the first time per file (MobaXterm-like edit-and-upload), with a notice of success or error. Temporary copies are removed when the SFTP session ends. Item order is free.

## Tasks

- [ ] T2 — S2 — delegated (same writer as T1, follow-up message) — File-only open/compare options with edit-and-upload.
- [ ] T1 — S1 — delegated (writer trigger: parallel units — the SSH auth writer works on other files) — SFTP entry menu; parent wires "copy to terminal" and registers commands.

## Log

- L1 (2026-10-15): "añade opciones al sftp" with a screenshot of MobaXterm's SFTP right-click menu.
- L2 (2026-10-15): "a los archivos lo mismo: … no es necesario que mantega el mismo orden" with a screenshot of MobaXterm's file menu (S2).
- L3 (2026-10-15): Implemented in d5db0a1 (writer: Vitest sftp 36, cargo sftp 24 after the parent added setstat to the test server). Independent verifier: S1 FAIL (B1: control characters in a file name, e.g. Ctrl-U, break the shell quoting of "Copy file path to terminal"), S2 FAIL (B2: saves are not uploaded while the session's SFTP panel is hidden; B3: on Windows a remote name with `\` or `C:` could put the temporary copy outside its folder). One correction batch: terminalPath refuses names with control characters; EditUploads at App level uploads saves of every session; local_name sanitizes the copy name. Also removed the red "No saved password was found" line before the first password prompt (ssh-default-keys advisory 1). RED→GREEN for each; cargo 260, Vitest 503, clippy and tsc clean.
- L4 (2026-10-15): User: "cuando le doy a open, se me abre el explorador para descargar". S1 "Open" for a file now opens it in its default program with edit-and-upload (same as "Open with default program"); folders still enter; "Download…" downloads. Double-click on a file still downloads (unchanged).

