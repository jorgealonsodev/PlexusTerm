//! Small JSON documents stored in the app config directory.
//!
//! Writes are atomic (temp file + rename) and private to the user (0600 on Unix, the
//! profile ACLs on Windows), so a crash never leaves a half-written file and other users
//! cannot read it.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Makes temp file names unique across concurrent writes in this process.
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("invalid JSON: {0}")]
    InvalidJson(String),
    #[error("{0}")]
    Io(String),
}

impl serde::Serialize for StorageError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Returns the file contents, or `None` when it does not exist yet.
pub fn load(path: &Path) -> Result<Option<String>, StorageError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(io(path, err)),
    }
}

/// The sessions file shared through a folder the user syncs (Syncthing, Drive…).
pub const SYNC_FILE: &str = "plexusterm-sessions-sync.json";

/// The shared sessions file in `folder`, which must be an existing absolute folder: a relative or
/// missing one would put the file somewhere the user did not choose.
pub fn sync_file(folder: &str) -> Result<std::path::PathBuf, StorageError> {
    let dir = Path::new(folder);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(StorageError::Io(format!(
            "{folder}: the sync folder must be an existing folder"
        )));
    }
    Ok(dir.join(SYNC_FILE))
}

/// Serializes writes made by this process (see `save`).
static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Validates `contents` as JSON and atomically replaces the file.
pub fn save(path: &Path, contents: &str) -> Result<(), StorageError> {
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|err| StorageError::InvalidJson(err.to_string()))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| io(parent, err))?;
    }
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    tmp_name.push(format!(".tmp-{}-{seq}", std::process::id()));
    let tmp = path.with_file_name(tmp_name);

    // One writer at a time: Windows refuses concurrent renames onto the same file.
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let result = crate::platform::write_private(&tmp, contents.as_bytes())
        .and_then(|()| crate::platform::replace_file(&tmp, path));
    if let Err(err) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(path, err));
    }
    Ok(())
}

fn io(path: &Path, err: std::io::Error) -> StorageError {
    StorageError::Io(format!("{}: {err}", path.display()))
}

/// Reads a file the user picked for import, refusing anything larger than `max_bytes`.
pub fn read_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>, StorageError> {
    use std::io::Read;

    let file = std::fs::File::open(path).map_err(|err| io(path, err))?;
    let mut bytes = Vec::new();
    // Read one byte past the limit to detect oversized files without loading them whole.
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|err| io(path, err))?;
    if bytes.len() as u64 > max_bytes {
        return Err(StorageError::Io(format!(
            "{}: file is too large (limit {max_bytes} bytes)",
            path.display()
        )));
    }
    Ok(bytes)
}

fn too_large(path: &Path, max_bytes: u64) -> StorageError {
    StorageError::Io(format!(
        "{}: contents are too large (limit {max_bytes} bytes)",
        path.display()
    ))
}

/// Writes a text file the user chose (e.g. saved terminal output), replacing it.
/// Refuses contents larger than `max_bytes` before touching the file.
pub fn write_text(path: &Path, contents: &str, max_bytes: u64) -> Result<(), StorageError> {
    if contents.len() as u64 > max_bytes {
        return Err(too_large(path, max_bytes));
    }
    std::fs::write(path, contents).map_err(|err| io(path, err))
}

/// Appends to a text file the user chose (e.g. a session log), creating it when missing.
/// Refuses chunks larger than `max_bytes`; the parent directory must exist.
pub fn append_text(path: &Path, contents: &str, max_bytes: u64) -> Result<(), StorageError> {
    if contents.len() as u64 > max_bytes {
        return Err(too_large(path, max_bytes));
    }
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(path)
        .map_err(|err| io(path, err))?;
    file.write_all(contents.as_bytes())
        .map_err(|err| io(path, err))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_bounded_returns_the_bytes_of_small_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.ini");
        std::fs::write(&path, b"[Bookmarks]\r\n\xf1").unwrap();
        assert_eq!(read_bounded(&path, 1024).unwrap(), b"[Bookmarks]\r\n\xf1");
    }

    #[test]
    fn read_bounded_refuses_files_over_the_limit_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.ini");
        std::fs::write(&path, vec![b'x'; 2048]).unwrap();
        let err = read_bounded(&path, 1024).unwrap_err().to_string();
        assert!(err.contains("too large"), "{err}");
        assert!(read_bounded(&dir.path().join("missing.ini"), 1024).is_err());
    }

    #[test]
    fn write_text_creates_or_replaces_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("output.txt");
        write_text(&path, "first\n", 1024).unwrap();
        write_text(&path, "second\n", 1024).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second\n");
    }

    #[test]
    fn write_text_refuses_contents_over_the_limit_and_leaves_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("output.txt");
        let err = write_text(&path, &"x".repeat(2048), 1024)
            .unwrap_err()
            .to_string();
        assert!(err.contains("too large"), "{err}");
        assert!(!path.exists());
    }

    #[test]
    fn append_text_creates_the_file_then_appends() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.log");
        append_text(&path, "one\n", 1024).unwrap();
        append_text(&path, "two\n", 1024).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\n");
        assert!(append_text(&path, &"x".repeat(2048), 1024).is_err());
        assert!(append_text(&dir.path().join("missing/dir/x.log"), "a", 1024).is_err());
    }

    #[test]
    fn missing_file_loads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(&dir.path().join("sessions.json")).unwrap(), None);
    }

    #[test]
    fn the_sync_file_goes_only_in_an_existing_absolute_folder() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_str().unwrap();
        assert_eq!(sync_file(folder).unwrap(), dir.path().join(SYNC_FILE));
        assert!(sync_file("relative/folder").is_err());
        assert!(sync_file(dir.path().join("missing").to_str().unwrap()).is_err());
        let file = dir.path().join("a-file");
        std::fs::write(&file, "x").unwrap();
        assert!(sync_file(file.to_str().unwrap()).is_err());
    }

    #[test]
    fn save_then_load_round_trips_and_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/dir/sessions.json");
        save(&path, r#"{"version":1}"#).unwrap();
        assert_eq!(load(&path).unwrap().as_deref(), Some(r#"{"version":1}"#));
    }

    #[test]
    fn save_overwrites_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        save(&path, "[1]").unwrap();
        save(&path, "[2]").unwrap();
        assert_eq!(load(&path).unwrap().as_deref(), Some("[2]"));
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec!["sessions.json"]);
    }

    #[test]
    fn invalid_json_is_rejected_and_keeps_the_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        save(&path, "[1]").unwrap();
        assert!(matches!(
            save(&path, "{not json"),
            Err(StorageError::InvalidJson(_))
        ));
        assert_eq!(load(&path).unwrap().as_deref(), Some("[1]"));
    }

    #[test]
    fn concurrent_saves_never_corrupt_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = std::sync::Arc::new(dir.path().join("sessions.json"));
        let threads: Vec<_> = (0..16)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || {
                    save(&path, &format!("[{}]", "1,".repeat(i * 500) + "0")).unwrap()
                })
            })
            .collect();
        threads.into_iter().for_each(|t| t.join().unwrap());
        let text = load(&path).unwrap().unwrap();
        assert!(
            serde_json::from_str::<serde_json::Value>(&text).is_ok(),
            "corrupt: {}",
            &text[..40.min(text.len())]
        );
    }

    #[cfg(unix)]
    #[test]
    fn saved_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        save(&path, "{}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
