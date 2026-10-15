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
        uid: Some(1000),
        gid: None,
        user: Some("jo".into()),
        group: None,
    };
    assert_eq!(
        serde_json::to_value(&entry).unwrap(),
        serde_json::json!({
            "name": "a", "path": "/a", "kind": "symlink", "size": 3, "modified": 10, "permissions": null,
            "uid": 1000, "gid": null, "user": "jo", "group": null
        })
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
async fn create_file_makes_an_empty_file_and_never_replaces_one() {
    let root = tempfile::tempdir().unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    create_file(&sftp, "/new.txt").await.unwrap();
    assert_eq!(std::fs::read(root.path().join("new.txt")).unwrap(), b"");
    std::fs::write(root.path().join("keep.txt"), b"data").unwrap();
    let err = create_file(&sftp, "/keep.txt").await.unwrap_err();
    assert!(
        err.to_string().contains("cannot create file /keep.txt"),
        "{err}"
    );
    assert_eq!(
        std::fs::read(root.path().join("keep.txt")).unwrap(),
        b"data"
    );
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

#[cfg(unix)]
#[tokio::test]
async fn list_entries_carry_the_owner_ids() {
    use std::os::unix::fs::MetadataExt;
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("f"), b"x").unwrap();
    let meta = std::fs::metadata(root.path().join("f")).unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let entries = list(&sftp, "/").await.unwrap();
    assert_eq!(
        (entries[0].uid, entries[0].gid),
        (Some(meta.uid()), Some(meta.gid()))
    );
}

#[cfg(unix)]
#[tokio::test]
async fn chmod_sets_the_permission_bits() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("script.sh");
    std::fs::write(&file, b"x").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;

    chmod(&sftp, "/script.sh", 0o750).await.unwrap();
    let mode = std::fs::metadata(&file).unwrap().permissions().mode();
    assert_eq!(mode & 0o7777, 0o750);
    let listed = list(&sftp, "/").await.unwrap();
    assert_eq!(listed[0].permissions.map(|p| p & 0o7777), Some(0o750));
}

#[cfg(unix)]
#[tokio::test]
async fn chmod_rejects_modes_above_0o7777_and_keeps_the_file() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("f");
    std::fs::write(&file, b"x").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;

    let err = chmod(&sftp, "/f", 0o10000).await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "sftp");
    assert_eq!(
        json["message"],
        "cannot change permissions of /f: invalid mode 0o10000"
    );
    let mode = std::fs::metadata(&file).unwrap().permissions().mode();
    assert_eq!(mode & 0o7777, 0o644);
}

#[tokio::test]
async fn chmod_of_a_missing_path_is_an_sftp_error() {
    let root = tempfile::tempdir().unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let err = chmod(&sftp, "/missing", 0o644).await.unwrap_err();
    let json = serde_json::to_value(&err).unwrap();
    assert_eq!(json["kind"], "sftp");
    assert!(json["message"].as_str().unwrap().contains("/missing"));
}

// --- S2: temporary copies, edit-and-upload, external programs ---

use super::edit::{self, TempFiles};

#[tokio::test]
async fn edited_copy_is_uploaded_back_to_the_same_remote_path() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("etc")).unwrap();
    std::fs::write(root.path().join("etc/app.conf"), b"old").unwrap();
    let (sftp, _mgr, _dir) = session(root.path()).await;
    let temp = TempFiles::default();

    let local = download_copy(&sftp, &temp, 7, "edit", "/etc/app.conf")
        .await
        .unwrap();
    assert_eq!(local.file_name().unwrap(), "app.conf");
    assert_eq!(std::fs::read(&local).unwrap(), b"old");

    std::fs::write(&local, b"new contents").unwrap();
    upload_file(&sftp, &local, "/etc/app.conf").await.unwrap();
    assert_eq!(
        std::fs::read(root.path().join("etc/app.conf")).unwrap(),
        b"new contents"
    );
}

#[cfg(unix)]
#[test]
fn copies_live_in_a_private_folder_one_subfolder_per_remote_file() {
    use std::os::unix::fs::PermissionsExt;
    let temp = TempFiles::default();
    let a = temp.local_path(1, "edit", "/x/a.txt").unwrap();
    let same = temp.local_path(1, "edit", "/x/a.txt").unwrap();
    let other = temp.local_path(1, "edit", "/y/a.txt").unwrap();
    let compare = temp.local_path(1, "compare", "/x/a.txt").unwrap();
    assert_eq!(a, same);
    assert_ne!(a, other);
    assert_ne!(a, compare);
    assert_eq!(other.file_name().unwrap(), "a.txt");
    let dir = temp.session_dir(1).unwrap();
    assert!(a.starts_with(&dir) && other.starts_with(&dir));
    let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o700);
    assert_eq!(temp.existing(1, "edit", "/x/a.txt"), Some(a));
    assert_eq!(temp.existing(1, "edit", "/z"), None);
}

#[test]
fn removing_a_session_deletes_its_copies() {
    let temp = TempFiles::default();
    let a = temp.local_path(1, "edit", "/a").unwrap();
    std::fs::write(&a, b"x").unwrap();
    let b = temp.local_path(2, "edit", "/b").unwrap();
    let dir = temp.session_dir(1).unwrap();
    temp.remove(1);
    assert!(!dir.exists());
    assert_eq!(temp.existing(1, "edit", "/a"), None);
    assert!(
        b.parent().unwrap().exists(),
        "other sessions keep their copies"
    );
}

#[tokio::test]
async fn the_watcher_reports_each_save_and_stops_with_the_session() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let temp = TempFiles::default();
    let local = temp.local_path(1, "edit", "/a").unwrap();
    std::fs::write(&local, b"v1").unwrap();
    let saves = Arc::new(AtomicUsize::new(0));
    let counter = saves.clone();
    temp.watch(1, "edit", "/a", Duration::from_millis(20), move || {
        counter.fetch_add(1, Ordering::SeqCst);
    });
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(saves.load(Ordering::SeqCst), 0, "no save yet");

    std::fs::write(&local, b"version 2").unwrap();
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert_eq!(saves.load(Ordering::SeqCst), 1);

    temp.remove(1);
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(saves.load(Ordering::SeqCst), 1);
}

#[test]
fn desktop_exec_puts_the_file_in_place_of_its_field_code() {
    let file = Path::new("/tmp/x/a b.txt");
    let args = |exec: &str| -> Vec<String> {
        edit::desktop_exec_args(exec, file)
            .into_iter()
            .map(|a| a.into_string().unwrap())
            .collect()
    };
    assert_eq!(args("gedit %U"), ["gedit", "/tmp/x/a b.txt"]);
    assert_eq!(
        args("flatpak run --branch=stable org.gnome.TextEditor %F --new-window"),
        [
            "flatpak",
            "run",
            "--branch=stable",
            "org.gnome.TextEditor",
            "/tmp/x/a b.txt",
            "--new-window"
        ]
    );
    assert_eq!(
        args("\"/opt/My Editor/edit\" -n"),
        ["/opt/My Editor/edit", "-n", "/tmp/x/a b.txt"]
    );
    assert_eq!(args("kate %i %c -b %u"), ["kate", "-b", "/tmp/x/a b.txt"]);
}

#[test]
fn the_chosen_text_editor_gets_the_file_as_its_own_argument() {
    let file = Path::new("/tmp/x/a b; rm -rf ~.txt");
    let args = |command: &str| -> Option<Vec<String>> {
        edit::chosen_editor_command(command, file)
            .map(|args| args.into_iter().map(|a| a.into_string().unwrap()).collect())
    };
    // Empty: the system default editor.
    assert_eq!(args(""), None);
    assert_eq!(args("   "), None);
    assert_eq!(
        args("kate"),
        Some(vec!["kate".into(), file.display().to_string()])
    );
    assert_eq!(
        args("  code --wait "),
        Some(vec![
            "code".into(),
            "--wait".into(),
            file.display().to_string()
        ])
    );
    assert_eq!(
        args("\"/opt/My Editor/edit\" -n %f --end"),
        Some(vec![
            "/opt/My Editor/edit".into(),
            "-n".into(),
            file.display().to_string(),
            "--end".into()
        ])
    );
    // Shell syntax is only text: no shell ever runs the command.
    assert_eq!(
        args("vim | true"),
        Some(vec![
            "vim".into(),
            "|".into(),
            "true".into(),
            file.display().to_string()
        ])
    );
}

#[test]
fn an_existing_program_path_with_spaces_is_one_program() {
    let dir = tempfile::tempdir().unwrap();
    let program = dir.path().join("My Editor");
    std::fs::write(&program, b"").unwrap();
    let file = Path::new("/tmp/a.txt");
    let args = edit::chosen_editor_command(program.to_str().unwrap(), file).unwrap();
    assert_eq!(args, [program.as_os_str(), file.as_os_str()]);
}

#[test]
fn open_with_text_editor_takes_an_optional_command() {
    use super::commands::OpenWith;
    let plain: OpenWith = serde_json::from_str(r#"{"kind":"textEditor"}"#).unwrap();
    assert!(matches!(plain, OpenWith::TextEditor { command: None }));
    let chosen: OpenWith =
        serde_json::from_str(r#"{"kind":"textEditor","command":"code --wait"}"#).unwrap();
    assert!(matches!(chosen, OpenWith::TextEditor { command: Some(c) } if c == "code --wait"));
}

#[test]
fn desktop_exec_is_read_from_the_desktop_entry_group() {
    let contents =
        "[Desktop Entry]\nName=Ed\nExec=ed --x %f\n\n[Desktop Action new]\nExec=ed --new\n";
    assert_eq!(edit::desktop_exec(contents).as_deref(), Some("ed --x %f"));
    let only_action = "[Desktop Action new]\nExec=ed --new\n";
    assert_eq!(edit::desktop_exec(only_action), None);
}

#[cfg(unix)]
#[test]
fn the_first_installed_diff_tool_wins_in_order() {
    let bin1 = tempfile::tempdir().unwrap();
    let bin2 = tempfile::tempdir().unwrap();
    std::fs::write(bin1.path().join("code"), b"").unwrap();
    std::fs::write(bin2.path().join("kompare"), b"").unwrap();
    let path = std::env::join_paths([bin1.path(), bin2.path()]).unwrap();

    let (program, args) = edit::find_diff_tool(Some(path.clone())).unwrap();
    assert_eq!(program, bin2.path().join("kompare"));
    assert!(args.is_empty());

    std::fs::remove_file(bin2.path().join("kompare")).unwrap();
    let (program, args) = edit::find_diff_tool(Some(path.clone())).unwrap();
    assert_eq!(program, bin1.path().join("code"));
    assert_eq!(args, ["--diff"]);

    std::fs::remove_file(bin1.path().join("code")).unwrap();
    assert!(edit::find_diff_tool(Some(path)).is_none());
    assert!(edit::find_diff_tool(None).is_none());
}

/// A remote name is only data on this machine: it can never place the copy outside the
/// session's private folder, whatever separators or drive letters it contains.
#[test]
fn copy_names_never_leave_the_private_folder() {
    let temp = TempFiles::default();
    for (remote, expected) in [
        ("/srv/..\\..\\evil.bat", ".._.._evil.bat"),
        (
            "/srv/C:\\Users\\x\\Startup\\a.bat",
            "C__Users_x_Startup_a.bat",
        ),
        ("/srv/a<b>c|d?e*f\"g", "a_b_c_d_e_f_g"),
        ("/srv/..", "file"),
        ("/srv/.", "file"),
        ("/srv/x\u{1}y", "x_y"),
    ] {
        let local = temp.local_path(7, "edit", remote).unwrap();
        let dir = temp.session_dir(7).unwrap();
        assert_eq!(local.parent().unwrap().parent().unwrap(), dir, "{remote}");
        assert_eq!(local.file_name().unwrap(), expected, "{remote}");
    }
}
