//! SSH shell sessions with OpenSSH-compatible host key verification.
//!
//! Host keys are checked against a `known_hosts` file:
//! - a recorded matching key connects;
//! - a recorded *different* key is always rejected (possible MITM);
//! - an unknown host is rejected with its fingerprint, and the caller may
//!   retry with `trusted_fingerprint` set to that exact value to accept and
//!   record it.

#[cfg(test)]
mod interop_tests;
#[cfg(test)]
pub(crate) mod test_server;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::ChannelOpenHandle;
use russh::keys::agent::client::AgentClient;
use russh::keys::{
    HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate, known_hosts, load_secret_key,
};
use russh::{Channel, ChannelMsg, ChannelOpenFailure, client};
use russh_sftp::client::SftpSession;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::secrets::{self, NoStore, SharedSecrets};
use crate::sftp::SftpError;
use crate::terminal::{TerminalSink, Utf8Stream};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// How long saving or forgetting a password may take after a login. A locked
/// keyring can wait for an unlock dialog indefinitely; the connection must not.
pub(crate) const STORAGE_TIMEOUT: Duration = Duration::from_secs(10);

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

#[derive(Clone, serde::Deserialize)]
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
    /// The password saved in the system keyring for this saved session.
    #[serde(rename_all = "camelCase")]
    StoredPassword {
        session_id: String,
    },
}

/// What to do with the saved password of a session once a login succeeded.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PasswordStorage {
    /// Save the typed password (`SshAuth::Password`) in the keyring.
    Remember { session_id: String, label: String },
    /// Delete the saved password.
    Forget { session_id: String },
}

/// Hand-written so secrets never reach logs or panic messages.
impl std::fmt::Debug for SshAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password { .. } => f.write_str("Password { .. }"),
            Self::Key { path, passphrase } => f
                .debug_struct("Key")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .finish(),
            Self::Agent => f.write_str("Agent"),
            Self::StoredPassword { session_id } => f
                .debug_struct("StoredPassword")
                .field("session_id", session_id)
                .finish(),
        }
    }
}

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SshError {
    #[error("the authenticity of host {host} can't be established ({fingerprint})")]
    #[serde(rename_all = "camelCase")]
    UnknownHost {
        host: String,
        fingerprint: String,
        /// Algorithms of keys already recorded for this host (e.g. after a server key-type change).
        other_known_keys: Vec<String>,
    },
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
    #[error("no password is saved for this session")]
    SecretMissing,
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
        Ok(false) => {
            let mut other_known_keys: Vec<String> =
                known_hosts::known_host_keys_path(host, port, known_hosts)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(_, key)| key.algorithm().to_string())
                    .collect();
            other_known_keys.dedup();
            Err(SshError::UnknownHost {
                host: host_label(host, port),
                fingerprint,
                other_known_keys,
            })
        }
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

/// A `forwarded-tcpip` channel opened by the server for a remote port forward.
pub(crate) type ForwardedChannel = Channel<client::Msg>;

pub(crate) struct ClientHandler {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    trusted_fingerprint: Option<String>,
    /// Why the host key was rejected; russh only reports a generic error.
    rejection: Arc<Mutex<Option<SshError>>>,
    /// Receives the server's `forwarded-tcpip` channels; without it they are refused.
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
}

/// An authenticated SSH connection.
pub(crate) type Connection = client::Handle<ClientHandler>;

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

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // One connection per tunnel, so every forwarded channel belongs to it.
        match &self.forwarded {
            Some(tx) if tx.send(channel).is_ok() => reply.accept().await,
            _ => {
                reply
                    .reject(ChannelOpenFailure::AdministrativelyProhibited)
                    .await
            }
        }
        Ok(())
    }
}

/// Expands a leading `~/` to `$HOME`, as users type key paths like `~/.ssh/id_ed25519`.
fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        _ => PathBuf::from(path),
    }
}

/// Where and as whom to connect.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTarget {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

/// How [`connect_authenticated`] reaches the server and the saved passwords.
pub(crate) struct ConnectContext<'a> {
    pub known_hosts: &'a Path,
    pub agent_socket: Option<&'a Path>,
    pub secrets: &'a SharedSecrets,
    /// Bound on the keyring update after the login (see [`STORAGE_TIMEOUT`]).
    pub storage_timeout: Duration,
}

/// `user@host:port` a saved password belongs to, normalized the same way when
/// it is saved and when it is used.
fn endpoint(username: &str, host: &str, port: u16) -> String {
    format!("{}@{}:{port}", username.trim(), host.trim())
}

const SAVED_PASSWORD_VERSION: u32 = 1;

/// Keyring value of a saved password: the password bound to the endpoint it was
/// typed for, so it is never sent anywhere else (e.g. after the session was edited).
/// Deliberately not `Debug`.
#[derive(serde::Serialize, serde::Deserialize)]
struct SavedPassword {
    v: u32,
    endpoint: String,
    password: String,
}

impl SavedPassword {
    fn encode(endpoint: String, password: String) -> String {
        serde_json::to_string(&Self {
            v: SAVED_PASSWORD_VERSION,
            endpoint,
            password,
        })
        .expect("a struct of strings always serializes")
    }

    /// The password when `value` was saved for `endpoint`. Values saved for another
    /// endpoint, in another format or as plain text (older builds) yield `None`.
    fn password_for(value: &str, endpoint: &str) -> Option<String> {
        let saved: Self = serde_json::from_str(value).ok()?;
        (saved.v == SAVED_PASSWORD_VERSION && saved.endpoint == endpoint).then_some(saved.password)
    }
}

/// Connects, applies the known_hosts policy and authenticates, then applies
/// `storage` to the saved password. Nothing is stored or deleted on failure.
///
/// Also returns a user-facing warning when the keyring could not be updated;
/// that never fails the login.
pub(crate) async fn connect_authenticated(
    target: SshTarget,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    ctx: ConnectContext<'_>,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
) -> Result<(Connection, Option<String>), SshError> {
    let ConnectContext {
        known_hosts,
        agent_socket,
        secrets,
        storage_timeout,
    } = ctx;
    let rejection = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        host: target.host.clone(),
        port: target.port,
        known_hosts: known_hosts.to_path_buf(),
        trusted_fingerprint,
        rejection: rejection.clone(),
        forwarded,
    };
    let config = Arc::new(client::Config {
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    });

    let connecting = client::connect(config, (target.host.as_str(), target.port), handler);
    let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, connecting).await {
        Err(_) => {
            return Err(SshError::Connection {
                message: format!(
                    "connection to {} timed out",
                    host_label(&target.host, target.port)
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

    let typed_password = match &target.auth {
        SshAuth::Password { password } => Some(password.clone()),
        _ => None,
    };
    let endpoint = endpoint(&target.username, &target.host, target.port);
    authenticate(
        &mut handle,
        &target.username,
        target.auth,
        agent_socket,
        secrets,
        &endpoint,
    )
    .await?;
    let warning = apply_storage(secrets, storage, typed_password, endpoint, storage_timeout).await;
    Ok((handle, warning))
}

/// Saves or forgets the session's password after a successful login. A keyring
/// failure does not fail the login: it becomes the returned warning, which never
/// contains the password.
async fn apply_storage(
    secrets: &SharedSecrets,
    storage: Option<PasswordStorage>,
    typed_password: Option<String>,
    endpoint: String,
    timeout: Duration,
) -> Option<String> {
    let (failure, result) = match (storage, typed_password) {
        (Some(PasswordStorage::Remember { session_id, label }), Some(password)) => {
            let value = SavedPassword::encode(endpoint, password);
            let update = secrets::run(secrets, move |s| s.set(&session_id, &label, &value));
            (
                "The password could not be saved in the system keyring",
                bounded(timeout, update).await,
            )
        }
        (Some(PasswordStorage::Forget { session_id }), _) => {
            let update = secrets::run(secrets, move |s| s.delete(&session_id));
            (
                "The saved password could not be removed from the system keyring",
                bounded(timeout, update).await,
            )
        }
        _ => return None,
    };
    result.err().map(|reason| format!("{failure}: {reason}"))
}

/// Runs a keyring update for at most `timeout`; the error is a reason for the user.
async fn bounded(
    timeout: Duration,
    update: impl std::future::Future<Output = Result<(), secrets::SecretError>>,
) -> Result<(), String> {
    // On timeout the blocking keyring call keeps running in the background and may
    // still complete once the keyring is unlocked; the connection goes on regardless.
    match tokio::time::timeout(timeout, update).await {
        Ok(result) => result.map_err(|err| err.to_string()),
        Err(_) => Err("the system keyring did not respond in time (it may be locked)".into()),
    }
}

async fn authenticate(
    handle: &mut Connection,
    user: &str,
    auth: SshAuth,
    agent_socket: Option<&Path>,
    secrets: &SharedSecrets,
    endpoint: &str,
) -> Result<(), SshError> {
    let accepted = match auth {
        SshAuth::Password { password } => handle
            .authenticate_password(user, password)
            .await
            .map_err(connection)?
            .success(),
        SshAuth::StoredPassword { session_id } => {
            // An unreadable keyring, or a secret saved for another endpoint (the session was
            // edited) or in an older format, is treated like a missing secret: the user is
            // asked instead and the secret is never sent.
            let password = secrets::run(secrets, move |s| s.get(&session_id))
                .await
                .ok()
                .flatten()
                .and_then(|value| SavedPassword::password_for(&value, endpoint))
                .ok_or(SshError::SecretMissing)?;
            handle
                .authenticate_password(user, password)
                .await
                .map_err(connection)?
                .success()
        }
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
            let agent = match agent_socket {
                Some(socket) => AgentClient::connect_uds(socket).await,
                None => AgentClient::connect_env().await,
            };
            let mut agent = agent.map_err(|err| SshError::Connection {
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
                // One identity failing to sign (e.g. a removed hardware key) must not stop the others.
                if let Ok(result) = handle
                    .authenticate_publickey_with(user, key, hash, &mut agent)
                    .await
                    && result.success()
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

/// The SFTP subsystem of a session, opened on first use.
type SftpSlot = Arc<tokio::sync::Mutex<Option<Arc<SftpSession>>>>;

struct SessionEntry {
    tx: UnboundedSender<Command>,
    handle: Arc<Connection>,
    sftp: SftpSlot,
}

pub struct SshManager {
    known_hosts: PathBuf,
    /// Overrides `SSH_AUTH_SOCK` (used by tests).
    agent_socket: Option<PathBuf>,
    secrets: SharedSecrets,
    storage_timeout: Duration,
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, SessionEntry>>,
}

impl SshManager {
    pub fn new(known_hosts: PathBuf) -> Self {
        Self {
            known_hosts,
            agent_socket: None,
            secrets: Arc::new(NoStore),
            storage_timeout: STORAGE_TIMEOUT,
            next_id: AtomicU32::new(0),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    /// Uses `secrets` for stored passwords (none are available otherwise).
    pub fn with_secrets(mut self, secrets: SharedSecrets) -> Self {
        self.secrets = secrets;
        self
    }

    #[cfg(test)]
    fn with_storage_timeout(mut self, timeout: Duration) -> Self {
        self.storage_timeout = timeout;
        self
    }

    #[cfg(test)]
    fn with_agent_socket(mut self, socket: PathBuf) -> Self {
        self.agent_socket = Some(socket);
        self
    }

    /// Uses the current user's `~/.ssh/known_hosts`, like OpenSSH.
    pub fn for_current_user() -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        Self::new(home.join(".ssh").join("known_hosts"))
    }

    /// Connects without touching saved passwords (tests; the app uses `connect_with`).
    #[cfg(test)]
    pub async fn connect(
        &self,
        req: ConnectRequest,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        self.connect_with(req, None, sink).await
    }

    /// Opens an interactive shell, then saves or forgets the session's
    /// password as `storage` asks once the login succeeded.
    pub async fn connect_with(
        &self,
        req: ConnectRequest,
        storage: Option<PasswordStorage>,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        let target = SshTarget {
            host: req.host,
            port: req.port,
            username: req.username,
            auth: req.auth,
        };
        let ctx = ConnectContext {
            known_hosts: &self.known_hosts,
            agent_socket: self.agent_socket.as_deref(),
            secrets: &self.secrets,
            storage_timeout: self.storage_timeout,
        };
        let (handle, warning) =
            connect_authenticated(target, req.trusted_fingerprint, storage, ctx, None).await?;

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
        // Shown before any remote output, which only the reader task below forwards.
        if let Some(warning) = warning {
            sink.data(format!("\r\n\x1b[33m{warning}\x1b[0m\r\n"));
        }

        let (tx, mut commands) = unbounded_channel();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (mut reader, writer) = channel.split();
        let handle = Arc::new(handle);
        self.sessions.lock().unwrap().insert(
            id,
            SessionEntry {
                tx,
                handle: handle.clone(),
                sftp: SftpSlot::default(),
            },
        );

        // Writes run in their own task: a large paste can wait for the remote
        // window while the reader keeps draining output (otherwise both stall).
        let writer_handle = handle.clone();
        tokio::spawn(async move {
            while let Some(command) = commands.recv().await {
                match command {
                    Command::Data(data) => {
                        if writer.data(&data[..]).await.is_err() {
                            break;
                        }
                    }
                    Command::Resize(cols, rows) => {
                        let _ = writer.window_change(cols.into(), rows.into(), 0, 0).await;
                    }
                    Command::Close => break,
                }
            }
            // Closed by the user (or the manager was dropped): end the whole connection,
            // which also ends the reader below.
            let _ = writer.close().await;
            let _ = writer_handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
        });

        tokio::spawn(async move {
            let mut decoder = Utf8Stream::default();
            let mut exit_code = None;
            while let Some(message) = reader.wait().await {
                match message {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        let text = decoder.push(&data);
                        if !text.is_empty() {
                            sink.data(text);
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                    ChannelMsg::Close => break,
                    _ => {}
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
        let entry = sessions.get(&id).ok_or(SshError::UnknownSession { id })?;
        entry.tx.send(command).map_err(|_| SshError::Connection {
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
        let entry = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(SshError::UnknownSession { id })?;
        // The session task may already have ended; nothing else to clean up then.
        let _ = entry.tx.send(Command::Close);
        Ok(())
    }

    /// Returns the SFTP subsystem of session `id`, opening it over the same
    /// SSH connection on first use.
    pub async fn sftp(&self, id: u32) -> Result<Arc<SftpSession>, SftpError> {
        let (handle, slot) = {
            let sessions = self.sessions.lock().unwrap();
            let entry = sessions.get(&id).ok_or(SshError::UnknownSession { id })?;
            (entry.handle.clone(), entry.sftp.clone())
        };
        // Held across the open so concurrent callers share a single channel.
        let mut slot = slot.lock().await;
        if let Some(sftp) = slot.as_ref() {
            return Ok(sftp.clone());
        }
        let unavailable = |err: &dyn std::fmt::Display| SftpError::Sftp {
            message: format!("cannot start SFTP: {err}"),
        };
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|err| unavailable(&err))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| unavailable(&err))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map(Arc::new)
            .map_err(|err| unavailable(&err))?;
        *slot = Some(sftp.clone());
        Ok(sftp)
    }
}

#[cfg(test)]
mod tests {
    use super::test_server::{self, PASSWORD, key_from_seed};
    use super::*;
    use crate::secrets::{MemoryStore, SecretStore};
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
                fingerprint: fp,
                other_known_keys,
                ..
            } => {
                assert_eq!(fp, fingerprint(&server.host_key));
                assert!(other_known_keys.is_empty());
            }
            other => panic!("expected UnknownHost, got {other:?}"),
        }
        assert!(
            !path.exists(),
            "known_hosts must not be written without consent"
        );
    }

    const ECDSA_HOST_KEY: &str = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBLcc4aYgvq7F2Wz+WMIijfkYv83TLq6CCChf7Y/3RbrZLPu+it5GkrceW7eoKv62EINLq6qDsX34FW/ldLgLE1M=";

    #[tokio::test]
    async fn unknown_key_type_reports_the_key_types_already_known_for_the_host() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("known_hosts");
        let port = server.addr.port();
        std::fs::write(&path, format!("[127.0.0.1]:{port} {ECDSA_HOST_KEY}\n")).unwrap();
        let mgr = SshManager::new(path);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(port, password(PASSWORD)), s)
            .await
            .unwrap_err();
        match err {
            SshError::UnknownHost {
                other_known_keys, ..
            } => {
                assert_eq!(other_known_keys, vec!["ecdsa-sha2-nistp256".to_string()])
            }
            other => panic!("expected UnknownHost, got {other:?}"),
        }
    }

    #[test]
    fn unknown_host_error_serializes_with_camel_case_fields() {
        let err = SshError::UnknownHost {
            host: "h".into(),
            fingerprint: "SHA256:x".into(),
            other_known_keys: vec!["ssh-rsa".into()],
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"kind": "unknownHost", "host": "h", "fingerprint": "SHA256:x", "otherKnownKeys": ["ssh-rsa"]})
        );
    }

    #[test]
    fn debug_output_never_contains_secrets() {
        let pw = SshAuth::Password {
            password: "hunter2".into(),
        };
        assert!(!format!("{pw:?}").contains("hunter2"));
        let key = SshAuth::Key {
            path: "/k".into(),
            passphrase: Some("s3cr3t".into()),
        };
        let dbg = format!("{key:?}");
        assert!(!dbg.contains("s3cr3t") && dbg.contains("/k"), "{dbg}");
        assert!(!format!("{:?}", request(22, pw)).contains("hunter2"));
    }

    #[tokio::test]
    async fn large_paste_is_fully_echoed_without_stalling() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();
        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();

        let size = 4 * 1024 * 1024;
        mgr.write(id, &vec![b'a'; size]).unwrap();
        let mut echoed = 0;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while echoed < size {
            match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(Event::Data(t))) => echoed += t.bytes().filter(|b| *b == b'a').count(),
                Ok(Some(Event::Exit(_))) | Ok(None) => panic!("session ended after {echoed} bytes"),
                Err(_) => panic!("stalled after echoing {echoed} of {size} bytes"),
            }
        }
    }

    #[tokio::test]
    async fn agent_login_uses_the_agent_identities() {
        if std::process::Command::new("ssh-agent")
            .arg("-h")
            .output()
            .is_err()
        {
            eprintln!("skipping: ssh-agent not installed");
            return;
        }
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("agent.sock");
        let mut agent = std::process::Command::new("ssh-agent")
            .args(["-D", "-a"])
            .arg(&socket)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        for _ in 0..50 {
            if socket.exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let key_path = dir.path().join("id_ed25519");
        let pem = client_key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        std::fs::write(&key_path, pem.as_bytes()).unwrap();
        std::fs::set_permissions(
            &key_path,
            std::os::unix::fs::PermissionsExt::from_mode(0o600),
        )
        .unwrap();
        let added = std::process::Command::new("ssh-add")
            .arg(&key_path)
            .env("SSH_AUTH_SOCK", &socket)
            .output()
            .unwrap();
        assert!(added.status.success(), "ssh-add failed: {added:?}");

        let mgr = trusting(&dir, server.addr.port(), &server.host_key).with_agent_socket(socket);
        let (s, mut rx) = sink();
        let result = mgr
            .connect(request(server.addr.port(), SshAuth::Agent), s)
            .await;
        let _ = agent.kill();
        let _ = agent.wait();
        result.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
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

    /// Manager trusting the test server whose keyring is `store`.
    fn with_store(
        dir: &tempfile::TempDir,
        server: &test_server::TestServer,
        store: &Arc<MemoryStore>,
    ) -> SshManager {
        trusting(dir, server.addr.port(), &server.host_key).with_secrets(store.clone())
    }

    fn stored(session_id: &str) -> SshAuth {
        SshAuth::StoredPassword {
            session_id: session_id.into(),
        }
    }

    /// Keyring value binding `password` to `endpoint` (`user@host:port`), as `remember` writes it.
    fn bound_secret(endpoint: &str, password: &str) -> String {
        serde_json::json!({"v": 1, "endpoint": endpoint, "password": password}).to_string()
    }

    /// Keyring value for the test user on the test server at `port`.
    fn secret_for(port: u16, password: &str) -> String {
        bound_secret(&format!("tester@127.0.0.1:{port}"), password)
    }

    fn remember(session_id: &str) -> Option<PasswordStorage> {
        Some(PasswordStorage::Remember {
            session_id: session_id.into(),
            label: "NexusTerm: tester@127.0.0.1:22".into(),
        })
    }

    #[tokio::test]
    async fn stored_password_login_reads_the_secret_from_the_store() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        store
            .set("s1", "label", &secret_for(server.addr.port(), PASSWORD))
            .unwrap();
        let mgr = with_store(&dir, &server, &store);
        let (s, mut rx) = sink();

        mgr.connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 1);
    }

    /// Stores `value(server port)` for "s1", connects with it and expects it to be
    /// treated as missing without any password reaching the server.
    async fn assert_secret_not_sent(value: impl Fn(u16) -> String) {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        store
            .set("s1", "label", &value(server.addr.port()))
            .unwrap();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::SecretMissing), "got {err:?}");
        assert_eq!(server.password_attempts(), 0, "the secret was sent");
    }

    #[tokio::test]
    async fn a_secret_stored_for_another_port_is_never_sent() {
        assert_secret_not_sent(|port| {
            bound_secret(&format!("tester@127.0.0.1:{}", port + 1), PASSWORD)
        })
        .await;
    }

    #[tokio::test]
    async fn a_secret_stored_for_another_user_is_never_sent() {
        assert_secret_not_sent(|port| bound_secret(&format!("root@127.0.0.1:{port}"), PASSWORD))
            .await;
    }

    #[tokio::test]
    async fn a_secret_stored_for_another_host_is_never_sent() {
        assert_secret_not_sent(|port| bound_secret(&format!("tester@10.0.0.1:{port}"), PASSWORD))
            .await;
    }

    #[tokio::test]
    async fn a_legacy_plain_text_secret_is_never_sent() {
        assert_secret_not_sent(|_| PASSWORD.to_string()).await;
    }

    #[tokio::test]
    async fn an_unsupported_secret_format_is_never_sent() {
        assert_secret_not_sent(|port| {
            serde_json::json!({"v": 2, "endpoint": format!("tester@127.0.0.1:{port}"), "password": PASSWORD})
                .to_string()
        })
        .await;
    }

    #[test]
    fn endpoints_are_normalized() {
        assert_eq!(
            endpoint(" tester ", " 127.0.0.1 ", 2222),
            "tester@127.0.0.1:2222"
        );
    }

    #[tokio::test]
    async fn stored_password_without_a_secret_is_secret_missing() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::SecretMissing), "got {err:?}");
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({"kind": "secretMissing"})
        );
    }

    #[tokio::test]
    async fn a_wrong_stored_password_is_auth_failed_and_the_secret_is_kept() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let old = secret_for(server.addr.port(), "old-password");
        store.set("s1", "label", &old).unwrap();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::AuthFailed), "got {err:?}");
        assert_eq!(store.get("s1").unwrap(), Some(old));
    }

    #[tokio::test]
    async fn remember_stores_the_typed_password_after_a_successful_login() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        store.set("s1", "label", "old-password").unwrap();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        mgr.connect_with(
            request(server.addr.port(), password(PASSWORD)),
            remember("s1"),
            s,
        )
        .await
        .unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&store.get("s1").unwrap().unwrap()).unwrap();
        assert_eq!(
            saved,
            serde_json::json!({
                "v": 1,
                "endpoint": format!("tester@127.0.0.1:{}", server.addr.port()),
                "password": PASSWORD,
            })
        );
        assert_eq!(
            store.label("s1").as_deref(),
            Some("NexusTerm: tester@127.0.0.1:22")
        );
    }

    #[tokio::test]
    async fn remember_stores_nothing_when_the_login_fails() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        let err = mgr
            .connect_with(
                request(server.addr.port(), password("nope")),
                remember("s1"),
                s,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::AuthFailed), "got {err:?}");
        assert_eq!(store.get("s1").unwrap(), None);
    }

    #[tokio::test]
    async fn remember_only_stores_typed_passwords() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        store
            .set("other", "label", &secret_for(server.addr.port(), PASSWORD))
            .unwrap();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        mgr.connect_with(
            request(server.addr.port(), stored("other")),
            remember("s1"),
            s,
        )
        .await
        .unwrap();
        assert_eq!(store.get("s1").unwrap(), None);
    }

    /// Output of a shell opened with a typed password and `storage`, up to the welcome banner.
    async fn output_after_login(
        mgr: &SshManager,
        port: u16,
        storage: Option<PasswordStorage>,
    ) -> String {
        let (s, mut rx) = sink();
        mgr.connect_with(request(port, password(PASSWORD)), storage, s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await.0
    }

    #[tokio::test]
    async fn a_password_the_keyring_cannot_save_is_reported_in_the_terminal() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        // No keyring configured: saving fails.
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);

        let out = output_after_login(&mgr, server.addr.port(), remember("s1")).await;
        let warning = "\r\n\x1b[33mThe password could not be saved in the system keyring: \
                       the system keyring is not available\x1b[0m\r\n";
        assert!(out.starts_with(warning), "output was {out:?}");
        assert!(out.contains("welcome"), "output was {out:?}");
        assert!(!out.contains(PASSWORD), "output was {out:?}");
    }

    #[tokio::test]
    async fn a_successful_save_writes_nothing_to_the_terminal() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr = with_store(&dir, &server, &store);

        let out = output_after_login(&mgr, server.addr.port(), remember("s1")).await;
        assert!(!out.contains("keyring"), "output was {out:?}");
    }

    #[tokio::test]
    async fn a_keyring_that_does_not_answer_does_not_hold_the_login_back() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let (store, release) = crate::secrets::BlockingStore::new();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key)
            .with_secrets(store)
            .with_storage_timeout(Duration::from_millis(100));

        for storage in [
            remember("s1"),
            Some(PasswordStorage::Forget {
                session_id: "s1".into(),
            }),
        ] {
            let out = tokio::time::timeout(
                Duration::from_secs(5),
                output_after_login(&mgr, server.addr.port(), storage),
            )
            .await
            .expect("the login waited for the keyring");
            assert!(
                out.contains("did not respond in time"),
                "output was {out:?}"
            );
            assert!(out.contains("welcome"), "output was {out:?}");
        }
        drop(release);
    }

    #[tokio::test]
    async fn forget_deletes_the_secret_only_after_a_successful_login() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        store.set("s1", "label", "old-password").unwrap();
        let mgr = with_store(&dir, &server, &store);
        let forget = || {
            Some(PasswordStorage::Forget {
                session_id: "s1".into(),
            })
        };

        let (s, _rx) = sink();
        mgr.connect_with(request(server.addr.port(), password("nope")), forget(), s)
            .await
            .unwrap_err();
        assert!(store.get("s1").unwrap().is_some(), "deleted on failure");

        let (s, _rx) = sink();
        mgr.connect_with(request(server.addr.port(), password(PASSWORD)), forget(), s)
            .await
            .unwrap();
        assert_eq!(store.get("s1").unwrap(), None);
    }

    #[test]
    fn stored_password_and_storage_requests_deserialize_from_camel_case() {
        let auth: SshAuth = serde_json::from_value(
            serde_json::json!({"method": "storedPassword", "sessionId": "s1"}),
        )
        .unwrap();
        assert!(matches!(auth, SshAuth::StoredPassword { session_id } if session_id == "s1"));
        let storage: PasswordStorage = serde_json::from_value(
            serde_json::json!({"action": "remember", "sessionId": "s1", "label": "L"}),
        )
        .unwrap();
        assert!(matches!(storage, PasswordStorage::Remember { .. }));
        let storage: PasswordStorage =
            serde_json::from_value(serde_json::json!({"action": "forget", "sessionId": "s1"}))
                .unwrap();
        assert!(matches!(storage, PasswordStorage::Forget { session_id } if session_id == "s1"));
    }

    #[test]
    fn debug_of_stored_password_requests_never_contains_the_password() {
        let dbg = format!("{:?}", stored("s1"));
        assert!(dbg.contains("s1"), "{dbg}");
        let req = request(22, password("hunter2"));
        let dbg = format!("{:?} {:?}", req, remember("s1"));
        assert!(!dbg.contains("hunter2"), "{dbg}");
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
