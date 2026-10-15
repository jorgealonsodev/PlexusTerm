# Strix findings: important fixes

Objective: fix the findings of the Strix scan (run plexusterm_2e93) that were verified as real, plus the privacy bug found while verifying. Branch `fix/security-strix` (from `main` 05dec4a). Delivery: ask-on-risk. Runners: Vitest, cargo test.

## Specs

- **S1 — Password prompts in every language.** Verified bug (not in the Strix report): `isSecretPrompt` (`src/features/terminal/lineTracker.ts:87`) only knows English, so at "[sudo] contraseña para jorge:" typed text is sent to the AI provider (`TerminalView.tsx:454`) and recorded in history (`:487`). Acceptance: password/PIN/one-time-code prompts are recognised in the ten interface languages (and common sudo/ssh wordings), with ASCII or full-width colon; AI suggestions, history recording and Run all stay off there. Normal shell prompts are not mistaken for secret prompts.
- **S2 — Strict CSP (Strix vuln-0001).** `tauri.conf.json` has `"csp": null`. Acceptance: a strict CSP for the packaged app (no remote scripts, no inline scripts, IPC only), a dev CSP that lets Vite work, and the app still renders and works.
- **S3 — rustls (vuln-0007).** RUSTSEC-2026-0285 in rustls 0.23.43: update to a fixed 0.23.x.
- **S4 — Small hardenings (vuln-0009, 0003, 0008).** Run refuses a command with line breaks or control characters; SFTP Compare refuses a local path that is not absolute or starts with "-"; the tunnel "exposed" warning treats all of 127.0.0.0/8 and ::1 as loopback.
- **S5 — glib (vuln-0006).** RUSTSEC-2024-0429 comes only through Tauri's GTK3 stack, the affected API is never used and it cannot be upgraded: record it as an accepted risk with the reason (cargo-audit ignore).
- User choice (verbatim option): "Lo importante (Recomendado)". Findings 1–4 (paths from dialogs, 0.0.0.0 tunnels) are by design; pty_spawn hardening not chosen.

## Tasks

- [x] T1 — S1 — inline — localized SECRET_WORDS (es, de, fr, pt, ja, zh, ko, ar, hi, ru) + full-width colon/question mark; lineTracker tests + TerminalView end-to-end test (RED on old regex, GREEN); guide updated.
- [x] T2 — S4 — inline — Run refuses C0/C1/U+2028/2029 characters; sftp_compare requires an absolute local path (compare_target); isLoopback covers 127.0.0.0/8, [::1], 0:0:0:0:0:0:0:1. RED→GREEN for each.
- [x] T3 — S2 — inline — strict csp + devCsp (adds Vite ws/http on 1420); bundled debug build (tauri build --debug --no-bundle) checked on Xvfb: UI, i18n, PTY terminal, AI chat, Settings with theme preview all work.
- [x] T4 — S3, S5 — inline — rustls 0.23.43 -> 0.23.46 (cargo update -p rustls); src-tauri/.cargo/audit.toml ignores RUSTSEC-2024-0429 with the reason. cargo audit --no-fetch: glib gone; remaining: rsa RUSTSEC-2023-0071 (no fix, local RSA ops) and GTK3 unmaintained warnings (out of scope). cargo 367 + 5 ignored, clippy 0, Vitest 699, tsc OK.

## Log

- L1 (2026-10-15): User pasted the Strix summary (9 findings, unverified) and the run path. Read-only verification: 1–4 by design, 5 false (server side), 6 partly real, 7 real hardening, 8 not exploitable/not upgradable, 9 real low; new real bug: English-only secret prompt detection leaks localized sudo passwords to AI suggestions and history. User chose "Lo importante (Recomendado)".
