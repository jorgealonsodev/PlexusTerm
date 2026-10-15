//! SSH shell sessions with OpenSSH-compatible host key verification.
//!
//! Host keys are checked against a `known_hosts` file:
//! - a recorded matching key connects;
//! - a recorded *different* key is always rejected (possible MITM);
//! - an unknown host is rejected with its fingerprint, and the caller may
//!   retry with `trusted_fingerprint` set to that exact value to accept and
//!   record it.

#[cfg(test)]
mod test_server;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::keys::agent::client::AgentClient;
use russh::keys::{
    HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate, known_hosts, load_secret_key,
};
use russh::{ChannelMsg, client};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::terminal::{TerminalSink, Utf8Stream};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub cols: u16,
    pub rows: u16,
    /// Fingerprint (`SHA256:...`) the user accepted for an unknown host.
    pub trusted_fingerprint: Option<String>,
}

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum SshAuth {
    Password {
        password: String,
    },
    Key {
        path: String,
        passphrase: Option<String>,
    },
    Agent,
}

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SshError {
    #[error("the authenticity of host {host} can't be established ({fingerprint})")]
    UnknownHost { host: String, fingerprint: String },
    #[error(
        "the host key for {host} has changed ({fingerprint}); it does not match line {line} of known_hosts"
    )]
    HostKeyChanged {
        host: String,
        fingerprint: String,
        line: usize,
    },
    #[error("authentication failed")]
    AuthFailed,
    #[error("unknown terminal session {id}")]
    UnknownSession { id: u32 },
    #[error("{message}")]
    Connection { message: String },
}

fn connection(err: impl std::fmt::Display) -> SshError {
    SshError::Connection {
        message: err.to_string(),
    }
}

/// Display form used by OpenSSH: `host` for port 22, `[host]:port` otherwise.
fn host_label(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// Applies the known_hosts policy described in the module docs.
fn verify_host_key(
    known_hosts: &Path,
    host: &str,
    port: u16,
    key: &PublicKey,
    trusted_fingerprint: Option<&str>,
) -> Result<(), SshError> {
    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    match known_hosts::check_known_hosts_path(host, port, key, known_hosts) {
        Ok(true) => Ok(()),
        Ok(false) if trusted_fingerprint == Some(fingerprint.as_str()) => {
            known_hosts::learn_known_hosts_path(host, port, key, known_hosts).map_err(connection)
        }
        Ok(false) => Err(SshError::UnknownHost {
            host: host_label(host, port),
            fingerprint,
        }),
        Err(russh::keys::Error::KeyChanged { line }) => Err(SshError::HostKeyChanged {
            host: host_label(host, port),
            fingerprint,
            line,
        }),
        Err(err) => Err(SshError::Connection {
            message: format!("cannot read known_hosts: {err}"),
        }),
    }
}

struct ClientHandler {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    trusted_fingerprint: Option<String>,
    /// Why the host key was rejected; russh only reports a generic error.
    rejection: Arc<Mutex<Option<SshError>>>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let result = match server_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => verify_host_key(
                &self.known_hosts,
                &self.host,
                self.port,
                key,
                self.trusted_fingerprint.as_deref(),
            ),
            PublicKeyOrCertificate::Certificate(_) => Err(SshError::Connection {
                message: "SSH host certificates are not supported yet".into(),
            }),
        };
        match result {
            Ok(()) => Ok(true),
            Err(err) => {
                *self.rejection.lock().unwrap() = Some(err);
                Ok(false)
            }
        }
    }
}

/// Expands a leading `~/` to `$HOME`, as users type key paths like `~/.ssh/id_ed25519`.
fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(path),
    }
}

async fn authenticate(
    handle: &mut client::Handle<ClientHandler>,
    user: &str,
    auth: SshAuth,
) -> Result<(), SshError> {
    let accepted = match auth {
        SshAuth::Password { password } => handle
            .authenticate_password(user, password)
            .await
            .map_err(connection)?
            .success(),
        SshAuth::Key { path, passphrase } => {
            let key =
                load_secret_key(expand_home(&path), passphrase.as_deref()).map_err(|err| {
                    SshError::Connection {
                        message: format!("cannot load private key {path}: {err}"),
                    }
                })?;
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(connection)?
                .flatten();
            handle
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(connection)?
                .success()
        }
        SshAuth::Agent => {
            let mut agent =
                AgentClient::connect_env()
                    .await
                    .map_err(|err| SshError::Connection {
                        message: format!("SSH agent unavailable: {err}"),
                    })?;
            let identities = agent.request_identities().await.map_err(connection)?;
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(connection)?
                .flatten();
            let mut accepted = false;
            for identity in identities {
                let key = identity.public_key().into_owned();
                if handle
                    .authenticate_publickey_with(user, key, hash, &mut agent)
                    .await
                    .map_err(connection)?
                    .success()
                {
                    accepted = true;
                    break;
                }
            }
            accepted
        }
    };
    if accepted {
        Ok(())
    } else {
        Err(SshError::AuthFailed)
    }
}

enum Command {
    Data(Vec<u8>),
    Resize(u16, u16),
    Close,
}

pub struct SshManager {
    known_hosts: PathBuf,
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, UnboundedSender<Command>>>,
}

impl SshManager {
    pub fn new(known_hosts: PathBuf) -> Self {
        Self {
            known_hosts,
            next_id: AtomicU32::new(0),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Uses the current user's `~/.ssh/known_hosts`, like OpenSSH.
    pub fn for_current_user() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        Self::new(home.join(".ssh").join("known_hosts"))
    }

    pub async fn connect(
        &self,
        req: ConnectRequest,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        let rejection = Arc::new(Mutex::new(None));
        let handler = ClientHandler {
            host: req.host.clone(),
            port: req.port,
            known_hosts: self.known_hosts.clone(),
            trusted_fingerprint: req.trusted_fingerprint.clone(),
            rejection: rejection.clone(),
        };
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        });

        let connecting = client::connect(config, (req.host.as_str(), req.port), handler);
        let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, connecting).await {
            Err(_) => {
                return Err(SshError::Connection {
                    message: format!(
                        "connection to {} timed out",
                        host_label(&req.host, req.port)
                    ),
                });
            }
            Ok(Err(err)) => {
                return Err(rejection
                    .lock()
                    .unwrap()
                    .take()
                    .unwrap_or_else(|| connection(err)));
            }
            Ok(Ok(handle)) => handle,
        };

        authenticate(&mut handle, &req.username, req.auth).await?;

        let channel = handle.channel_open_session().await.map_err(connection)?;
        channel
            .request_pty(
                false,
                "xterm-256color",
                req.cols.into(),
                req.rows.into(),
                0,
                0,
                &[],
            )
            .await
            .map_err(connection)?;
        channel.request_shell(false).await.map_err(connection)?;

        let (tx, mut commands) = unbounded_channel();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, tx);

        tokio::spawn(async move {
            let (mut reader, writer) = channel.split();
            let mut decoder = Utf8Stream::default();
            let mut exit_code = None;
            loop {
                tokio::select! {
                    command = commands.recv() => match command {
                        Some(Command::Data(data)) => {
                            if writer.data(&data[..]).await.is_err() {
                                break;
                            }
                        }
                        Some(Command::Resize(cols, rows)) => {
                            let _ = writer.window_change(cols.into(), rows.into(), 0, 0).await;
                        }
                        Some(Command::Close) | None => {
                            let _ = writer.close().await;
                            break;
                        }
                    },
                    message = reader.wait() => match message {
                        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let text = decoder.push(&data);
                            if !text.is_empty() {
                                sink.data(text);
                            }
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                        Some(ChannelMsg::Close) | None => break,
                        Some(_) => {}
                    },
                }
            }
            let _ = handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            sink.exit(exit_code);
        });

        Ok(id)
    }

    fn send(&self, id: u32, command: Command) -> Result<(), SshError> {
        let sessions = self.sessions.lock().unwrap();
        let tx = sessions.get(&id).ok_or(SshError::UnknownSession { id })?;
        tx.send(command).map_err(|_| SshError::Connection {
            message: "the SSH session has ended".into(),
        })
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), SshError> {
        self.send(id, Command::Data(data.to_vec()))
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), SshError> {
        self.send(id, Command::Resize(cols, rows))
    }

    pub fn close(&self, id: u32) -> Result<(), SshError> {
        let tx = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(SshError::UnknownSession { id })?;
        // The session task may already have ended; nothing else to clean up then.
        let _ = tx.send(Command::Close);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::test_server::{self, PASSWORD, key_from_seed};
    use super::*;
    use tokio::sync::mpsc::UnboundedReceiver;

    enum Event {
        Data(String),
        Exit(Option<u32>),
    }

    struct TestSink(UnboundedSender<Event>);

    impl TerminalSink for TestSink {
        fn data(&self, text: String) {
            let _ = self.0.send(Event::Data(text));
        }
        fn exit(&self, code: Option<u32>) {
            let _ = self.0.send(Event::Exit(code));
        }
    }

    fn sink() -> (TestSink, UnboundedReceiver<Event>) {
        let (tx, rx) = unbounded_channel();
        (TestSink(tx), rx)
    }

    /// Collects output until `needle` appears (or, with an empty needle, until exit).
    async fn wait_for(
        rx: &mut UnboundedReceiver<Event>,
        needle: &str,
    ) -> (String, Option<Option<u32>>) {
        let mut out = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
            match event {
                Event::Data(t) => {
                    out.push_str(&t);
                    if !needle.is_empty() && out.contains(needle) {
                        return (out, None);
                    }
                }
                Event::Exit(code) => return (out, Some(code)),
            }
        }
        (out, None)
    }

    fn request(port: u16, auth: SshAuth) -> ConnectRequest {
        ConnectRequest {
            host: "127.0.0.1".into(),
            port,
            username: "tester".into(),
            auth,
            cols: 80,
            rows: 24,
            trusted_fingerprint: None,
        }
    }

    fn password(pw: &str) -> SshAuth {
        SshAuth::Password {
            password: pw.into(),
        }
    }

    fn fingerprint(key: &russh::keys::PublicKey) -> String {
        key.fingerprint(HashAlg::Sha256).to_string()
    }

    /// Manager whose known_hosts already trusts `key` for 127.0.0.1:`port`.
    fn trusting(dir: &tempfile::TempDir, port: u16, key: &russh::keys::PublicKey) -> SshManager {
        let path = dir.path().join("known_hosts");
        russh::keys::known_hosts::learn_known_hosts_path("127.0.0.1", port, key, &path).unwrap();
        SshManager::new(path)
    }

    #[test]
    fn expands_home_in_key_paths() {
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            expand_home("~/.ssh/id"),
            PathBuf::from(home).join(".ssh/id")
        );
        assert_eq!(expand_home("/abs/id"), PathBuf::from("/abs/id"));
        assert_eq!(expand_home("rel~/id"), PathBuf::from("rel~/id"));
    }

    #[tokio::test]
    async fn password_login_opens_an_interactive_shell() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));

        mgr.write(id, b"ping").unwrap();
        let (out, _) = wait_for(&mut rx, "ping").await;
        assert!(out.contains("ping"), "output was {out:?}");
    }

    #[tokio::test]
    async fn wrong_password_is_rejected() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), password("nope")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::AuthFailed), "got {err:?}");
    }

    #[tokio::test]
    async fn private_key_login_works() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join("id_ed25519");
        let pem = client_key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        std::fs::write(&key_path, pem.as_bytes()).unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let auth = SshAuth::Key {
            path: key_path.to_string_lossy().into(),
            passphrase: None,
        };
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[tokio::test]
    async fn unknown_host_is_rejected_with_its_fingerprint_and_not_recorded() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        let mgr = SshManager::new(path.clone());
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap_err();
        match err {
            SshError::UnknownHost {
                fingerprint: fp, ..
            } => {
                assert_eq!(fp, fingerprint(&server.host_key))
            }
            other => panic!("expected UnknownHost, got {other:?}"),
        }
        assert!(
            !path.exists(),
            "known_hosts must not be written without consent"
        );
    }

    #[tokio::test]
    async fn trusting_the_fingerprint_connects_and_records_the_host() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        let port = server.addr.port();

        let mut req = request(port, password(PASSWORD));
        req.trusted_fingerprint = Some(fingerprint(&server.host_key));
        let (s, _rx) = sink();
        mgr.connect(req, s).await.unwrap();

        // Second connection needs no confirmation.
        let (s, mut rx) = sink();
        mgr.connect(request(port, password(PASSWORD)), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[tokio::test]
    async fn trusting_a_different_fingerprint_is_still_rejected() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));

        let mut req = request(server.addr.port(), password(PASSWORD));
        req.trusted_fingerprint = Some("SHA256:not-the-real-one".into());
        let (s, _rx) = sink();
        let err = mgr.connect(req, s).await.unwrap_err();
        assert!(matches!(err, SshError::UnknownHost { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn changed_host_key_is_rejected_even_when_trusted() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let old_key = key_from_seed(2).public_key().clone();
        let mgr = trusting(&dir, server.addr.port(), &old_key);

        let mut req = request(server.addr.port(), password(PASSWORD));
        req.trusted_fingerprint = Some(fingerprint(&server.host_key));
        let (s, _rx) = sink();
        let err = mgr.connect(req, s).await.unwrap_err();
        assert!(
            matches!(err, SshError::HostKeyChanged { .. }),
            "got {err:?}"
        );
    }

    #[tokio::test]
    async fn requests_the_initial_size_and_forwards_resizes() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.write(id, b"size?").unwrap();
        assert!(
            wait_for(&mut rx, "size=80x24")
                .await
                .0
                .contains("size=80x24")
        );

        mgr.resize(id, 120, 40).unwrap();
        mgr.write(id, b"size?").unwrap();
        let (out, _) = wait_for(&mut rx, "size=120x40").await;
        assert!(out.contains("size=120x40"), "output was {out:?}");
    }

    #[tokio::test]
    async fn remote_exit_reports_the_exit_status() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.write(id, b"exit").unwrap();
        let (_, exit) = wait_for(&mut rx, "").await;
        assert_eq!(exit, Some(Some(7)));
    }

    #[tokio::test]
    async fn close_ends_the_session_and_forgets_it() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.close(id).unwrap();
        let (_, exit) = wait_for(&mut rx, "").await;
        assert!(exit.is_some(), "session did not end after close");
        assert!(matches!(
            mgr.write(id, b"x"),
            Err(SshError::UnknownSession { .. })
        ));
        assert!(matches!(
            mgr.resize(99, 1, 1),
            Err(SshError::UnknownSession { id: 99 })
        ));
    }

    #[tokio::test]
    async fn unreachable_host_is_a_connection_error() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        // Bind and drop to get a port with nothing listening.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let (s, _rx) = sink();
        let err = mgr
            .connect(request(port, password(PASSWORD)), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::Connection { .. }), "got {err:?}");
    }
}
