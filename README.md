# NexusTerm

A Linux terminal and remote-session manager inspired by MobaXterm's feature set (clean-room; see `docs/reference/mobaxterm-feature-inventory.md`).

Stack: Tauri 2 (Rust backend) + React/TypeScript + xterm.js.

## Development

```bash
pnpm install
pnpm tauri dev                     # run the app
pnpm test                          # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
```

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+Shift+T | New local terminal tab |
| Ctrl+Shift+W | Close current tab |
| Middle click on a tab | Close that tab |
