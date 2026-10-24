use super::*;

fn choose(proofs: &[Format]) -> Result<Format, String> {
    match proofs {
        [format] => Ok(*format),
        _ => {
            Err("Unknown or ambiguous installation; use the release page to update manually".into())
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
thread_local! {
    // Only ownership query output is faked; the public install path still runs detection.
    static TEST_QUERY: std::cell::Cell<Option<fn(&str, &[&str], &Path) -> Option<Vec<u8>>>> = const { std::cell::Cell::new(None) };
}

#[cfg(target_os = "linux")]
pub(super) fn detect() -> Result<Installation, String> {
    let exe = std::env::current_exe().map_err(error)?;
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    detect_linux(
        &exe,
        appimage.as_deref(),
        appdir.as_deref(),
        home.as_deref(),
        |command, args, exe| {
            #[cfg(test)]
            if let Some(query) = TEST_QUERY.with(|query| query.get()) {
                return query(command, args, exe);
            }
            let output = std::process::Command::new(command)
                .args(args)
                .arg(exe)
                .output()
                .ok()?;
            output.status.success().then_some(output.stdout)
        },
    )
}

#[cfg(target_os = "linux")]
fn detect_linux(
    exe: &Path,
    appimage: Option<&Path>,
    appdir: Option<&Path>,
    home: Option<&Path>,
    mut query: impl FnMut(&str, &[&str], &Path) -> Option<Vec<u8>>,
) -> Result<Installation, String> {
    // Query ownership of this exact executable, never infer it from manager availability.
    // AUR package names may vary; any positive pacman owner must retain control.
    if query("/usr/bin/pacman", &["-Qqo", "--"], exe).is_some_and(|owner| !owner.is_empty()) {
        return Err("This installation is managed by pacman/AUR; update PlexusTerm with your package manager or AUR helper instead".into());
    }
    if appimage.is_some() || appdir.is_some() {
        let target = appimage_target(exe, appimage, appdir)?;
        writable_target(&target)?;
        return Ok(Installation {
            format: Format::AppImage,
            target,
        });
    }
    let mut proofs = Vec::new();
    // Presence of a package manager is NOT provenance. Its database must own this exact file.
    if let Some(output) = query("/usr/bin/dpkg-query", &["-S", "--"], exe) {
        if deb_owner(&String::from_utf8_lossy(&output), exe) {
            proofs.push(Format::Deb);
        }
    }
    if let Some(output) = query("/usr/bin/rpm", &["-qf", "--qf", "%{NAME}", "--"], exe) {
        if matches!(output.as_slice(), b"plexus-term" | b"plexusterm") {
            proofs.push(Format::Rpm);
        }
    }
    if proofs.is_empty() {
        if let Some(home) = home {
            let known = home.join(".local/bin/plexusterm");
            if known == exe && writable_target(exe).is_ok() {
                proofs.push(Format::Tar);
            }
        }
    }
    Ok(Installation {
        format: choose(&proofs)?,
        target: exe.to_path_buf(),
    })
}

#[cfg(any(target_os = "linux", test))]
fn deb_owner(output: &str, exe: &Path) -> bool {
    let Some(path) = exe.to_str() else {
        return false;
    };
    let lines: Vec<_> = output.lines().collect();
    // Tauri's product-name packaging uses plexus-term; retain the legacy alias.
    matches!(lines.as_slice(), [line] if ["plexus-term", "plexusterm"].iter().any(|name| {
        ["", ":amd64", ":arm64"].iter().any(|arch| *line == format!("{name}{arch}: {path}"))
    }))
}

#[cfg(any(windows, test))]
fn windows_proof(
    exe: &Path,
    location: &Path,
    msi: bool,
    uninstaller: Option<&Path>,
) -> Option<Format> {
    let parent = exe.parent()?;
    if location.canonicalize().ok()?.as_path() != parent
        || parent.join("plexusterm.exe").canonicalize().ok()?.as_path() != exe
    {
        return None;
    }
    if msi {
        return Some(Format::Msi);
    }
    let uninstaller = uninstaller?;
    if !uninstaller
        .file_name()?
        .to_str()?
        .eq_ignore_ascii_case("uninstall.exe")
    {
        return None;
    }
    (uninstaller.canonicalize().ok()?.parent() == Some(parent)).then_some(Format::Nsis)
}

#[cfg(target_os = "linux")]
fn appimage_target(
    exe: &Path,
    image: Option<&Path>,
    dir: Option<&Path>,
) -> Result<PathBuf, String> {
    let (Some(image), Some(dir)) = (image, dir) else {
        return Err("Incomplete AppImage runtime provenance".into());
    };
    if !image.is_absolute()
        || !dir.is_absolute()
        || dir.canonicalize().map_err(error)? != dir
        || ![dir.join("usr/bin/plexusterm"), dir.join("plexusterm")].contains(&exe.to_path_buf())
    {
        return Err("AppImage runtime does not match the running executable".into());
    }
    let target = image.canonicalize().map_err(error)?;
    if target != image || target.starts_with(dir) {
        return Err("AppImage original file is unsafe".into());
    }
    let mut header = [0; 11];
    std::fs::File::open(&target)
        .map_err(error)?
        .read_exact(&mut header)
        .map_err(error)?;
    if &header[..4] != b"\x7fELF" || &header[8..11] != b"AI\x02" {
        return Err("Original file is not a type-2 AppImage".into());
    }
    Ok(target)
}

#[cfg(target_os = "linux")]
fn writable_target(target: &Path) -> Result<std::fs::Metadata, String> {
    use std::os::unix::fs::MetadataExt;
    let parent = target.parent().ok_or("Missing installation directory")?;
    let metadata = std::fs::symlink_metadata(target).map_err(error)?;
    let directory = std::fs::metadata(parent).map_err(error)?;
    // Never reinterpret a system-owned file as a portable user installation.
    let uid = unsafe { libc::geteuid() };
    if target.canonicalize().map_err(error)? != target
        || !metadata.is_file()
        || metadata.uid() != uid
        || directory.uid() != uid
        || metadata.mode() & 0o022 != 0
        || directory.mode() & 0o022 != 0
        || metadata.mode() & 0o111 == 0
        || metadata.permissions().readonly()
    {
        return Err(format!(
            "Installation is not a private writable regular executable: {} (uid {}/{uid}, mode {:o}, directory uid {}, mode {:o})",
            target.display(),
            metadata.uid(),
            metadata.mode(),
            directory.uid(),
            directory.mode()
        ));
    }
    Ok(metadata)
}

fn package_command(format: Format, path: &Path) -> Result<Vec<String>, String> {
    let args: &[&str] = match format {
        Format::Deb => &[
            "/usr/bin/pkexec",
            "/usr/bin/apt-get",
            "install",
            "--no-remove",
            "--",
        ],
        Format::Rpm => &["/usr/bin/pkexec", "/usr/bin/rpm", "-U", "--"],
        _ => return Err("Not a system package".into()),
    };
    let mut command: Vec<String> = args.iter().map(|s| (*s).into()).collect();
    command.push(path.to_str().ok_or("Invalid package path")?.into());
    Ok(command)
}

#[cfg(target_os = "linux")]
fn run_package(
    format: Format,
    package: &Path,
    run: impl FnOnce(&[String]) -> Result<i32, String>,
) -> Result<Outcome, String> {
    let code = run(&package_command(format, package)?)?;
    if code != 0 {
        return Err(format!(
            "Installer failed or authorization was cancelled (exit {code})"
        ));
    }
    Ok(Outcome::Installed)
}

#[cfg(target_os = "linux")]
pub(super) fn apply(
    installation: &Installation,
    package: &Path,
    name: &str,
) -> Result<Outcome, String> {
    // Recheck provenance immediately before changing anything, not only before download.
    let current = detect()?;
    if current.format != installation.format || current.target != installation.target {
        return Err("Installation changed while downloading".into());
    }
    match installation.format {
        Format::Deb | Format::Rpm => run_package(installation.format, package, |command| {
            std::process::Command::new(&command[0])
                .args(&command[1..])
                .stdin(std::process::Stdio::null())
                .status()
                .map_err(error)
                .and_then(|status| status.code().ok_or("Installer terminated by signal".into()))
        }),
        Format::Tar => {
            let binary = portable_binary(package, name)?;
            replace(&installation.target, &mut binary.as_slice())?;
            Ok(Outcome::Installed)
        }
        Format::AppImage => {
            replace(
                &installation.target,
                &mut std::fs::File::open(package).map_err(error)?,
            )?;
            Ok(Outcome::Installed)
        }
        _ => Err("Unsupported Linux installation".into()),
    }
}

/// Stage in the target directory; no unpacked paths, scripts, partial writes or symlink following.
#[cfg(target_os = "linux")]
fn replace(target: &Path, source: &mut dyn Read) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let before = writable_target(target)?;
    let parent = target.parent().ok_or("Missing installation directory")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    let copied = std::io::copy(&mut source.take(MAX_PACKAGE + 1), &mut staged).map_err(error)?;
    if copied == 0 || copied > MAX_PACKAGE {
        return Err("Invalid replacement size".into());
    }
    staged
        .as_file()
        .set_permissions(std::fs::Permissions::from_mode(0o755))
        .map_err(error)?;
    staged.as_file().sync_all().map_err(error)?;
    let now = writable_target(target)?;
    if before.dev() != now.dev()
        || before.ino() != now.ino()
        || before.mtime() != now.mtime()
        || before.mtime_nsec() != now.mtime_nsec()
        || before.ctime() != now.ctime()
        || before.ctime_nsec() != now.ctime_nsec()
        || before.len() != now.len()
    {
        return Err("Installation changed before replacement".into());
    }
    crate::platform::replace_file(staged.path(), target).map_err(error)?;
    std::fs::File::open(parent)
        .map_err(error)?
        .sync_all()
        .map_err(error)
}

fn portable_binary(package: &Path, name: &str) -> Result<Vec<u8>, String> {
    let root = name
        .strip_suffix(".tar.gz")
        .ok_or("Invalid portable package name")?;
    let expected = format!("{root}/plexusterm");
    let gzip = flate2::read::GzDecoder::new(std::fs::File::open(package).map_err(error)?);
    let mut archive = tar::Archive::new(gzip.take(MAX_PACKAGE + 1));
    let mut binary = None;
    let mut total = 0u64;
    let mut count = 0;
    for entry in archive.entries().map_err(error)? {
        count += 1;
        if count > 128 {
            return Err("Too many portable archive entries".into());
        }
        let mut entry = entry.map_err(error)?;
        let path = entry.path().map_err(error)?.into_owned();
        if path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
            || !path.starts_with(root)
            || !(entry.header().entry_type().is_file() || entry.header().entry_type().is_dir())
        {
            return Err("Unsafe portable archive entry".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Portable archive too large")?;
        if total > MAX_PACKAGE {
            return Err("Portable archive too large".into());
        }
        if path == Path::new(&expected) {
            if binary.is_some() || !entry.header().entry_type().is_file() {
                return Err("Ambiguous portable binary".into());
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(error)?;
            binary = Some(bytes);
        }
    }
    binary
        .filter(|bytes| !bytes.is_empty())
        .ok_or("Portable binary missing".into())
}

#[cfg(windows)]
#[path = "windows.rs"]
mod windows;
#[cfg(windows)]
pub(super) use windows::{apply, detect};
#[cfg(not(any(target_os = "linux", windows)))]
pub(super) fn detect() -> Result<Installation, String> {
    Err("Automatic installation is unsupported on this platform".into())
}
#[cfg(not(any(target_os = "linux", windows)))]
pub(super) fn apply(_: &Installation, _: &Path, _: &str) -> Result<Outcome, String> {
    Err("Unsupported platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[tokio::test(flavor = "current_thread")]
    async fn public_install_returns_manager_guidance_without_downloading_or_launching() {
        use std::sync::{Arc, Mutex};
        struct ResetQuery;
        impl Drop for ResetQuery {
            fn drop(&mut self) {
                TEST_QUERY.with(|query| query.set(None));
            }
        }
        let exe = std::env::current_exe().unwrap();
        let before = std::fs::read(&exe).unwrap();
        let _reset = ResetQuery;
        TEST_QUERY.with(|query| {
            query.set(Some(|command, args, path| {
                assert_eq!(command, "/usr/bin/pacman");
                assert_eq!(args, ["-Qqo", "--"]);
                assert_eq!(path, std::env::current_exe().unwrap());
                Some(b"plexusterm-bin\n".to_vec())
            }))
        });
        let events = Arc::new(Mutex::new(Vec::new()));
        let reported = events.clone();
        let result = super::super::install(move |progress| {
            reported.lock().unwrap().push(progress.phase);
            Ok(())
        })
        .await;
        assert_eq!(result, Err("This installation is managed by pacman/AUR; update PlexusTerm with your package manager or AUR helper instead".into()));
        assert_eq!(*events.lock().unwrap(), ["checking"]);
        assert_eq!(std::fs::read(&exe).unwrap(), before);
        assert!(!BUSY.load(Ordering::Acquire));

        // Rejected native ownership must stop at the public command before network,
        // file staging, replacement or installer launch, just like manager ownership.
        let queries: [fn(&str, &[&str], &Path) -> Option<Vec<u8>>; 4] = [
            |command, _, path| {
                (command == "/usr/bin/dpkg-query")
                    .then(|| format!("plexus-term-other: {}\n", path.display()).into_bytes())
            },
            |command, _, _| {
                (command == "/usr/bin/dpkg-query")
                    .then(|| b"plexus-term: /other/plexusterm\n".to_vec())
            },
            |command, _, path| {
                (command == "/usr/bin/dpkg-query").then(|| {
                    format!(
                        "plexus-term: {}\nplexusterm: {}\n",
                        path.display(),
                        path.display()
                    )
                    .into_bytes()
                })
            },
            |command, _, _| (command == "/usr/bin/rpm").then(|| b"plexus-term-other".to_vec()),
        ];
        for query in queries {
            TEST_QUERY.with(|slot| slot.set(Some(query)));
            events.lock().unwrap().clear();
            let reported = events.clone();
            let result = super::super::install(move |progress| {
                reported.lock().unwrap().push(progress.phase);
                Ok(())
            })
            .await;
            assert_eq!(
                result,
                Err(
                    "Unknown or ambiguous installation; use the release page to update manually"
                        .into()
                )
            );
            assert_eq!(*events.lock().unwrap(), ["checking"]);
            assert_eq!(std::fs::read(&exe).unwrap(), before);
            assert!(!BUSY.load(Ordering::Acquire));
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn pacman_owned_executable_is_rejected_before_any_update_work() {
        use std::cell::Cell;
        use std::os::unix::fs::PermissionsExt;
        let dir = private_dir().unwrap();
        let bin = dir.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join("plexusterm");
        std::fs::write(&exe, b"original executable").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(writable_target(&exe).is_ok());
        // Ownership wins even over an otherwise valid portable or native-package proof.
        for owner in [
            b"plexusterm\n".as_slice(),
            b"plexusterm-bin\n",
            b"custom-package\n",
        ] {
            for deb in [false, true] {
                let queried = Cell::new(false);
                let mut update_work = 0;
                let result =
                    detect_linux(&exe, None, None, Some(dir.path()), |command, args, path| {
                        assert_eq!(path, exe);
                        match command {
                            "/usr/bin/pacman" => {
                                assert_eq!(args, ["-Qqo", "--"]);
                                queried.set(true);
                                Some(owner.to_vec())
                            }
                            "/usr/bin/dpkg-query" if deb => {
                                Some(format!("plexusterm: {}\n", exe.display()).into_bytes())
                            }
                            _ => None,
                        }
                    })
                    .and_then(|_| {
                        update_work += 1;
                        Err::<Outcome, _>("must not download, replace or launch".into())
                    });
                assert_eq!(result, Err("This installation is managed by pacman/AUR; update PlexusTerm with your package manager or AUR helper instead".into()));
                assert!(queried.get());
                assert_eq!(update_work, 0);
                assert_eq!(std::fs::read(&exe).unwrap(), b"original executable");
                assert_eq!(std::fs::read_dir(&bin).unwrap().count(), 1);
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_detection_preserves_native_portable_and_unknown_decisions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = private_dir().unwrap();
        let bin = dir.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let exe = bin.join("plexusterm");
        std::fs::write(&exe, b"original").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(writable_target(&exe).is_ok());
        for (deb, rpm, home, expected) in [
            (true, false, None, Ok(Format::Deb)),
            (false, true, None, Ok(Format::Rpm)),
            (false, false, Some(dir.path()), Ok(Format::Tar)),
            (
                false,
                false,
                None,
                Err(
                    "Unknown or ambiguous installation; use the release page to update manually"
                        .to_string(),
                ),
            ),
            (
                true,
                true,
                None,
                Err(
                    "Unknown or ambiguous installation; use the release page to update manually"
                        .to_string(),
                ),
            ),
        ] {
            for pacman in [None, Some(Vec::new())] {
                let result = detect_linux(&exe, None, None, home, |command, _, path| {
                    assert_eq!(path, exe);
                    match command {
                        "/usr/bin/pacman" => pacman.clone(),
                        "/usr/bin/dpkg-query" if deb => {
                            Some(format!("plexusterm: {}\n", exe.display()).into_bytes())
                        }
                        "/usr/bin/rpm" if rpm => Some(b"plexusterm".to_vec()),
                        _ => None,
                    }
                });
                assert_eq!(
                    result.map(|installation| {
                        assert_eq!(installation.target, exe);
                        installation.format
                    }),
                    expected
                );
                assert_eq!(std::fs::read(&exe).unwrap(), b"original");
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn artifact_package_names_and_legacy_aliases_require_exact_ownership() {
        let exe = Path::new("/usr/bin/plexusterm");
        for name in ["plexus-term", "plexusterm"] {
            for arch in ["", ":amd64", ":arm64"] {
                let owner = format!("{name}{arch}: /usr/bin/plexusterm\n");
                let detected = detect_linux(exe, None, None, None, |command, args, path| {
                    assert_eq!(path, exe);
                    match command {
                        "/usr/bin/dpkg-query" => {
                            assert_eq!(args, ["-S", "--"]);
                            Some(owner.as_bytes().to_vec())
                        }
                        _ => None,
                    }
                })
                .unwrap();
                assert_eq!(detected.format, Format::Deb);
                assert_eq!(detected.target, exe);
            }
            let detected = detect_linux(exe, None, None, None, |command, args, path| {
                assert_eq!(path, exe);
                match command {
                    "/usr/bin/rpm" => {
                        assert_eq!(args, ["-qf", "--qf", "%{NAME}", "--"]);
                        Some(name.as_bytes().to_vec())
                    }
                    _ => None,
                }
            })
            .unwrap();
            assert_eq!(detected.format, Format::Rpm);
            assert_eq!(detected.target, exe);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejected_ownership_never_reaches_file_or_launch_work() {
        let dir = private_dir().unwrap();
        let exe = dir.path().join("plexusterm");
        std::fs::write(&exe, b"original executable").unwrap();
        for name in ["plexus-term", "plexusterm"] {
            let path = exe.display();
            let valid = format!("{name}: {path}\n");
            let invalid = [
                format!("other: {path}\n"),
                format!("{name}-other: {path}\n"),
                format!("other-{name}: {path}\n"),
                format!("{name}: /other/plexusterm\n"),
                format!("{name}: {path}.other\n"),
                format!("{name}:i386: {path}\n"),
                format!("{name}, other: {path}\n"),
                format!("{valid}{valid}"),
                format!("{valid}other: {path}\n"),
            ];
            for deb in invalid {
                let mut work = 0;
                let result = detect_linux(&exe, None, None, None, |command, _, target| {
                    assert_eq!(target, exe);
                    (command == "/usr/bin/dpkg-query").then(|| deb.as_bytes().to_vec())
                })
                .map(|_| work += 1);
                assert_eq!(result, Err("Unknown or ambiguous installation; use the release page to update manually".into()), "{deb}");
                assert_eq!(work, 0);
                assert_eq!(std::fs::read(&exe).unwrap(), b"original executable");
                assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
            }
            for rpm in [
                format!("{name}-other"),
                format!("other-{name}"),
                format!("{name}\n"),
                format!("{name}{name}"),
                "other".into(),
            ] {
                let mut work = 0;
                let result = detect_linux(&exe, None, None, None, |command, _, target| {
                    assert_eq!(target, exe);
                    (command == "/usr/bin/rpm").then(|| rpm.as_bytes().to_vec())
                })
                .map(|_| work += 1);
                assert_eq!(result, Err("Unknown or ambiguous installation; use the release page to update manually".into()), "{rpm}");
                assert_eq!(work, 0);
                assert_eq!(std::fs::read(&exe).unwrap(), b"original executable");
                assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
            }
            assert!(
                detect_linux(&exe, None, None, None, |command, _, _| match command {
                    "/usr/bin/dpkg-query" => Some(valid.as_bytes().to_vec()),
                    "/usr/bin/rpm" => Some(name.as_bytes().to_vec()),
                    _ => None,
                })
                .is_err()
            );
            assert_eq!(
                detect_linux(&exe, None, None, None, |command, _, _| match command {
                    "/usr/bin/pacman" => Some(b"custom-package\n".to_vec()),
                    _ => panic!("pacman ownership must take precedence"),
                })
                .unwrap_err(),
                "This installation is managed by pacman/AUR; update PlexusTerm with your package manager or AUR helper instead"
            );
        }
    }

    #[test]
    fn unknown_and_ambiguous_provenance_fail_closed() {
        assert!(choose(&[]).is_err());
        for format in [
            Format::Deb,
            Format::Rpm,
            Format::Tar,
            Format::AppImage,
            Format::Msi,
            Format::Nsis,
        ] {
            assert_eq!(choose(&[format]).unwrap(), format);
            assert!(choose(&[format, format]).is_err());
        }
        assert!(choose(&[Format::Msi, Format::Nsis]).is_err());
        assert!(choose(&[Format::Deb, Format::Rpm]).is_err());
    }
    #[test]
    fn ownership_and_windows_registration_must_match_running_path() {
        let exe = Path::new("/usr/bin/plexusterm");
        assert!(deb_owner("plexusterm: /usr/bin/plexusterm\n", exe));
        assert!(!deb_owner("plexusterm: /other/plexusterm\n", exe));
        assert!(!deb_owner("other: /usr/bin/plexusterm\n", exe));
        assert!(!deb_owner(
            "plexusterm: /usr/bin/plexusterm\nother: /usr/bin/plexusterm\n",
            exe
        ));
        let dir = private_dir().unwrap();
        let exe = dir.path().join("plexusterm.exe");
        let uninstaller = dir.path().join("uninstall.exe");
        std::fs::write(&exe, b"test exe").unwrap();
        std::fs::write(&uninstaller, b"test uninstaller").unwrap();
        // Match windows::detect: canonicalize the running executable, not registry strings.
        // Windows canonical paths may include the extended-length prefix.
        let exe = exe.canonicalize().unwrap();
        let other = dir.path().join("other");
        std::fs::create_dir(&other).unwrap();
        let other_uninstaller = other.join("uninstall.exe");
        std::fs::write(&other_uninstaller, b"unrelated uninstaller").unwrap();
        std::fs::write(other.join("plexusterm.exe"), b"unrelated exe").unwrap();
        assert_eq!(
            windows_proof(&exe, dir.path(), true, None),
            Some(Format::Msi)
        );
        assert_eq!(
            windows_proof(&exe, dir.path(), false, Some(&uninstaller)),
            Some(Format::Nsis)
        );
        assert_eq!(windows_proof(&exe, dir.path(), false, None), None);
        assert_eq!(windows_proof(&exe, &other, true, None), None);
        assert_eq!(windows_proof(&exe, dir.path(), false, Some(&exe)), None);
        assert_eq!(
            windows_proof(&exe, dir.path(), false, Some(&other_uninstaller)),
            None
        );
        assert_eq!(std::fs::read(&exe).unwrap(), b"test exe");
        assert_eq!(std::fs::read(&uninstaller).unwrap(), b"test uninstaller");
        assert_eq!(
            std::fs::read(&other_uninstaller).unwrap(),
            b"unrelated uninstaller"
        );
        assert_eq!(
            std::fs::read(other.join("plexusterm.exe")).unwrap(),
            b"unrelated exe"
        );
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn package_failure_cancellation_and_launch_errors_are_visible() {
        for format in [Format::Deb, Format::Rpm] {
            let package = Path::new("/private/package");
            assert_eq!(
                run_package(format, package, |_| Ok(0)),
                Ok(Outcome::Installed)
            );
            assert_eq!(
                run_package(format, package, |_| Ok(126)),
                Err("Installer failed or authorization was cancelled (exit 126)".into())
            );
            assert_eq!(
                run_package(format, package, |_| Err("launch failed".into())),
                Err("launch failed".into())
            );
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn appimage_correspondence_updates_original_not_mount() {
        let dir = private_dir().unwrap();
        let mount = dir.path().join("mount");
        std::fs::create_dir(&mount).unwrap();
        let exe = mount.join("plexusterm");
        std::fs::write(&exe, b"mounted exe").unwrap();
        let original = dir.path().join("original.AppImage");
        std::fs::write(&original, b"\x7fELF0000AI\x02original").unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&original, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let detected = detect_linux(
            &exe,
            Some(&original),
            Some(&mount),
            None,
            |command, args, path| {
                assert_eq!(command, "/usr/bin/pacman");
                assert_eq!(args, ["-Qqo", "--"]);
                assert_eq!(path, exe);
                None
            },
        )
        .unwrap();
        assert_eq!(detected.format, Format::AppImage);
        assert_eq!(detected.target, original);
        assert_eq!(
            appimage_target(&exe, Some(&original), Some(&mount)).unwrap(),
            original
        );
        assert!(appimage_target(&exe, Some(&original), None).is_err());
        assert!(appimage_target(&original, Some(&original), Some(&mount)).is_err());
        assert!(appimage_target(&exe, Some(&exe), Some(&mount)).is_err());
        assert_eq!(std::fs::read(&exe).unwrap(), b"mounted exe");
        assert_eq!(
            std::fs::read(&original).unwrap(),
            b"\x7fELF0000AI\x02original"
        );
    }
    #[test]
    fn package_install_uses_fixed_authorization_and_no_shell() {
        let path = Path::new("/tmp/private/package name.deb");
        assert_eq!(
            package_command(Format::Deb, path).unwrap(),
            [
                "/usr/bin/pkexec",
                "/usr/bin/apt-get",
                "install",
                "--no-remove",
                "--",
                "/tmp/private/package name.deb"
            ]
        );
        assert_eq!(
            package_command(Format::Rpm, path).unwrap(),
            [
                "/usr/bin/pkexec",
                "/usr/bin/rpm",
                "-U",
                "--",
                "/tmp/private/package name.deb"
            ]
        );
        assert!(package_command(Format::Tar, path).is_err());
    }
    #[test]
    fn checksum_mismatch_prevents_installer_and_preserves_files() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        std::fs::write(&target, b"original").unwrap();
        let mut launched = false;
        let result = super::super::verify(&target, &"0".repeat(64)).and_then(|_| {
            launched = true;
            Ok(())
        });
        assert!(result.is_err());
        assert!(!launched);
        assert_eq!(std::fs::read(target).unwrap(), b"original");
    }
    fn archive(path: &Path, kind: u8, member: &str) {
        let writer = flate2::write::GzEncoder::new(
            std::fs::File::create(path).unwrap(),
            flate2::Compression::default(),
        );
        let mut archive = tar::Builder::new(writer);
        let mut header = tar::Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o755);
        header.set_entry_type(tar::EntryType::new(kind));
        // Raw bytes deliberately bypass the builder's traversal protection.
        header.as_mut_bytes()[..100].fill(0);
        header.as_mut_bytes()[..member.len()].copy_from_slice(member.as_bytes());
        header.set_cksum();
        archive.append(&header, &b"ELF"[..]).unwrap();
        archive.into_inner().unwrap().finish().unwrap();
    }
    #[test]
    fn portable_archive_accepts_only_expected_regular_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("package.tar.gz");
        let name = "plexusterm_1.2.3_linux_amd64.tar.gz";
        archive(&path, b'0', "plexusterm_1.2.3_linux_amd64/plexusterm");
        assert_eq!(portable_binary(&path, name).unwrap(), b"ELF");
        for (kind, member) in [
            (b'2', "plexusterm_1.2.3_linux_amd64/plexusterm"),
            (b'1', "plexusterm_1.2.3_linux_amd64/plexusterm"),
            (b'0', "../plexusterm"),
            (b'0', "/plexusterm"),
            (b'0', "other/plexusterm"),
        ] {
            archive(&path, kind, member);
            assert!(portable_binary(&path, name).is_err(), "{member}");
        }
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn atomic_replacement_and_rejections_preserve_target() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let dir = private_dir().unwrap();
        let target = dir.path().join("plexusterm");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).unwrap();
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("broken payload"))
            }
        }
        assert!(replace(&target, &mut Broken).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        let link = dir.path().join("link");
        symlink(&target, &link).unwrap();
        assert!(replace(&link, &mut &b"bad"[..]).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"old");
        replace(&target, &mut &b"new"[..]).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
