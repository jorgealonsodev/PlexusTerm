# Building and releasing PlexusTerm

For contributors: run the app from source, test it, package it and publish a release.

## Development

```bash
pnpm install
pnpm tauri dev                     # run the app
pnpm test                          # frontend tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # backend tests
bash scripts/package-release.test.sh            # isolated release packaging contracts
bash -n scripts/package-release.sh scripts/package-release.test.sh
scripts/openssh-interop.sh         # SSH/SFTP against a real OpenSSH server (needs Docker)
```

`scripts/openssh-interop.sh` starts a disposable Alpine container with `sshd` and `sftp-server` bound to `127.0.0.1`, runs the ignored interoperability tests (host-key trust flow, key login, shell, resize, SFTP round trip, local tunnel) and removes the container.

## Packaging

```bash
pnpm tauri build    # produces .deb and AppImage under src-tauri/target/release/bundle/
```

Build dependencies on Debian/Ubuntu: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `libssl-dev`, `build-essential` and `nasm`. Ubuntu 24.04 CI also installs `libfuse2t64` for the AppImage packaging helpers (older distributions call it `libfuse2`). The `.deb` depends only on `libwebkit2gtk-4.1-0` and `libgtk-3-0`; AppImages bundle application libraries but still require a compatible Linux host.

### Windows builds

Build on Windows with the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Microsoft C++ Build Tools, WebView2, Rust stable) plus Node.js 22 and pnpm, then:

```powershell
pnpm install
pnpm tauri build --bundles nsis,msi   # installers under src-tauri\target\release\bundle\
```

Windows support is developed on Linux, where it is only cross-compiled (`cargo check --target x86_64-pc-windows-gnu`); it is built, tested and packaged on a real Windows machine by the CI workflow (`.github/workflows/ci.yml`, Linux and Windows jobs on every pull request and every push to `main`; a newer push cancels the run in progress), whose artifacts hold the `.deb`, AppImage, NSIS and MSI installers.

## Releases

New GitHub Releases carry these assets (`<version>` without the leading `v`); older releases may not include AppImages:

| Asset | Contents |
| --- | --- |
| `plexusterm_<version>_linux_amd64.tar.gz`, `plexusterm_<version>_linux_arm64.tar.gz` | Portable folder `plexusterm_<version>_linux_<arch>/` with the `plexusterm` binary, `plexusterm.desktop`, `icons/`, `README.md` and `install.sh` |
| `plexusterm_<version>_linux_amd64.deb`, `plexusterm_<version>_linux_arm64.deb` | Debian/Ubuntu packages |
| `plexusterm_<version>_linux_x86_64.rpm`, `plexusterm_<version>_linux_aarch64.rpm` | Fedora/openSUSE/RHEL packages |
| `plexusterm_<version>_linux_amd64.AppImage`, `plexusterm_<version>_linux_arm64.AppImage` | Standalone AppImages for the matching native architecture |
| `plexusterm_<version>_windows_x86_64.msi`, `plexusterm_<version>_windows_x86_64-setup.exe` | Windows installers (MSI and NSIS) |
| `checksums.txt` | SHA-256 of every other asset, in `sha256sum` format |

**Producing a release.** Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (all three must match), commit, then push a tag `v<version>`:

```bash
git tag v1.2.0 && git push origin v1.2.0
```

The `Release` workflow (`.github/workflows/release.yml`) builds amd64 on `ubuntu-24.04`, arm64 natively on `ubuntu-24.04-arm` and the installers on `windows-latest`, writes `checksums.txt` and creates a **draft** release; review it and publish it by hand on GitHub. The workflow fails if the tag does not match the project version.

The Linux assets are built the same way locally (native architecture only; the Linux build dependencies above are required):

```bash
scripts/package-release.sh 1.2.0 amd64   # writes dist-release/plexusterm_1.2.0_linux_*
scripts/checksums.sh dist-release        # writes and verifies dist-release/checksums.txt
```

The packaging script builds `.deb`, `.rpm` and AppImage bundles together, then derives the portable tarball from the `.deb`. It clears stale bundles and replaces the matching output assets; missing or ambiguous built packages fail the run. The existing checksum step includes all four Linux formats automatically, and publishing remains a manual decision after draft creation.

The isolated packaging tests run in Linux CI before dependency installation. They use temporary fixture copies and command doubles, never build or install native packages, and cover both architectures, missing/ambiguous AppImages and existing package/archive behavior. Real AppImage builds and execution still need native CI/platform verification.

Users verify and install the assets as described in the [README](../README.md#install).
