//! Where a received file goes: the remote names it, so the name is reduced to a plain file name
//! inside the folder the user picked, and an existing file is never replaced.

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

/// Longest name kept, in bytes (most file systems allow 255).
const MAX_NAME: usize = 200;
/// Names Windows reserves for devices, in any case and with any extension.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A plain file name from the name the remote sent: its last path component, without control
/// characters or characters file systems reject, never empty, `.` or `..`.
pub fn sanitize(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let last = text.rsplit(['/', '\\']).next().unwrap_or_default();
    let mut name: String = last
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    name = name
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string();
    if name.is_empty() {
        return "file".into();
    }
    let stem = name.split('.').next().unwrap_or_default();
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        name.insert(0, '_');
    }
    if name.len() > MAX_NAME {
        let mut end = MAX_NAME;
        while !name.is_char_boundary(end) {
            end -= 1;
        }
        name.truncate(end);
    }
    name
}

/// `name` with ` (n)` before its extension: `log.txt` → `log (2).txt`.
fn numbered(name: &str, n: u32) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({n}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({n})"),
    }
}

/// Creates a new file for `name` in `folder`, numbering the name while one already exists.
/// The file is created exclusively, so nothing is ever overwritten (not even through a link).
pub fn create_unique(folder: &Path, name: &str) -> io::Result<(PathBuf, File)> {
    for n in 0..10_000u32 {
        let candidate = if n == 0 {
            name.to_string()
        } else {
            numbered(name, n)
        };
        let path = folder.join(&candidate);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "too many files with that name",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_last_component_of_a_path() {
        assert_eq!(sanitize(b"/etc/passwd"), "passwd");
        assert_eq!(sanitize(b"..\\..\\boot.ini"), "boot.ini");
        assert_eq!(sanitize(b"dir/sub/report.pdf"), "report.pdf");
    }

    #[test]
    fn never_returns_a_name_that_leaves_the_folder() {
        for raw in [b"..".as_slice(), b".", b"../..", b"", b"/", b"  ", b"a/.."] {
            let name = sanitize(raw);
            assert!(
                !name.is_empty() && name != "." && name != "..",
                "{raw:?} -> {name}"
            );
            assert!(!name.contains('/') && !name.contains('\\'));
        }
    }

    #[test]
    fn replaces_characters_file_systems_reject() {
        assert_eq!(sanitize(b"a:b*c?.txt"), "a_b_c_.txt");
        assert_eq!(sanitize(b"bell\x07\x1b[31m.txt"), "bell__[31m.txt");
        assert_eq!(sanitize(b"CON.txt"), "_CON.txt");
        assert_eq!(sanitize(&[b'x'; 300]).len(), MAX_NAME);
    }

    #[test]
    fn numbers_the_name_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("log.txt"), b"old").unwrap();
        std::fs::write(dir.path().join("log (1).txt"), b"old").unwrap();
        let (path, _) = create_unique(dir.path(), "log.txt").unwrap();
        assert_eq!(path, dir.path().join("log (2).txt"));
        assert_eq!(std::fs::read(dir.path().join("log.txt")).unwrap(), b"old");
        let (path, _) = create_unique(dir.path(), "README").unwrap();
        assert_eq!(path, dir.path().join("README"));
        let (path, _) = create_unique(dir.path(), "README").unwrap();
        assert_eq!(path, dir.path().join("README (1)"));
    }
}
