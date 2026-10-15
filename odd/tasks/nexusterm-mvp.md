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
- S8 (assumption, later): tunnels, macros, multi-exec, password vault, split panes, serial, VNC/RDP.

## Tasks

- [x] T1 — S1-S4 — inline — Scaffold Tauri 2 + React + xterm.js app with local PTY tabs. RED→GREEN: cargo 8/8, vitest 7/7; smoke test via `pnpm tauri dev` (UTF-8 + colors OK).
- [x] T2 — S5 — inline — SSH session backend (russh) + tab integration. RED→GREEN: cargo 20/20 (in-process russh server: password, key, host-key policy, resize, exit status), vitest 22/22; UI smoke OK (trust prompt → shell echo). Real OpenSSH interop not tested (no sshd installed).
- [ ] T3 — S6 — inline — Session manager UI + persistence.
- [ ] T4 — S7 — inline — SFTP side browser.

## Log

- L1 (2026-10-15): "Quiero crear un terminal como mobaxterm en linux usa la skill de SOA para clonar '/mnt/480GB/Descargas/MobaXterm_Portable_v26.5'"
- L2 (2026-10-15): "con REA perdon" — clean-room surface inventory done with REA (no decompilation).
- L3 (2026-10-15): "la tipografia puede ser diferente"
- L4 (2026-10-15): Stack selected: "Tauri 2 + Rust + xterm.js (Recomendado)". MVP scope S4-S7 is a proposal pending user confirmation.
- L5 (2026-10-15): T1 done. Bug found in smoke test: StrictMode double mount made the disposed PTY's exit event close the live tab; fixed by ignoring events after dispose.
- L6 (2026-10-15): "haz lo que creas mas optim" — user delegates scope/order; proceeding with T2→T4 as proposed (S4-S7 accepted).
- L7 (2026-10-15): T2 done. Smoke bug: terminal lost focus after the host-key overlay; fixed by refocusing. Host key policy: changed keys are always refused, unknown hosts need explicit fingerprint trust. Agent auth untested (no identities loaded).
