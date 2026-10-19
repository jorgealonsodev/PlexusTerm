//! File operations on the local disk for the sidebar's Local tab.
//!
//! Entries have the same shape as the SFTP browser's, so both panels share their dialogs.
//! Paths are native strings (`/home/me` or `C:\Users\me`); errors read
//! `cannot <action> <path>: <cause>`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::platform;
use crate::sftp::commands::{OpenWith, launch};
use crate::sftp::{Entry, EntryKind, MAX_MODE};

fn failure(action: &str, path: &Path, err: impl std::fmt::Display) -> String {
    format!("cannot {action} {}: {err}", path.display())
}

fn entry_of(path: &Path, name: String) -> Result<Entry, std::io::Error> {
    let link = fs::symlink_metadata(path)?;
    // A symlink keeps its kind; its size and date are those of the file it points to, when it exists.
    let meta = if link.file_type().is_symlink() {
        fs::metadata(path).unwrap_or(link.clone())
    } else {
        link.clone()
    };
    let kind = if link.file_type().is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs());
    #[cfg(unix)]
    let (permissions, uid, gid) = {
        use std::os::unix::fs::MetadataExt;
        (
            Some(link.mode() & MAX_MODE),
            Some(link.uid()),
            Some(link.gid()),
        )
    };
    #[cfg(not(unix))]
    let (permissions, uid, gid) = (None, None, None);
    Ok(Entry {
        name,
        path: path.to_string_lossy().into_owned(),
        kind,
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
        permissions,
        uid,
        gid,
        user: None,
        group: None,
    })
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// The user's home folder.
pub fn home() -> Result<String, String> {
    platform::home_dir()
        .map(|home| home.to_string_lossy().into_owned())
        .ok_or_else(|| "cannot resolve the home folder".to_string())
}

/// Lists `path`: folders first, then by case-insensitive name. Unreadable entries are skipped.
pub fn list(path: &Path) -> Result<Vec<Entry>, String> {
    let dir = fs::read_dir(path).map_err(|err| failure("list", path, err))?;
    let mut entries: Vec<Entry> = dir
        .filter_map(Result::ok)
        .filter_map(|item| {
            entry_of(
                &item.path(),
                item.file_name().to_string_lossy().into_owned(),
            )
            .ok()
        })
        .collect();
    entries.sort_by_cached_key(|entry| {
        (
            entry.kind != EntryKind::Dir,
            entry.name.to_lowercase(),
            entry.name.clone(),
        )
    });
    Ok(entries)
}

/// One file or folder; a symlink is reported as such.
pub fn stat(path: &Path) -> Result<Entry, String> {
    entry_of(path, name_of(path)).map_err(|err| failure("read", path, err))
}

pub fn mkdir(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(|err| failure("create", path, err))
}

/// Creates an empty file; fails if anything already has that name.
pub fn create_file(path: &Path) -> Result<(), String> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(drop)
        .map_err(|err| failure("create", path, err))
}

/// Renames `from` to `to`; never replaces an existing `to`.
pub fn rename(from: &Path, to: &Path) -> Result<(), String> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(failure(
            "rename",
            from,
            format!("{} already exists", to.display()),
        ));
    }
    fs::rename(from, to).map_err(|err| failure("rename", from, err))
}

/// Moves `from` into the folder `dir`, keeping its name, and returns where it ended up.
/// Never replaces an existing entry, and never moves a folder into itself or one of its subfolders.
pub fn move_into(from: &Path, dir: &Path) -> Result<PathBuf, String> {
    let from = without_trailing_separators(from);
    let dir = without_trailing_separators(dir);
    let name = from
        .file_name()
        .ok_or_else(|| failure("move", &from, "not a file name"))?;
    if dir.starts_with(&from) {
        return Err(failure(
            "move",
            &from,
            "a folder cannot be moved into itself",
        ));
    }
    if from.parent() == Some(dir.as_path()) {
        return Err(failure(
            "move",
            &from,
            format!("it is already in {}", dir.display()),
        ));
    }
    let to = dir.join(name);
    if fs::symlink_metadata(&to).is_ok() {
        return Err(failure(
            "move",
            &from,
            format!("{} already exists", to.display()),
        ));
    }
    fs::rename(&from, &to).map_err(|err| failure("move", &from, err))?;
    Ok(to)
}

/// Replaces the text of the existing file `path` with `content`, but only while it still holds
/// `expected` (the text that was opened), so changes made by someone else are never lost.
/// Writes in place, so a symlink, the file's mode and its owner are kept.
pub fn write_text(path: &Path, expected: &str, content: &str) -> Result<(), String> {
    use std::io::Write;
    let (current, truncated) = read_prefix(path, MAX_VIEW_BYTES)
        .map_err(|err| err.replacen("cannot read", "cannot save", 1))?;
    if truncated || current != expected.as_bytes() {
        return Err(failure(
            "save",
            path,
            "it changed on disk since it was opened",
        ));
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|err| failure("save", path, err))?;
    file.write_all(content.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|err| failure("save", path, err))
}

/// Removes a file, a symlink (never what it points to), or a folder with everything inside it.
pub fn remove(path: &Path, is_dir: bool) -> Result<(), String> {
    // `link/` would resolve the symlink and delete what it points to.
    let path = &without_trailing_separators(path);
    let link = fs::symlink_metadata(path).map_err(|err| failure("delete", path, err))?;
    let result = if is_dir && link.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|err| failure("delete", path, err))
}

/// `path` without trailing `/` (or `\` on Windows); a root keeps its separator.
fn without_trailing_separators(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    let trimmed = text.trim_end_matches(std::path::is_separator);
    if trimmed.is_empty() || trimmed.ends_with(':') {
        return path.to_path_buf();
    }
    PathBuf::from(trimmed)
}

pub fn chmod(path: &Path, mode: u32) -> Result<(), String> {
    const ACTION: &str = "change permissions of";
    if mode > MAX_MODE {
        return Err(failure(ACTION, path, format!("invalid mode {mode:#o}")));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode))
            .map_err(|err| failure(ACTION, path, err))
    }
    #[cfg(not(unix))]
    {
        Err(failure(ACTION, path, "not supported on this system"))
    }
}

/// Bytes read from one file attached to an AI question; the rest is left out.
pub const MAX_ATTACH_BYTES: usize = 64 * 1024;
/// Entries of a folder attached to an AI question.
const MAX_ATTACH_ENTRIES: usize = 500;
/// Bytes of a file shown in the file viewer; the rest is left out.
pub const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024;

/// A file's text (or a folder's listing) attached to an AI question.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub content: String,
    /// The file is longer than what was read.
    pub truncated: bool,
}

/// The text of the first bytes of a file; refused when they hold a NUL byte or invalid UTF-8
/// (a character cut by the size limit is dropped, not refused).
pub fn text_from(path: &str, bytes: Vec<u8>, truncated: bool) -> Result<TextFile, String> {
    text_for("attach", path, bytes, truncated)
}

/// [`text_from`] for another action (`view`): its errors say `cannot <verb> <path>: ...`.
pub fn text_for(
    verb: &str,
    path: &str,
    bytes: Vec<u8>,
    truncated: bool,
) -> Result<TextFile, String> {
    let not_text = || format!("cannot {verb} {path}: it is not a text file");
    if bytes.contains(&0) {
        return Err(not_text());
    }
    let content = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) if truncated && err.utf8_error().error_len().is_none() => {
            let valid = err.utf8_error().valid_up_to();
            let mut bytes = err.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).map_err(|_| not_text())?
        }
        Err(_) => return Err(not_text()),
    };
    Ok(TextFile {
        path: path.to_string(),
        content,
        truncated,
    })
}

/// A folder's entries as text, one per line, folders ending in `/`.
pub fn listing_text(path: &str, entries: &[Entry]) -> TextFile {
    let lines: Vec<String> = entries
        .iter()
        .take(MAX_ATTACH_ENTRIES)
        .map(|entry| match entry.kind {
            EntryKind::Dir => format!("{}/", entry.name),
            _ => entry.name.clone(),
        })
        .collect();
    TextFile {
        path: path.to_string(),
        content: lines.join("\n"),
        truncated: entries.len() > MAX_ATTACH_ENTRIES,
    }
}

/// The first [`MAX_ATTACH_BYTES`] of a text file, or a folder's listing.
pub fn read_text(path: &Path) -> Result<TextFile, String> {
    let label = path.to_string_lossy().into_owned();
    if fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Ok(listing_text(&label, &list(path)?));
    }
    let (bytes, truncated) = read_prefix(path, MAX_ATTACH_BYTES)?;
    text_from(&label, bytes, truncated)
}

/// The first [`MAX_VIEW_BYTES`] of a text file, for the file viewer.
pub fn view_text(path: &Path) -> Result<TextFile, String> {
    let label = path.to_string_lossy().into_owned();
    if fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false) {
        return Err(format!("cannot view {label}: it is a folder"));
    }
    let (bytes, truncated) = read_prefix(path, MAX_VIEW_BYTES)?;
    text_for("view", &label, bytes, truncated)
}

/// The first `max` bytes of a file, and whether it is longer.
fn read_prefix(path: &Path, max: usize) -> Result<(Vec<u8>, bool), String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|err| failure("read", path, err))?;
    let mut bytes = Vec::new();
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| failure("read", path, err))?;
    let truncated = bytes.len() > max;
    bytes.truncate(max);
    Ok((bytes, truncated))
}

fn native(path: &str) -> PathBuf {
    platform::expand_home(path)
}

#[tauri::command]
pub async fn local_home() -> Result<String, String> {
    home()
}

#[tauri::command]
pub async fn local_list(path: String) -> Result<Vec<Entry>, String> {
    list(&native(&path))
}

#[tauri::command]
pub async fn local_stat(path: String) -> Result<Entry, String> {
    stat(&native(&path))
}

#[tauri::command]
pub async fn local_mkdir(path: String) -> Result<(), String> {
    mkdir(&native(&path))
}

#[tauri::command]
pub async fn local_create_file(path: String) -> Result<(), String> {
    create_file(&native(&path))
}

#[tauri::command]
pub async fn local_rename(from: String, to: String) -> Result<(), String> {
    rename(&native(&from), &native(&to))
}

#[tauri::command]
pub async fn local_remove(path: String, is_dir: bool) -> Result<(), String> {
    remove(&native(&path), is_dir)
}

#[tauri::command]
pub async fn local_chmod(path: String, mode: u32) -> Result<(), String> {
    chmod(&native(&path), mode)
}

/// A local file's text (or a folder's listing) to attach to an AI question.
#[tauri::command]
pub async fn local_read_text(path: String) -> Result<TextFile, String> {
    read_text(&native(&path))
}

/// A local text file for the file viewer.
#[tauri::command]
pub async fn local_view_text(path: String) -> Result<TextFile, String> {
    view_text(&native(&path))
}

/// Saves the file viewer's text over a local file that still holds `expected`.
#[tauri::command]
pub async fn local_write_text(
    path: String,
    expected: String,
    content: String,
) -> Result<(), String> {
    write_text(&native(&path), &expected, &content)
}

/// Moves a local file or folder into another folder; returns its new path.
#[tauri::command]
pub async fn local_move(from: String, dir: String) -> Result<String, String> {
    move_into(&native(&from), &native(&dir)).map(|to| to.to_string_lossy().into_owned())
}

/// Opens a local file in its default program, the text editor or a chosen program.
#[tauri::command]
pub async fn local_open(path: String, with: OpenWith) -> Result<(), String> {
    launch(&with, &native(&path)).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(entries: &[Entry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn lists_folders_first_then_by_case_insensitive_name() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("b.txt"), "hello").unwrap();
        fs::write(dir.path().join("A.txt"), "").unwrap();
        fs::create_dir(dir.path().join("zeta")).unwrap();
        fs::create_dir(dir.path().join("Alpha")).unwrap();
        let entries = list(dir.path()).unwrap();
        assert_eq!(names(&entries), ["Alpha", "zeta", "A.txt", "b.txt"]);
        let b = &entries[3];
        assert_eq!(b.kind, EntryKind::File);
        assert_eq!(b.size, 5);
        assert_eq!(b.path, dir.path().join("b.txt").to_string_lossy());
        assert!(b.modified.is_some());
        assert_eq!(entries[0].kind, EntryKind::Dir);
    }

    #[test]
    fn listing_a_missing_folder_names_it() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        let err = list(&missing).unwrap_err();
        assert!(
            err.starts_with(&format!("cannot list {}: ", missing.display())),
            "{err}"
        );
    }

    #[test]
    fn stat_reports_a_folder_and_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        fs::write(&file, "abc").unwrap();
        assert_eq!(stat(dir.path()).unwrap().kind, EntryKind::Dir);
        let entry = stat(&file).unwrap();
        assert_eq!(
            (entry.name.as_str(), entry.kind, entry.size),
            ("f", EntryKind::File, 3)
        );
        assert!(
            stat(&dir.path().join("x"))
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_reported_and_removed_without_its_target() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), "").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(stat(&link).unwrap().kind, EntryKind::Symlink);
        remove(&link, true).unwrap();
        assert!(!link.exists());
        assert!(target.join("keep").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_trailing_slash_never_deletes_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), "").unwrap();
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        remove(Path::new(&format!("{}/", link.display())), true).unwrap();
        assert!(fs::symlink_metadata(&link).is_err(), "the link is removed");
        assert!(target.join("keep").exists(), "its target is kept");
    }

    #[test]
    fn creates_renames_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("new");
        mkdir(&folder).unwrap();
        assert!(mkdir(&folder).unwrap_err().starts_with("cannot create "));
        let file = folder.join("a.txt");
        create_file(&file).unwrap();
        assert!(
            create_file(&file)
                .unwrap_err()
                .starts_with("cannot create ")
        );
        let other = folder.join("b.txt");
        create_file(&other).unwrap();
        let err = rename(&file, &other).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert!(file.exists());
        rename(&file, &folder.join("c.txt")).unwrap();
        assert!(folder.join("c.txt").exists() && !file.exists());
        remove(&other, false).unwrap();
        assert!(!other.exists());
        remove(&folder, true).unwrap();
        assert!(!folder.exists());
        assert!(
            remove(&folder, true)
                .unwrap_err()
                .starts_with("cannot delete ")
        );
    }

    #[test]
    fn reads_text_files_up_to_the_limit_and_refuses_binary_ones() {
        let dir = tempfile::tempdir().unwrap();
        let small = dir.path().join("notes.txt");
        fs::write(&small, "line 1\nline 2").unwrap();
        let read = read_text(&small).unwrap();
        assert_eq!(read.content, "line 1\nline 2");
        assert!(!read.truncated);
        assert_eq!(read.path, small.to_string_lossy());

        // A two-byte character cut by the limit is dropped, not refused.
        let big = dir.path().join("big.txt");
        let mut text = "a".repeat(MAX_ATTACH_BYTES - 1);
        text.push('ñ');
        text.push_str("tail");
        fs::write(&big, &text).unwrap();
        let read = read_text(&big).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content, "a".repeat(MAX_ATTACH_BYTES - 1));

        let binary = dir.path().join("a.bin");
        fs::write(&binary, [0x7f, b'E', b'L', b'F', 0, 1]).unwrap();
        let err = read_text(&binary).unwrap_err();
        assert_eq!(
            err,
            format!("cannot attach {}: it is not a text file", binary.display())
        );
        fs::write(&binary, [0xff, 0xfe, b'a']).unwrap();
        assert!(read_text(&binary).unwrap_err().contains("not a text file"));
        assert!(
            read_text(&dir.path().join("x"))
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[test]
    fn views_text_files_up_to_the_view_limit_and_refuses_folders_and_binary_ones() {
        let dir = tempfile::tempdir().unwrap();
        // Longer than an attachment, within the viewer's limit: read whole.
        let long = dir.path().join("long.rs");
        let text = "x".repeat(MAX_ATTACH_BYTES * 2);
        fs::write(&long, &text).unwrap();
        let read = view_text(&long).unwrap();
        assert_eq!(read.content, text);
        assert!(!read.truncated);

        let huge = dir.path().join("huge.log");
        fs::write(&huge, "y".repeat(MAX_VIEW_BYTES + 10)).unwrap();
        let read = view_text(&huge).unwrap();
        assert!(read.truncated);
        assert_eq!(read.content.len(), MAX_VIEW_BYTES);

        let binary = dir.path().join("a.bin");
        fs::write(&binary, [0x7f, b'E', b'L', b'F', 0, 1]).unwrap();
        assert_eq!(
            view_text(&binary).unwrap_err(),
            format!("cannot view {}: it is not a text file", binary.display())
        );
        assert_eq!(
            view_text(dir.path()).unwrap_err(),
            format!("cannot view {}: it is a folder", dir.path().display())
        );
        assert!(
            view_text(&dir.path().join("x"))
                .unwrap_err()
                .starts_with("cannot read ")
        );
    }

    #[test]
    fn a_folder_is_attached_as_its_listing() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("README.md"), "").unwrap();
        let read = read_text(dir.path()).unwrap();
        assert_eq!(read.content, "src/\nREADME.md");
        assert!(!read.truncated);
    }

    #[test]
    fn write_text_saves_over_the_text_that_was_opened() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "old").unwrap();
        write_text(&file, "old", "new text").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new text");
    }

    #[test]
    fn write_text_refuses_a_file_that_changed_since_it_was_opened() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, "changed by someone else").unwrap();
        let err = write_text(&file, "old", "mine").unwrap_err();
        assert!(err.contains("changed on disk"), "{err}");
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            "changed by someone else"
        );
    }

    #[test]
    fn write_text_refuses_a_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("gone.txt");
        let err = write_text(&file, "old", "mine").unwrap_err();
        assert!(err.starts_with("cannot save"), "{err}");
        assert!(!file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn write_text_keeps_a_symlink_and_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real.sh");
        fs::write(&target, "echo 1").unwrap();
        chmod(&target, 0o755).unwrap();
        let link = dir.path().join("link.sh");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        write_text(&link, "echo 1", "echo 2").unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "echo 2");
        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o7777;
        assert_eq!(mode, 0o755);
    }

    #[test]
    fn move_into_moves_a_file_and_a_folder_into_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("inner"), "y").unwrap();

        let moved = move_into(&dir.path().join("f.txt"), &dest).unwrap();
        assert_eq!(moved, dest.join("f.txt"));
        assert_eq!(fs::read_to_string(dest.join("f.txt")).unwrap(), "x");
        assert!(!dir.path().join("f.txt").exists());

        move_into(&dir.path().join("sub"), &dest).unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("sub").join("inner")).unwrap(),
            "y"
        );
        assert!(!dir.path().join("sub").exists());
    }

    #[test]
    fn move_into_never_replaces_an_entry_with_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dest");
        fs::create_dir(&dest).unwrap();
        fs::write(dest.join("f.txt"), "kept").unwrap();
        fs::write(dir.path().join("f.txt"), "moving").unwrap();
        let err = move_into(&dir.path().join("f.txt"), &dest).unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(fs::read_to_string(dest.join("f.txt")).unwrap(), "kept");
        assert_eq!(
            fs::read_to_string(dir.path().join("f.txt")).unwrap(),
            "moving"
        );
    }

    #[test]
    fn move_into_refuses_a_folder_into_itself_or_its_subfolders() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("a");
        fs::create_dir_all(folder.join("b")).unwrap();
        for target in [folder.clone(), folder.join("b")] {
            let err = move_into(&folder, &target).unwrap_err();
            assert!(err.contains("into itself"), "{err}");
        }
        // A sibling whose name starts the same is not inside it.
        fs::create_dir(dir.path().join("ab")).unwrap();
        move_into(&folder, &dir.path().join("ab")).unwrap();
        assert!(dir.path().join("ab").join("a").join("b").is_dir());
    }

    #[test]
    fn move_into_its_own_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("f.txt"), "x").unwrap();
        let err = move_into(&dir.path().join("f.txt"), dir.path()).unwrap_err();
        assert!(err.contains("already in"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn chmod_sets_the_mode_and_rejects_invalid_ones() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f");
        fs::write(&file, "").unwrap();
        chmod(&file, 0o640).unwrap();
        assert_eq!(stat(&file).unwrap().permissions, Some(0o640));
        let err = chmod(&file, 0o17777).unwrap_err();
        assert!(err.contains("invalid mode"), "{err}");
    }
}
