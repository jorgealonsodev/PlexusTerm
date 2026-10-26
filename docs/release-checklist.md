# Release checklist

Step-by-step runbook for publishing a new PlexusTerm version, from the version
bump to the AUR and winget packages. The background for each step is in
[Building and releasing](building-and-releasing.md) and
[packaging/README.md](../packaging/README.md).

Throughout, `V` is the new version without the leading `v`:

```bash
V=0.2.22
```

## One-time setup

Do this once; skip it on later releases.

- [ ] **AUR account**: create an account on aur.archlinux.org and add your
      SSH public key to it.
- [ ] **First AUR push**: publish the current `packaging/aur/plexusterm-bin/`
      by hand, as described under "Submitting > AUR" in
      [packaging/README.md](../packaging/README.md#aur-1).
- [ ] **winget fork**: fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
      under the account that owns this repository.
- [ ] **First winget submission**: submit the latest version folder under
      `packaging/winget/manifests/j/JorgeAlonso/PlexusTerm/` by hand
      (`wingetcreate submit <version folder>` or a manual pull request) and
      wait until it is merged. Until then the winget job of `packages.yml`
      fails, because it can only update an existing package.
- [ ] **Repository secrets** (Settings > Secrets and variables > Actions):

      | Secret | Value |
      | --- | --- |
      | `AUR_USERNAME` | AUR account name |
      | `AUR_EMAIL` | Email for the AUR commits |
      | `AUR_SSH_PRIVATE_KEY` | Private key whose public half is on the AUR account |
      | `WINGET_TOKEN` | Classic personal access token of the account that owns this repository and the winget-pkgs fork, with the `public_repo` and `workflow` scopes |

## 1. Prepare the release commit

- [ ] Start from an up-to-date `main` with a clean working tree:

      ```bash
      git switch main && git pull && git status --short
      ```

- [ ] Set the version in all three files (they must match, the release
      workflow fails otherwise):
  - `package.json` (`"version"`)
  - `src-tauri/Cargo.toml` (`version`)
  - `src-tauri/tauri.conf.json` (`"version"`)
- [ ] Refresh the lock file so `src-tauri/Cargo.lock` carries the new version:

      ```bash
      cargo update --manifest-path src-tauri/Cargo.toml --workspace
      ```

- [ ] Write the release notes in `docs/releases/$V.md`, following the
      previous files in that folder.
- [ ] Update the example `V=` line in `packaging/README.md` ("Updating by
      hand") to the new version.
- [ ] Run the checks:

      ```bash
      pnpm test
      cargo test --manifest-path src-tauri/Cargo.toml
      bash scripts/package-release.test.sh
      ```

- [ ] Commit:

      ```bash
      git commit -am "chore(release): $V"
      ```

## 2. Tag and build

- [ ] Push the commit and the tag:

      ```bash
      git push origin main
      git tag "v$V" && git push origin "v$V"
      ```

- [ ] Wait for the **Release** workflow (Actions tab) to finish. It builds
      Linux amd64, Linux arm64 and Windows, writes `checksums.txt` and creates
      a **draft** release.

## 3. Review and publish the draft

- [ ] Open the draft under Releases and check that it has 11 assets: two
      `.tar.gz`, two `.deb`, two `.rpm`, two `.AppImage`, the `.msi`, the
      `-setup.exe` and `checksums.txt`.
- [ ] Replace or complete the generated notes with `docs/releases/$V.md`.
- [ ] Optionally smoke-test one installer from the draft.
- [ ] Click **Publish release**. Do not mark it as a prerelease unless it is
      one: prereleases are skipped by the package workflow.

## 4. Package managers

Publishing the release starts the **Packages** workflow
(`.github/workflows/packages.yml`).

- [ ] Wait for both jobs to finish:
  - **AUR**: pushes `plexusterm-bin` at version `$V`. Check
        <https://aur.archlinux.org/packages/plexusterm-bin>: the version
        shown should be `$V-1`.
  - **winget**: opens a pull request in microsoft/winget-pkgs titled with
        `JorgeAlonso.PlexusTerm` and `$V`. Follow it until it is merged; if
        the bot adds a label such as `Needs-Author-Feedback`, fix it in the
        same pull request.
- [ ] If a job failed, fix the cause and rerun it from the Actions tab:
      **Packages > Run workflow**, with the tag `v$V`.

If the automation is unavailable, update both packages by hand with
[packaging/README.md](../packaging/README.md) ("Updating by hand" and
"Submitting").

## 5. Afterwards

- [ ] When the PKGBUILD itself must change (new runtime dependency, new
      file to install), edit `packaging/aur/plexusterm-bin/PKGBUILD` in this
      repository; the workflow only changes `pkgver`, `pkgrel` and the
      checksums. Compare the `.deb` dependencies of the new release with the
      PKGBUILD:

      ```bash
      curl -fsSLO "https://github.com/jorgealonsodev/PlexusTerm/releases/download/v$V/plexusterm_${V}_linux_amd64.deb"
      dpkg-deb -f "plexusterm_${V}_linux_amd64.deb" Depends
      ```

      `pkexec` is not needed in the AUR package: PlexusTerm does not update
      itself when pacman owns the executable.
- [ ] Check that the in-app updater offers `$V` on an installation of the
      previous version.
