# Packaging drafts

Package manifests for third-party package managers, kept here so they can be
updated and submitted by hand after each release. Nothing in this folder is
used by the build or the release workflow.

| Folder | Package manager | Package |
| --- | --- | --- |
| `winget/manifests/j/JorgeAlonso/PlexusTerm/<version>/` | Windows Package Manager (winget) | `JorgeAlonso.PlexusTerm` |
| `aur/plexusterm-bin/` | Arch User Repository | `plexusterm-bin` (repackages the portable `.tar.gz`) |

Both take their hashes from the release's `checksums.txt`. Never type a hash
by hand.

## Updating for a new release

Publish the GitHub Release first: the manifests point at its assets.

Fetch the checksums once:

```bash
V=0.2.2   # new version, without the leading v
curl -fsSL -o checksums.txt \
  "https://github.com/jorgealonsodev/PlexusTerm/releases/download/v$V/checksums.txt"
```

### winget

1. Copy the previous version folder to `winget/manifests/j/JorgeAlonso/PlexusTerm/$V/`.
2. In all three files, replace the old version in `PackageVersion`, in the
   asset URLs, in `LicenseUrl` and in `ReleaseNotesUrl`.
3. In `JorgeAlonso.PlexusTerm.installer.yaml`:
   - `InstallerSha256` of each installer: the line for
     `plexusterm_${V}_windows_x86_64.msi` and for
     `plexusterm_${V}_windows_x86_64-setup.exe` in `checksums.txt`
     (winget accepts either case; the drafts use upper case).
   - `ReleaseDate`: the release's publication date.
   - `ProductCode` (both places) and `DisplayVersion`: the MSI gets a new
     ProductCode on every build, so read it from the new MSI (for example
     `msiinfo export <file>.msi Property` from msitools, or Orca on Windows).
     If you cannot read it, delete both `ProductCode` lines rather than
     keeping the old one. `UpgradeCode` stays the same between releases.
4. Validate: `winget validate --manifest <version folder>` on Windows.
   `wingetcreate update JorgeAlonso.PlexusTerm --version $V --urls <msi-url> <exe-url>`
   does steps 1-3 for you once the package exists in winget-pkgs (it
   downloads the installers and computes hashes and the ProductCode itself).

### AUR

1. In `aur/plexusterm-bin/PKGBUILD`, set `pkgver=$V` and reset `pkgrel=1`.
   Bump only `pkgrel` when the PKGBUILD changes but the release does not.
2. Set the hashes:
   - `sha256sums_x86_64`: the line for `plexusterm_${V}_linux_amd64.tar.gz`.
   - `sha256sums_aarch64`: the line for `plexusterm_${V}_linux_arm64.tar.gz`.
   - `sha256sums` (the LICENSE): `sha256sum` of
     `https://raw.githubusercontent.com/jorgealonsodev/PlexusTerm/v$V/LICENSE`.
     On Arch, `updpkgsums` recomputes all three from the downloads.
3. Check the runtime dependencies still match the `.deb` (`dpkg-deb -f
   plexusterm_${V}_linux_amd64.deb Depends`). Current mapping:
   `libwebkit2gtk-4.1-0` -> `webkit2gtk-4.1`, `libgtk-3-0` -> `gtk3`.
4. On Arch: `makepkg -si` to test, `namcap PKGBUILD` and `namcap *.pkg.tar.zst`
   to lint, then regenerate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO`.
   Without Arch, edit `.SRCINFO` by hand so every value matches the PKGBUILD.
5. Keep the `# Maintainer:` line current (written "name at domain dot com",
   as AUR packages usually do).

## Submitting

### winget

Two ways, both ending in a pull request to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs):

- **wingetcreate** (Windows): `wingetcreate submit <version folder>` for the
  first submission, `wingetcreate update ... --submit` afterwards. It needs a
  GitHub token and opens the PR from a fork of winget-pkgs.
- **Manual PR**: fork winget-pkgs, copy the version folder to the same path
  under `manifests/` (`manifests/j/JorgeAlonso/PlexusTerm/<version>/`), commit
  and open a pull request. The validation pipeline installs the package in a
  sandbox; fix anything it reports in the same PR.

### AUR

Needs an account on aur.archlinux.org with an SSH public key added to it.

```bash
git clone ssh://aur@aur.archlinux.org/plexusterm-bin.git   # empty on first use
cp packaging/aur/plexusterm-bin/{PKGBUILD,.SRCINFO} plexusterm-bin/
cd plexusterm-bin
git add PKGBUILD .SRCINFO
git commit -m "Update to $V"
git push   # the AUR only accepts the master branch
```

## Flathub

Not drafted here. Flathub builds every app from source inside its own
sandboxed builder, so it needs a separate Flatpak manifest
(`dev.plexusterm.app.yml`) that builds the Rust and frontend code offline
with vendored dependencies, plus AppStream metadata. It is submitted as a
pull request to `flathub/flathub` and then lives in its own repository.
