//! Small JSON documents stored in the app config directory.
//!
//! Writes are atomic (temp file + rename) and private to the user (0600), so a
//! crash never leaves a half-written file and other users cannot read it.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
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

    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if let Err(err) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(path, err));
    }
    Ok(())
}

fn io(path: &Path, err: std::io::Error) -> StorageError {
    StorageError::Io(format!("{}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn missing_file_loads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(&dir.path().join("sessions.json")).unwrap(), None);
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

    #[test]
    fn saved_file_is_private_to_the_user() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        save(&path, "{}").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
