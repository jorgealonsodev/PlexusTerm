//! Crash markers (PRD-share §4.1.7): a file per live share, refreshed while it runs and removed
//! when it ends cleanly. One left behind at start-up is a share that ended with a crash: "Your
//! share of <tab> ended unexpectedly at <time>", the time being its last refresh.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crashed {
    pub tab: String,
    /// Last time the share was known alive, Unix seconds.
    pub at: u64,
}

pub struct Marker {
    path: PathBuf,
    tab: String,
}

impl Marker {
    /// Writes the marker of share `id` in `dir`.
    pub fn create(dir: &Path, id: u32, tab: &str, now_secs: u64) -> Self {
        let marker = Self {
            path: dir.join(format!("share-{}-{id}.json", std::process::id())),
            tab: tab.to_string(),
        };
        let _ = std::fs::create_dir_all(dir);
        marker.touch(now_secs);
        marker
    }

    /// The share is still alive at `now_secs`.
    pub fn touch(&self, now_secs: u64) {
        let body = Crashed {
            tab: self.tab.clone(),
            at: now_secs,
        };
        if let Ok(json) = serde_json::to_string(&body) {
            let _ = std::fs::write(&self.path, json);
        }
    }

    /// The share ended cleanly.
    pub fn remove(self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// A live share refreshes its marker every 20 s (each ping); one this old belongs to no running
/// PlexusTerm (another instance's live shares are left alone).
pub const STALE_SECS: u64 = 90;

/// The shares that ended with a crash, read once: their markers are deleted.
pub fn take_crashed(dir: &Path, now_secs: u64) -> Vec<Crashed> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut crashed: Vec<Crashed> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("share-") && n.ends_with(".json"))
        })
        .filter_map(|path| {
            let found = std::fs::read_to_string(&path)
                .ok()
                .and_then(|text| serde_json::from_str::<Crashed>(&text).ok());
            if found
                .as_ref()
                .is_some_and(|c| now_secs.saturating_sub(c.at) < STALE_SECS)
            {
                return None;
            }
            let _ = std::fs::remove_file(&path);
            found
        })
        .collect();
    crashed.sort_by_key(|c| c.at);
    crashed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clean_end_leaves_nothing_and_a_crash_is_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        let clean = Marker::create(dir.path(), 1, "build", 10);
        clean.remove();
        let crashed = Marker::create(dir.path(), 2, "claude", 20);
        crashed.touch(42);
        std::mem::forget(crashed);
        let now = 42 + STALE_SECS;
        assert_eq!(
            take_crashed(dir.path(), now),
            vec![Crashed {
                tab: "claude".into(),
                at: 42
            }]
        );
        assert!(take_crashed(dir.path(), now).is_empty());
    }

    #[test]
    fn a_share_still_refreshed_by_another_instance_is_not_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let live = Marker::create(dir.path(), 1, "build", 1000);
        assert!(take_crashed(dir.path(), 1000 + STALE_SECS - 1).is_empty());
        live.remove();
    }

    #[test]
    fn a_missing_folder_has_no_crashes() {
        let dir = tempfile::tempdir().unwrap();
        assert!(take_crashed(&dir.path().join("none"), 0).is_empty());
    }
}
