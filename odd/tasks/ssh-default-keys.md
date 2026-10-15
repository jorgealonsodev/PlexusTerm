# SSH default keys before the password

Objective: password sessions try the SSH agent and the default `~/.ssh` keys first, like OpenSSH, and only ask for the password when the server rejects them. Branch `feat/tools` (current working branch). Delivery: ask-on-risk. Runners: cargo, Vitest.

## Specs

- **S1 — Default keys first.** User: "intente conectarme a un servidor que ya tiene metida mi clave publica, y me pide contraseña" and "Una cosa es cuando la clave publica no es la por defecto, pero la por defecto deberia cojerla no?". Acceptance: for an SSH login whose method is password (terminal tabs, SFTP, tunnels, jump hosts, Mosh login), PlexusTerm first tries public-key authentication with the keys offered by the SSH agent (`SSH_AUTH_SOCK`, or the Windows agent pipe) and then the default identity files OpenSSH uses (`~/.ssh/id_ed25519`, `id_ecdsa`, `id_rsa`; unencrypted only — an encrypted default key is skipped unless the agent has it), without prompting; only when the server rejects all of them is the password used: the saved keyring password when there is one, otherwise the password prompt appears (not before connecting). Key-file and agent sessions behave as before. Host-key checks, saved-password endpoint binding and every existing behaviour stay unchanged.

## Tasks

- [ ] T1 — S1 — delegated (writer trigger: long-session backstop) — Try agent and default keys before the password.

## Log

- L1 (2026-10-15): "intente conectarme a un servidor que ya tiene metida mi clave publica, y me pide contraseña" (session "Soyo" had `auth.method = password`).
- L2 (2026-10-15): "Una cosa es cuando la clave publica no es la por defecto, pero la por defecto deberia cojerla no?"
