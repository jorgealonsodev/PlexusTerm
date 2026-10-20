//! The local audit log of shares (PRD-share §6.2): append-only JSON lines kept 30 days, with share
//! start and end, access, expiry, each join request, approval, denial and disconnect, and each
//! viewer's input bursts (time and byte count; the typed text only when the user enables it).

use std::path::{Path, PathBuf};

use serde_json::{Value, json};

/// Entries older than this are deleted when a share starts.
pub const KEEP_SECS: u64 = 30 * 24 * 60 * 60;
/// One entry never exceeds this (a long paste recorded with "Record what viewers type").
const MAX_ENTRY_BYTES: u64 = 256 * 1024;
/// At most this many entries are shown in the share menu.
pub const SHOWN: usize = 1000;
/// A viewer's keys less than this apart are one input burst.
pub const BURST_GAP_MS: u64 = 2000;

#[derive(Clone)]
pub struct Audit {
    path: PathBuf,
    /// Tab name, written on every entry so entries of several shares can be told apart.
    tab: String,
}

impl Audit {
    pub fn new(path: PathBuf, tab: String) -> Self {
        Self { path, tab }
    }

    /// Appends `event` with its fields; failures are ignored (the log never stops a share).
    pub fn log(&self, now_secs: u64, event: &str, fields: Value) {
        let mut entry = json!({ "at": now_secs, "tab": self.tab, "event": event });
        if let (Some(entry), Value::Object(fields)) = (entry.as_object_mut(), fields) {
            entry.extend(fields);
        }
        let line = format!("{entry}\n");
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = crate::storage::append_text(&self.path, &line, MAX_ENTRY_BYTES);
    }
}

fn entry_time(line: &str) -> Option<u64> {
    serde_json::from_str::<Value>(line)
        .ok()?
        .get("at")?
        .as_u64()
}

/// Deletes the entries older than [`KEEP_SECS`] (and lines that are not entries).
pub fn prune(path: &Path, now_secs: u64) -> std::io::Result<()> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => return Err(err),
    };
    let cutoff = now_secs.saturating_sub(KEEP_SECS);
    let kept: String = text
        .lines()
        .filter(|line| entry_time(line).is_some_and(|at| at >= cutoff))
        .map(|line| format!("{line}\n"))
        .collect();
    if kept.len() != text.len() {
        std::fs::write(path, kept)?;
    }
    Ok(())
}

/// The latest [`SHOWN`] entries, oldest first.
pub fn read(path: &Path) -> std::io::Result<Vec<Value>> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let entries: Vec<Value> = text
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    let skip = entries.len().saturating_sub(SHOWN);
    Ok(entries.into_iter().skip(skip).collect())
}

/// One viewer's keys while they keep typing.
pub struct Burst {
    pub started_ms: u64,
    pub last_ms: u64,
    pub bytes: usize,
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_entries_with_their_fields_and_reads_them_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs").join("share-audit.log");
        let audit = Audit::new(path.clone(), "bash".into());
        audit.log(100, "start", json!({ "access": ["view"] }));
        audit.log(101, "joinRequest", json!({ "viewer": 1, "ip": "1.2.3.4" }));
        let entries = read(&path).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["event"], "start");
        assert_eq!(entries[0]["tab"], "bash");
        assert_eq!(entries[1]["ip"], "1.2.3.4");
    }

    #[test]
    fn prune_keeps_only_the_last_30_days() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("share-audit.log");
        let audit = Audit::new(path.clone(), "t".into());
        let now = 100 * 24 * 60 * 60;
        audit.log(now - KEEP_SECS - 1, "old", json!({}));
        audit.log(now - KEEP_SECS, "edge", json!({}));
        audit.log(now, "new", json!({}));
        prune(&path, now).unwrap();
        let events: Vec<_> = read(&path)
            .unwrap()
            .iter()
            .map(|e| e["event"].clone())
            .collect();
        assert_eq!(events, vec![json!("edge"), json!("new")]);
    }

    #[test]
    fn a_missing_log_reads_empty_and_prunes_to_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("none.log");
        assert!(read(&path).unwrap().is_empty());
        prune(&path, 0).unwrap();
        assert!(!path.exists());
    }
}
