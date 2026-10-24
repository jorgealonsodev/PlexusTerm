use super::*;

fn choose(proofs: &[Format]) -> Result<Format, String> {
    match proofs {
        [format] => Ok(*format),
        _ => {
            Err("Unknown or ambiguous installation; use the release page to update manually".into())
        }
    }
}

#[cfg(target_os = "linux")]
pub(super) fn detect() -> Result<Installation, String> {
    let exe = std::env::current_exe().map_err(error)?;
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    let appdir = std::env::var_os("APPDIR").map(PathBuf::from);
    if appimage.is_some() || appdir.is_some() {
        let target = appimage_target(&exe, appimage.as_deref(), appdir.as_deref())?;
        writable_target(&target)?;
        return Ok(Installation {
            format: Format::AppImage,
            target,
        });
    }
    let mut proofs = Vec::new();
    // Presence of a package manager is NOT provenance. Its database must own this exact file.
    if let Ok(output) = std::process::Command::new("/usr/bin/dpkg-query")
        .args(["-S", "--"])
        .arg(&exe)
        .output()
    {
        if output.status.success() && deb_owner(&String::from_utf8_lossy(&output.stdout), &exe) {
            proofs.push(Format::Deb);
        }
    }
    if let Ok(output) = std::process::Command::new("/usr/bin/rpm")
        .args(["-qf", "--qf", "%{NAME}", "--"])
        .arg(&exe)
        .output()
    {
        if output.status.success() && output.stdout == b"plexusterm" {
            proofs.push(Format::Rpm);
        }
    }
    if proofs.is_empty() {
        if let Some(home) = std::env::var_os("HOME") {
            let known = PathBuf::from(home).join(".local/bin/plexusterm");
            if known == exe && writable_target(&exe).is_ok() {
                proofs.push(Format::Tar);
            }
        }
    }
    Ok(Installation {
        format: choose(&proofs)?,
        target: exe,
    })
}

#[cfg(any(target_os = "linux", test))]
fn deb_owner(output: &str, exe: &Path) -> bool {
    let Some(path) = exe.to_str() else {
        return false;
    };
    let lines: Vec<_> = output.lines().collect();
    matches!(lines.as_slice(), [line] if *line == format!("plexusterm: {path}") || *line == format!("plexusterm:amd64: {path}") || *line == format!("plexusterm:arm64: {path}"))
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
        assert_eq!(
            windows_proof(&exe, dir.path(), true, None),
            Some(Format::Msi)
        );
        assert_eq!(
            windows_proof(&exe, dir.path(), false, Some(&uninstaller)),
            Some(Format::Nsis)
        );
        assert_eq!(windows_proof(&exe, dir.path(), false, None), None);
        assert_eq!(
            windows_proof(&exe, &dir.path().join("other"), true, None),
            None
        );
        assert_eq!(windows_proof(&exe, dir.path(), false, Some(&exe)), None);
        assert_eq!(std::fs::read(&exe).unwrap(), b"test exe");
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
