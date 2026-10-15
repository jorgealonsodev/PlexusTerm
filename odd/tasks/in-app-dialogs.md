# In-app dialogs and default editor setting

Objective: stop relying on the browser's native `window.confirm`/`window.prompt`, which WebKitGTK does not show reliably in the app, and let the user choose the default text editor. Branch `feat/tools`. Delivery: ask-on-risk. Runners: Vitest, cargo.

## Specs

- **S1 — In-app confirm and prompt.** User: "los submenus, cuando pulsas boton derecho aparecen los menus, pero no tienen su funcionalidad". Evidence (parent, real app on Xvfb with an isolated config): right-click > Delete on a saved session deleted it with no confirmation shown (`window.confirm` answered true without a dialog), while `window.prompt` showed a native "JavaScript - http://localhost:1420/" box. Acceptance: every `window.confirm` / `window.prompt` / `window.alert` in `src/` is replaced by PlexusTerm's own dialogs (same look as the other dialogs: `overlay`/`dialog` classes, theme colours, `role="dialog"`/`alertdialog`, focus on the safe button for destructive confirmations, Enter/Escape), driven by a small promise-based API (e.g. `const { confirm, prompt } = useDialogs()`), so every existing flow keeps its wording and behaviour: deleting sessions/folders (with the jump-host note), tunnels, macros, new folder, SFTP delete/rename/new folder/replace on upload, upload-on-save confirmation. Declining must never perform the action.
- **S2 — Default text editor setting.** User: "en settigns hay que dejar elegir el editor predeterminado". Acceptance: Settings gains "Text editor" with "System default" (current behaviour) or a chosen program (path/command, with a Browse… button); "Open with default text editor" in the SFTP menu uses it; saved in settings.json like the other settings (invalid → system default); documented in the user guide.

## Tasks

- [x] T1 — S1, S2 — delegated (writer trigger: long-session backstop) — In-app dialogs (DialogProvider/useDialogs; 9 native calls replaced) and the textEditor setting (launched without a shell). Writer: RED→GREEN, Vitest 521, cargo sftp 28, clippy and tsc clean; parent rerun Vitest 521, cargo 263.

## Log

- L1 (2026-10-15): "los submenus, cuando pulsas boton derecho aparecen los menus, pero no tienen su funcionalidad" (reproduced: native confirm silently returns true in WebKitGTK; prompt shows).
- L2 (2026-10-15): "en settigns hay que dejar elegir el editor predeterminado"
