//! Latency diagnostics, only with `PLEXUS_LATENCY_LOG=<folder>`: the moments a key and its echo
//! pass through the backend, in `<folder>/rust.log` (`<mark> <µs since the epoch> <bytes>`), to
//! line up with the frontend's `<folder>/js.log`. Only times and sizes, never the text.

use std::io::Write;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

fn folder() -> Option<&'static str> {
    static FOLDER: OnceLock<Option<String>> = OnceLock::new();
    FOLDER
        .get_or_init(|| std::env::var("PLEXUS_LATENCY_LOG").ok().filter(|f| !f.is_empty()))
        .as_deref()
}

fn log() -> Option<&'static Mutex<std::fs::File>> {
    static LOG: OnceLock<Option<Mutex<std::fs::File>>> = OnceLock::new();
    LOG.get_or_init(|| {
        let dir = folder()?;
        std::fs::create_dir_all(dir).ok()?;
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::path::Path::new(dir).join("rust.log"))
            .ok()
            .map(Mutex::new)
    })
    .as_ref()
}

/// Records `mark` now, with a size in bytes.
pub fn mark(mark: &str, bytes: usize) {
    if let Some(file) = log() {
        let micros = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_micros())
            .unwrap_or(0);
        if let Ok(mut file) = file.lock() {
            let _ = writeln!(file, "{mark} {micros} {bytes}");
        }
    }
}

/// Where the frontend writes its marks, or None when diagnostics are off.
#[tauri::command]
pub fn diag_latency_log() -> Option<String> {
    folder().map(|dir| std::path::Path::new(dir).join("js.log").to_string_lossy().into_owned())
}
