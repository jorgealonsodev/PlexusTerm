use std::path::Path;
use std::time::Duration;

use super::*;
use crate::ssh::test_server::{self, PASSWORD};
use crate::ssh::{ConnectRequest, SshAuth, SshError, SshManager};
use crate::terminal::TerminalSink;
use russh_sftp::client::SftpSession;
use std::sync::Arc;

struct NullSink;

impl TerminalSink for NullSink {
    fn data(&self, _text: String) {}
    fn exit(&self, _code: Option<u32>) {}
}

/// Connects a manager to an SFTP-enabled test server rooted at `root`.
async fn connect(root: &Path) -> (SshManager, u32, tempfile::TempDir) {
    let server = test_server::start_with_sftp(root).await;
    let dir = tempfile::tempdir().unwrap();
    let known_hosts = dir.path().join("known_hosts");
    let port = server.addr.port();
    russh::keys::known_hosts::learn_known_hosts_path(
        "127.0.0.1",
        port,
        &server.host_key,
        &known_hosts,
    )
    .unwrap();
    let mgr = SshManager::new(known_hosts);
    let request = ConnectRequest {
        host: "127.0.0.1".into(),
        port,
        username: "tester".into(),
        auth: SshAuth::Password {
            password: PASSWORD.into(),
        },
        cols: 80,
        rows: 24,
        trusted_fingerprint: None,
        jumps: vec![],
    };
    let id = mgr.connect(request, NullSink).await.unwrap();
    (mgr, id, dir)
}

async fn session(root: &Path) -> (Arc<SftpSession>, SshManager, tempfile::TempDir) {
    let (mgr, id, dir) = connect(root).await;
    let sftp = tokio::time::timeout(Duration::from_secs(10), mgr.sftp(id))
        .await
        .expect("opening SFTP timed out")
        .unwrap();
    (sftp, mgr, dir)
}

#[tokio::test]
async fn home_is_the_canonical_working_directory() {
    let root = tempfile::tempdir().unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    assert_eq!(home(&sftp).await.unwrap(), "/");
}

#[tokio::test]
async fn the_sftp_session_is_opened_once_and_reused() {
    let root = tempfile::tempdir().unwrap();
    let (mgr, id, _dir) = connect(root.path()).await;
    let first = mgr.sftp(id).await.unwrap();
    let second = mgr.sftp(id).await.unwrap();
    assert!(Arc::ptr_eq(&first, &second));
}

// Creates a symlink, which needs privileges on Windows.
#[cfg(unix)]
#[tokio::test]
async fn list_puts_directories_first_then_names_case_insensitively() {
    let root = tempfile::tempdir().unwrap();
    let r = root.path();
    std::fs::write(r.join("b.txt"), b"12345").unwrap();
    std::fs::write(r.join("A.txt"), b"").unwrap();
    std::fs::create_dir(r.join("zeta")).unwrap();
    std::fs::create_dir(r.join("Alpha")).unwrap();
    std::os::unix::fs::symlink("b.txt", r.join("link")).unwrap();
    let (sftp, _mgr, _dir) = session(r).await;

    let entries = list(&sftp, "/").await.unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "zeta", "A.txt", "b.txt", "link"]);
    let kinds: Vec<EntryKind> = entries.iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds,
        [
            EntryKind::Dir,
            EntryKind::Dir,
            EntryKind::File,
            EntryKind::File,
            EntryKind::Symlink
        ]
    );
    let b = &entries[3];
    assert_eq!((b.path.as_str(), b.size), ("/b.txt", 5));
    assert!(b.modified.is_some_and(|m| m > 0));
    assert_eq!(b.permissions.map(|p| p & 0o600), Some(0o600));

    // Entries of a nested folder carry their full path.
    std::fs::write(r.join("zeta/inner"), b"x").unwrap();
    let nested = list(&sftp, "/zeta").await.unwrap();
    assert_eq!(nested.len(), 1);
    assert_eq!(nested[0].path, "/zeta/inner");
}

#[test]
fn entries_serialize_in_camel_case() {
    let entry = Entry {
        name: "a".into(),
        path: "/a".into(),
        kind: EntryKind::Symlink,
        size: 3,
        modified: Some(10),
        permissions: None,
    };
    assert_eq!(
        serde_json::to_value(&entry).unwrap(),
        serde_json::json!({"name": "a", "path": "/a", "kind": "symlink", "size": 3, "modified": 10, "permissions": null})
    );
}

#[tokio::test]
async fn upload_then_download_round_trips_a_large_binary_file() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("in")).unwrap();
    let local = tempfile::tempdir().unwrap();
    let source = local.path().join("blob.bin");
    let bytes: Vec<u8> = (0..(1024 * 1024 + 4321))
        .map(|i| (i * 31 % 251) as u8)
        .collect();
    std::fs::write(&source, &bytes).unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;

    let remote = upload(&sftp, &source, "/in").await.unwrap();
    assert_eq!(remote, "/in/blob.bin");
    assert_eq!(
        std::fs::read(root.path().join("in/blob.bin")).unwrap(),
        bytes
    );

    let target = local.path().join("copy.bin");
    download(&sftp, &remote, &target).await.unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), bytes);
}

#[tokio::test]
async fn upload_into_the_root_does_not_double_the_slash() {
    let root = tempfile::tempdir().unwrap();
    let local = tempfile::tempdir().unwrap();
    let source = local.path().join("a.txt");
    std::fs::write(&source, b"hi").unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    assert_eq!(upload(&sftp, &source, "/").await.unwrap(), "/a.txt");
}

#[tokio::test]
async fn a_failed_download_keeps_the_existing_local_file_and_leaves_no_temp_files() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("folder")).unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let local_dir = tempfile::tempdir().unwrap();
    let target = local_dir.path().join("keep.txt");
    std::fs::write(&target, b"keep me").unwrap();

    // Opening a directory as a file succeeds but reading it fails mid-transfer.
    assert!(download(&sftp, "/folder", &target).await.is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"keep me");
    let names: Vec<_> = std::fs::read_dir(local_dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names, vec!["keep.txt"]);
}

#[tokio::test]
async fn mkdir_then_remove_an_empty_directory() {
    let root = tempfile::tempdir().unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    mkdir(&sftp, "/new").await.unwrap();
    assert!(root.path().join("new").is_dir());
    remove(&sftp, "/new", true).await.unwrap();
    assert!(!root.path().join("new").exists());
}

#[tokio::test]
async fn removing_a_non_empty_directory_fails_and_keeps_it() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("full")).unwrap();
    std::fs::write(root.path().join("full/f"), b"x").unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let err = remove(&sftp, "/full", true).await.unwrap_err();
    assert!(matches!(err, SftpError::Sftp { .. }), "got {err:?}");
    assert!(root.path().join("full/f").exists());
}

#[tokio::test]
async fn remove_deletes_a_file() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("f"), b"x").unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    remove(&sftp, "/f", false).await.unwrap();
    assert!(!root.path().join("f").exists());
}

#[tokio::test]
async fn rename_moves_an_entry() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("old"), b"x").unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    rename(&sftp, "/old", "/new").await.unwrap();
    assert!(!root.path().join("old").exists());
    assert_eq!(std::fs::read(root.path().join("new")).unwrap(), b"x");
}

#[tokio::test]
async fn listing_a_missing_path_is_an_sftp_error() {
    let root = tempfile::tempdir().unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let err = list(&sftp, "/missing").await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "sftp");
    let message = json["message"].as_str().unwrap();
    assert!(message.contains("/missing"), "{message}");
}

#[tokio::test]
async fn sftp_on_an_unknown_session_is_an_unknown_session_error() {
    let dir = tempfile::tempdir().unwrap();
    let mgr = SshManager::new(dir.path().join("known_hosts"));
    let Err(err) = mgr.sftp(99).await else {
        panic!("expected an error");
    };
    assert!(
        matches!(err, SftpError::Ssh(SshError::UnknownSession { id: 99 })),
        "got {err:?}"
    );
    assert_eq!(
        serde_json::to_value(&err).unwrap(),
        serde_json::json!({"kind": "unknownSession", "id": 99})
    );
}
