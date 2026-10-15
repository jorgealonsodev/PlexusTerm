//! Mosh tests: the in-process SSH server fakes `mosh-server` (see its exec handling) and a
//! fake `mosh-client` script records its arguments and environment.

use super::*;
use crate::ssh::SshAuth;
use crate::ssh::test_server::{self, MOSH_CONNECT_REPLY, PASSWORD, TestServer};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

const KEY: &str = "AAAAAAAAAAAAAAAAAAAAAA";

enum Event {
    Data(String),
    Exit,
}

struct TestSink(UnboundedSender<Event>);

impl TerminalSink for TestSink {
    fn data(&self, text: String) {
        let _ = self.0.send(Event::Data(text));
    }
    fn exit(&self, _code: Option<u32>) {
        let _ = self.0.send(Event::Exit);
    }
}

fn sink() -> (TestSink, UnboundedReceiver<Event>) {
    let (tx, rx) = unbounded_channel();
    (TestSink(tx), rx)
}

/// Every output until the session exits (5 s at most).
async fn output_until_exit(rx: &mut UnboundedReceiver<Event>) -> String {
    let mut out = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        match event {
            Event::Data(t) => out.push_str(&t),
            Event::Exit => return out,
        }
    }
    panic!("mosh-client never exited; output so far {out:?}");
}

fn password() -> SshAuth {
    SshAuth::Password {
        password: PASSWORD.into(),
    }
}

/// known_hosts trusting every server in `servers`.
fn trusting(dir: &tempfile::TempDir, servers: &[&TestServer]) -> SshManager {
    let path = dir.path().join("known_hosts");
    for server in servers {
        russh::keys::known_hosts::learn_known_hosts_path(
            "127.0.0.1",
            server.addr.port(),
            &server.host_key,
            &path,
        )
        .unwrap();
    }
    SshManager::new(path)
}

fn request(server: &TestServer, server_command: Option<&str>) -> MoshRequest {
    let json = serde_json::json!({
        "host": "127.0.0.1",
        "port": server.addr.port(),
        "username": "tester",
        "auth": { "method": "password", "password": PASSWORD },
        "cols": 80,
        "rows": 24,
        "serverCommand": server_command,
    });
    serde_json::from_value(json).unwrap()
}

/// A directory holding a fake `mosh-client` that writes its arguments to `argv` and
/// `MOSH_KEY` (or `<unset>`) to `key` in the same directory, then prints "client ran".
fn fake_client() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().display();
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{out}/argv'\nprintf '%s' \"${{MOSH_KEY-<unset>}}\" > '{out}/key'\necho client ran\n"
    );
    let path = dir.path().join("mosh-client");
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir
}

fn launcher(client: &tempfile::TempDir) -> MoshLauncher {
    MoshLauncher::default().with_search_path(client.path())
}

fn error_message(err: SshError) -> String {
    err.to_string()
}

#[test]
fn a_missing_client_is_explained_per_platform() {
    assert_eq!(
        client_missing(Os::Unix),
        "mosh-client not found — install mosh"
    );
    assert_eq!(
        client_missing(Os::Windows),
        "Mosh is not available on Windows"
    );
}

#[test]
fn parses_the_mosh_connect_line() {
    let connect = parse_connect(MOSH_CONNECT_REPLY).unwrap();
    assert_eq!(connect.port, 60001);
    assert_eq!(connect.key, KEY);
}

#[test]
fn rejects_malformed_mosh_connect_lines() {
    for output in [
        "",
        "MOSH CONNECT\r\n",
        "MOSH CONNECT 60001\r\n",
        "MOSH CONNECT 0 AAAAAAAAAAAAAAAAAAAAAA\r\n",
        "MOSH CONNECT 70000 AAAAAAAAAAAAAAAAAAAAAA\r\n",
        "MOSH CONNECT 60001 short\r\n",
        "MOSH CONNECT 60001 AAAAAAAAAAAAAAAAAAAA;A\r\n",
    ] {
        assert!(parse_connect(output).is_none(), "{output:?}");
    }
}

#[test]
fn debug_never_shows_the_key() {
    let debug = format!("{:?}", parse_connect(MOSH_CONNECT_REPLY).unwrap());
    assert!(!debug.contains(KEY), "{debug}");
}

#[test]
fn requests_deserialize_from_camel_case() {
    let json = r#"{ "host": "h", "username": "u", "auth": { "method": "agent" },
        "cols": 80, "rows": 24, "trustedFingerprint": null, "serverCommand": "mosh-server new" }"#;
    let req: MoshRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.login.port, 22);
    assert_eq!(req.server_command.as_deref(), Some("mosh-server new"));
    let debug = format!("{req:?}");
    assert!(debug.contains("Agent"), "{debug}");
}

#[tokio::test]
async fn mosh_client_gets_the_key_by_environment_only() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let ptys = PtyManager::default();
    let (s, mut rx) = sink();

    launcher(&client)
        .connect(&ssh, &ptys, request(&server, None), None, s)
        .await
        .unwrap();
    let out = output_until_exit(&mut rx).await;

    assert!(out.contains("client ran"), "output was {out:?}");
    assert!(!out.contains(KEY), "the key reached the terminal: {out:?}");
    let argv = std::fs::read_to_string(client.path().join("argv")).unwrap();
    assert_eq!(argv, "127.0.0.1\n60001\n");
    assert_eq!(
        std::fs::read_to_string(client.path().join("key")).unwrap(),
        KEY
    );
    assert_eq!(server.exec_commands(), vec![DEFAULT_SERVER_COMMAND]);
}

#[tokio::test]
async fn the_ssh_connection_is_closed_once_the_server_started() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, mut rx) = sink();
    let ptys = PtyManager::default();

    launcher(&client)
        .connect(&ssh, &ptys, request(&server, None), None, s)
        .await
        .unwrap();
    output_until_exit(&mut rx).await;
    assert_eq!(wait_connections(&server, 0).await, 0);
}

#[tokio::test]
async fn a_custom_server_command_is_run() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, mut rx) = sink();
    let ptys = PtyManager::default();
    let command = "mosh-server new -p 60001";

    launcher(&client)
        .connect(&ssh, &ptys, request(&server, Some(command)), None, s)
        .await
        .unwrap();
    output_until_exit(&mut rx).await;
    assert_eq!(server.exec_commands(), vec![command]);
}

#[tokio::test]
async fn a_missing_mosh_client_fails_before_logging_in() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let empty = tempfile::tempdir().unwrap();
    let (s, _rx) = sink();
    let ptys = PtyManager::default();

    let err = MoshLauncher::default()
        .with_search_path(empty.path())
        .connect(&ssh, &ptys, request(&server, None), None, s)
        .await
        .unwrap_err();
    assert_eq!(error_message(err), "mosh-client not found — install mosh");
    assert_eq!(server.password_attempts(), 0);
}

#[tokio::test]
async fn a_missing_mosh_server_is_a_clear_error() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, _rx) = sink();
    let ptys = PtyManager::default();

    let err = launcher(&client)
        .connect(
            &ssh,
            &ptys,
            request(&server, Some("no-such-mosh-server new")),
            None,
            s,
        )
        .await
        .unwrap_err();
    assert_eq!(
        error_message(err),
        "mosh-server not found on the server — install mosh there"
    );
    assert!(!client.path().join("argv").exists(), "mosh-client ran");
}

#[tokio::test]
async fn a_server_command_without_mosh_connect_is_an_error() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, _rx) = sink();
    let ptys = PtyManager::default();

    let err = launcher(&client)
        .connect(&ssh, &ptys, request(&server, Some("true")), None, s)
        .await
        .unwrap_err();
    assert_eq!(
        error_message(err),
        "mosh-server did not start (exit status 0)"
    );
}

#[tokio::test]
async fn a_server_that_never_answers_times_out() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, _rx) = sink();
    let ptys = PtyManager::default();

    let err = launcher(&client)
        .with_server_timeout(Duration::from_millis(300))
        .connect(
            &ssh,
            &ptys,
            request(&server, Some("sleep-forever")),
            None,
            s,
        )
        .await
        .unwrap_err();
    assert!(
        error_message(err).starts_with("mosh-server did not answer within"),
        "unexpected error"
    );
    assert_eq!(wait_connections(&server, 0).await, 0);
}

#[tokio::test]
async fn ssh_login_errors_are_returned_as_is() {
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&server]);
    let client = fake_client();
    let (s, _rx) = sink();
    let ptys = PtyManager::default();
    let mut req = request(&server, None);
    req.login.auth = SshAuth::Password {
        password: "wrong".into(),
    };

    let err = launcher(&client)
        .connect(&ssh, &ptys, req, None, s)
        .await
        .unwrap_err();
    assert!(matches!(err, SshError::AuthFailed), "{err:?}");
}

#[tokio::test]
async fn the_server_is_started_through_jump_hosts() {
    let bastion = test_server::start(2, None).await;
    let server = test_server::start(1, None).await;
    let dir = tempfile::tempdir().unwrap();
    let ssh = trusting(&dir, &[&bastion, &server]);
    let client = fake_client();
    let (s, mut rx) = sink();
    let ptys = PtyManager::default();
    let mut req = request(&server, None);
    req.login.jumps = vec![crate::ssh::JumpHost {
        name: "bastion".into(),
        host: "127.0.0.1".into(),
        port: bastion.addr.port(),
        username: "tester".into(),
        auth: password(),
        trusted_fingerprint: None,
        storage: None,
    }];

    launcher(&client)
        .connect(&ssh, &ptys, req, None, s)
        .await
        .unwrap();
    output_until_exit(&mut rx).await;
    assert_eq!(bastion.password_attempts(), 1);
    assert_eq!(server.exec_commands(), vec![DEFAULT_SERVER_COMMAND]);
    assert!(bastion.exec_commands().is_empty());
    assert_eq!(wait_connections(&bastion, 0).await, 0);
    assert_eq!(wait_connections(&server, 0).await, 0);
}

/// Polls until `server` has `expected` open connections (5 s at most).
async fn wait_connections(server: &TestServer, expected: usize) -> usize {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while server.open_connections() != expected && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    server.open_connections()
}

#[test]
fn a_mangled_connect_line_never_echoes_the_key() {
    let key = "AbCdEfGhIjKlMnOpQrStUv";
    let message = server_failed(&format!("MOSH  CONNECT 60001 {key}\n"), Some(1)).to_string();
    assert!(!message.contains(key), "{message}");
}
