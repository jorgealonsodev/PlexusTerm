# Install the matching update

Choose **Download** in the startup notice or **Settings → About** to download, verify and install the matching official GitHub release asset. **Visit download page** independently opens the displayed release URL for manual installation, even while installation is busy or after an error.

Both entrypoints share one app-scoped installation controller, including its progress channel, busy guard, result and error. Closing the notice or Settings does not cancel an active operation; reopen About to see its state without another check. Errors are visible and offer **Retry download**; browser-opening errors are visible too. Success distinguishes an installed update from a completed Windows installer. Restart PlexusTerm manually when ready: neither action closes the app or terminates terminal sessions. System authorization prompts, not app password fields, handle administrator access.

## Command contract

Invoke `update_install` with **only** `onProgress`, a Tauri channel. There is no caller-controlled URL, path, format, or executable.

| Result / event | Meaning |
|---|---|
| `"installed"` | The package installation or atomic portable-file replacement completed. Restart manually when ready. |
| `"installerOpened"` | A Windows installer was opened and its process completed successfully. |
| Rejected promise | Detection, download, verification, authentication, cancellation, or installer failure; show the error and offer the release page. |
| `{phase:"checking"}` | Detecting installation and rechecking the fixed official latest release. |
| `{phase:"downloading", downloaded?, total?}` | Downloading the matching asset; byte counts are optional. |
| `{phase:"verifying"}` | Checking SHA-256 against the same release's `checksums.txt`. |
| `{phase:"installing"}` | Starting OS authentication/installer, or replacing a user-owned executable. |

Only one installation runs at a time. A closed progress channel cancels before installation. Once a native installer starts, closing the channel cannot safely cancel OS installation: its temporary directory and single-flight guard remain owned by the waiting backend task until it completes. On Windows errors, the backend conservatively retains the private installer files and reports their location, because a failed process wait could leave the installer alive. PlexusTerm never collects passwords, automatically exits, or restarts itself.

## Installation matching

| Running installation | Detection and action |
|---|---|
| pacman / AUR | A successful read-only `/usr/bin/pacman -Qqo -- <current-executable>` ownership query stops automatic updating with guidance to use your package manager or AUR helper. Manager presence alone is not ownership. PlexusTerm never runs a pacman installation or downloads a substitute format. |
| Linux `.deb` | `dpkg-query` must report that `plexusterm` owns the current executable. `/usr/bin/pkexec /usr/bin/apt-get install --no-remove -- <verified-package>` requests desktop OS authorization. |
| Linux `.rpm` | `rpm` must report that `plexusterm` owns the current executable. `/usr/bin/pkexec /usr/bin/rpm -U -- <verified-package>` requests desktop OS authorization. Missing dependencies or authorization fail visibly. |
| Portable `.tar.gz` | Only the known user installation at `$HOME/.local/bin/plexusterm`, owned by the user in a non-group/world-writable directory. Read only the expected regular binary from the archive; never extract paths or run `install.sh`. Stage, sync and atomically replace the binary. Existing desktop entries/icons remain unchanged. |
| AppImage | Both `APPIMAGE` and `APPDIR` must exist and agree with the running executable's canonical location inside the AppDir. The original must be a private writable regular type-2 AppImage outside the mounted directory. Replace that original file atomically, never its mounted executable. |
| Windows MSI / NSIS | An unambiguous PlexusTerm uninstall registration must match the current canonical installation directory. MSI requires `WindowsInstaller=1`; NSIS requires its existing `uninstall.exe` in that directory. Launch the matching verified installer through native UAC, not a shell; retain the private download directory until its process completes. Missing/ambiguous registration fails closed. |

Linux x86_64 and aarch64 map to published amd64/arm64 assets (RPM uses x86_64/aarch64). Windows supports the published x86_64 MSI and NSIS assets. Unsupported architectures and unknown installation formats fail instead of silently changing formats. New releases publish `plexusterm_<version>_linux_amd64.AppImage` and `plexusterm_<version>_linux_arm64.AppImage` alongside the other Linux formats, covered by the same `checksums.txt`. Older releases may lack a matching AppImage; a missing asset produces a visible error and requires the release-page action, never a switch to another format.

For pacman/AUR-owned installations, update through the same package manager or AUR helper you used to install PlexusTerm; **Retry download** will not bypass ownership. Windows MSI registration does not establish winget ownership: matching MSI/NSIS behavior is unchanged, and package-manager integration on Windows remains unverified.

## Download safety and limits

- Reuse the existing newer-release comparison rules; drafts, prereleases, equal and older releases are not installable updates.
- Only exact, unique official asset names and checksum entries are accepted. Asset URLs must belong to the selected release in `jorgealonsodev/PlexusTerm`.
- HTTPS only, without URL credentials or non-default ports. Redirects are limited to five and to `api.github.com`, `github.com`, `release-assets.githubusercontent.com`, or `objects.githubusercontent.com`.
- Metadata/checksums: at most 2 MiB and 15 seconds per request. Packages: at most 512 MiB and ten minutes, with a ten-second connection timeout. Advertised sizes and completed byte counts must match.
- A 0700 temporary download directory on Unix keeps packages private. SHA-256 verification precedes installer launch or replacement. Downloads that are partial, oversized, or rejected are never executed.
- Portable archives reject traversal, absolute paths, links, unexpected roots, duplicate binaries, more than 128 entries, or more than 512 MiB of declared content. Replacement failures before rename preserve the old binary. A directory-sync failure after rename is reported even though replacement may already have occurred.

## Verification boundary

Tests use temporary files, local HTTP fixtures, and fake command seams. They never invoke privilege tools or install packages. Native Windows registry/UAC behavior and actual package-manager installation still require platform acceptance testing; Linux tests cover the shared format/path decision rules, not native Windows execution. Real Windows/UAC, AppImage replacement, and ARM acceptance remain unavailable; packaging contracts and isolated tests are not platform acceptance. The existing `update_check` JSON and startup failure behavior are unchanged.
