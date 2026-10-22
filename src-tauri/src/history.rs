//! Command history behind inline suggestions (S1): `history.json` in the app config
//! directory, written atomically and private to the user (0600 on Unix) like every other
//! document in `storage`. The frontend owns its format (dedup, caps, ranking).

use std::path::Path;

use tauri::AppHandle;

use crate::storage::{self, StorageError};

const HISTORY_FILE: &str = "history.json";

/// Upper bound for history.json: 200 hosts x 2000 commands fit well below it.
const HISTORY_MAX_BYTES: usize = 32 * 1024 * 1024;

/// Returns history.json, or `None` before the first command was recorded.
pub fn load_from(path: &Path) -> Result<Option<String>, StorageError> {
    storage::load(path)
}

/// Replaces history.json, refusing invalid JSON and oversized contents.
pub fn save_to(path: &Path, contents: &str) -> Result<(), StorageError> {
    if contents.len() > HISTORY_MAX_BYTES {
        return Err(StorageError::Io(format!(
            "{}: contents are too large (limit {HISTORY_MAX_BYTES} bytes)",
            path.display()
        )));
    }
    storage::save(path, contents)
}

// Async with the file work on the blocking pool: a sync command runs on the main thread, where a
// slow disk would hold up the window.
#[tauri::command]
pub async fn history_load(app: AppHandle) -> Result<Option<String>, StorageError> {
    let path = crate::config_path(&app, HISTORY_FILE)?;
    tauri::async_runtime::spawn_blocking(move || load_from(&path))
        .await
        .map_err(|err| StorageError::Io(err.to_string()))?
}

// Sync on purpose: the main thread runs saves in the order they were sent, so an older save can
// never land after a newer one.
#[tauri::command]
pub fn history_save(app: AppHandle, contents: String) -> Result<(), StorageError> {
    save_to(&crate::config_path(&app, HISTORY_FILE)?, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"version":1,"hosts":{"local":[{"command":"ls","count":1,"last":1}]}}"#;

    #[test]
    fn missing_history_loads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_from(&dir.path().join(HISTORY_FILE)).unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        save_to(&path, SAMPLE).unwrap();
        assert_eq!(load_from(&path).unwrap().as_deref(), Some(SAMPLE));
    }

    #[test]
    fn invalid_or_oversized_contents_are_refused_and_keep_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        save_to(&path, SAMPLE).unwrap();
        assert!(matches!(
            save_to(&path, "{nope"),
            Err(StorageError::InvalidJson(_))
        ));
        let big = format!("[\"{}\"]", "x".repeat(HISTORY_MAX_BYTES));
        let err = save_to(&path, &big).unwrap_err().to_string();
        assert!(err.contains("too large"), "{err}");
        assert_eq!(load_from(&path).unwrap().as_deref(), Some(SAMPLE));
    }

    #[cfg(unix)]
    #[test]
    fn history_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(HISTORY_FILE);
        save_to(&path, SAMPLE).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
