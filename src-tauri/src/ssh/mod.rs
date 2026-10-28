//! SSH shell sessions with OpenSSH-compatible host key verification.
//!
//! Host keys are checked against a `known_hosts` file:
//! - a recorded matching key connects;
//! - a recorded *different* key is always rejected (possible MITM);
//! - an unknown host is rejected with its fingerprint, and the caller may
//!   retry with `trusted_fingerprint` set to that exact value to accept and
//!   record it.
//!
//! A connection may go through up to [`MAX_JUMPS`] jump hosts (like `ssh -J`):
//! each hop is reached through a `direct-tcpip` channel of the previous one and
//! applies the same known_hosts policy and its own authentication. Errors of a
//! jump host are wrapped in [`SshError::Hop`], which names it.
//!
//! Password logins (typed, saved or printed by a command, see [`secret_command`]) first try
//! public-key authentication like OpenSSH:
//! the SSH agent's keys, then the default identity files `id_ed25519`, `id_ecdsa` and
//! `id_rsa` next to known_hosts (`~/.ssh`), unencrypted only. The password is only sent
//! when the server rejects all of them (see [`try_default_keys`]).
//!
//! A terminal tab may ask for [`ShellOptions`]: forwarding the local SSH agent to the target
//! (never to its jump hosts), and starting the shell inside a tmux session that every
//! reconnection resumes (see [`tmux_command`]).
//!
//! Instead of TCP, the target may be reached through a local proxy command's stdin and stdout
//! (like OpenSSH's `ProxyCommand`, see [`proxy`]); it cannot be combined with jump hosts.

pub mod cwd;
#[cfg(test)]
mod interop_tests;
mod proxy;
pub mod secret_command;
mod shell;
#[cfg(test)]
pub(crate) mod test_server;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::ChannelOpenHandle;
use russh::keys::{
    HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate, known_hosts, load_secret_key,
};
use russh::{Channel, ChannelMsg, ChannelOpenFailure, client};
use russh_sftp::client::SftpSession;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::platform;
use crate::secrets::{self, NoStore, SharedSecrets};
use crate::sftp::SftpError;
use crate::terminal::{FlowGate, TerminalSink};

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
    /// Jump hosts to go through, outermost first (see [`JumpHost`]).
    #[serde(default)]
    pub jumps: Vec<JumpHost>,
}

/// Most jump hosts a connection may go through.
pub const MAX_JUMPS: usize = 3;

/// A jump host on the way to the target, with everything that hop needs.
///
/// Wire shape (camelCase): `{ name, host, port, username, auth,
/// trustedFingerprint?, storage? }`. `trustedFingerprint` and `storage` work
/// like the target's own `trustedFingerprint` and the `storage` argument, for
/// this hop only.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JumpHost {
    /// Name shown in errors, e.g. the saved session name.
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    #[serde(default)]
    pub trusted_fingerprint: Option<String>,
    #[serde(default)]
    pub storage: Option<PasswordStorage>,
}

fn default_port() -> u16 {
    22
}

/// Per-tab options of an interactive shell (wire shape camelCase:
/// `{ forwardAgent?, tmuxSession?, proxyCommand? }`).
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOptions {
    /// Lets the target use the local SSH agent (like `ssh -A`); jump hosts never get it.
    #[serde(default)]
    pub forward_agent: bool,
    /// Runs `tmux new -A -s <name>` instead of the plain login shell (see [`tmux_command`]).
    #[serde(default)]
    pub tmux_session: Option<String>,
    /// Reaches the target through this local command instead of TCP (see [`proxy`]); its stderr
    /// lines are shown in the terminal in yellow.
    #[serde(default)]
    pub proxy_command: Option<String>,
}

/// Whether `name` may be a tmux session name: 1 to 64 letters, digits, `.`, `_` or `-`. Nothing
/// else ever reaches the remote shell's command line.
pub fn valid_tmux_session(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// The exec command of a tab kept in tmux session `name` (a [`valid_tmux_session`]): it
/// attaches to the session, creating it the first time, and falls back to the login shell with
/// a one-line note when tmux is not installed. It is valid in sh, bash, zsh and fish, whichever
/// the user's login shell is (sshd runs it with `$SHELL -c`).
pub fn tmux_command(name: &str) -> String {
    // `a && b || c && d` runs the same way in every one of them (fish 3+ included): `exec`
    // replaces the shell when tmux exists, otherwise the note and the login shell follow.
    format!(
        "command -v tmux >/dev/null 2>&1 && exec tmux new -A -s '{name}' \
         || echo '{TMUX_MISSING_NOTE}' && exec \"$SHELL\" -l"
    )
}

/// What a tab kept in tmux prints when the server has no tmux (no quotes: it is single-quoted).
const TMUX_MISSING_NOTE: &str =
    "PlexusTerm: tmux is not installed on this server, so this is the login shell.";

#[derive(Clone, serde::Deserialize)]
#[serde(tag = "method", rename_all = "camelCase")]
pub enum SshAuth {
    Password {
        password: String,
    },
    #[serde(rename_all = "camelCase")]
    Key {
        path: String,
        passphrase: Option<String>,
        /// Prints the key's passphrase (a password manager's command line); used when no
        /// passphrase was typed. See [`secret_command`].
        #[serde(default)]
        passphrase_command: Option<String>,
    },
    Agent,
    /// The password saved in the system keyring for this saved session.
    #[serde(rename_all = "camelCase")]
    StoredPassword {
        session_id: String,
    },
    /// The password is what this command prints (a password manager's command line); the
    /// command is not a secret, its output is. See [`secret_command`].
    PasswordCommand {
        command: String,
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
            Self::Key {
                path,
                passphrase,
                passphrase_command,
            } => f
                .debug_struct("Key")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "<redacted>"))
                .field("passphrase_command", passphrase_command)
                .finish(),
            Self::Agent => f.write_str("Agent"),
            Self::StoredPassword { session_id } => f
                .debug_struct("StoredPassword")
                .field("session_id", session_id)
                .finish(),
            Self::PasswordCommand { command } => f
                .debug_struct("PasswordCommand")
                .field("command", command)
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
    /// A password or passphrase command gave no usable secret; `stderr` holds the first lines
    /// of its standard error, never its output.
    #[error("{}", secret_command::describe(.purpose, .failure, .code, .stderr))]
    PasswordCommand {
        purpose: secret_command::SecretKind,
        failure: secret_command::CommandFailure,
        code: Option<i32>,
        stderr: String,
    },
    #[error("unknown terminal session {id}")]
    UnknownSession { id: u32 },
    #[error("{message}")]
    Connection { message: String },
    /// A jump host failed: `hop` is its 1-based position and `error` what went wrong there.
    /// Serialized as `{ kind: "hop", hop, name, error: { kind: ..., ... } }`.
    #[error("via {name} (jump host {hop}): {error}")]
    Hop {
        hop: usize,
        name: String,
        error: Box<SshError>,
    },
}

fn connection(err: impl std::fmt::Display) -> SshError {
    SshError::Connection {
        message: err.to_string(),
    }
}

/// The next stderr line of a session's proxy command; never resolves without one (no proxy, or
/// the command closed its stderr).
async fn next_proxy_line(stderr: &mut Option<tokio::sync::mpsc::Receiver<String>>) -> String {
    if let Some(receiver) = stderr {
        if let Some(line) = receiver.recv().await {
            return line;
        }
        *stderr = None;
    }
    std::future::pending().await
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
    /// Serves the server's agent channels from the local agent; without it they are refused.
    agent: Option<AgentEndpoint>,
}

/// The local SSH agent forwarded channels are bridged to: an explicit socket (tests), or
/// `None` for this machine's default (see [`platform::connect_agent`]).
#[derive(Debug, Clone)]
struct AgentEndpoint(Option<PathBuf>);

/// Copies a forwarded agent channel to and from a fresh connection to the local agent, until
/// either side closes. An agent that cannot be reached closes the channel.
async fn bridge_agent(channel: Channel<client::Msg>, endpoint: AgentEndpoint) {
    match platform::connect_agent(endpoint.0.as_deref()).await {
        Ok(agent) => {
            let mut agent = agent.into_inner();
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut agent).await;
        }
        Err(_) => {
            let _ = channel.close().await;
        }
    }
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

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<client::Msg>,
        reply: ChannelOpenHandle,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        // Only a connection that asked for agent forwarding serves it (russh accepts by default).
        match &self.agent {
            Some(endpoint) => {
                reply.accept().await;
                tokio::spawn(bridge_agent(channel, endpoint.clone()));
            }
            None => {
                reply
                    .reject(ChannelOpenFailure::AdministrativelyProhibited)
                    .await
            }
        }
        Ok(())
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
    /// Jump hosts to go through, outermost first.
    #[serde(default)]
    pub jumps: Vec<JumpHost>,
}

/// An [`SshTarget`] with the proxy command its saved session may have (wire shape: the target's
/// fields and an optional `proxyCommand`), for the connections that take a target (tunnels).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxiedTarget {
    #[serde(flatten)]
    pub target: SshTarget,
    #[serde(default)]
    pub proxy_command: Option<String>,
}

/// How [`connect_authenticated`] reaches the server and the saved passwords.
#[derive(Clone, Copy)]
pub(crate) struct ConnectContext<'a> {
    pub known_hosts: &'a Path,
    pub agent_socket: Option<&'a Path>,
    pub secrets: &'a SharedSecrets,
    /// Bound on the keyring update after the login (see [`STORAGE_TIMEOUT`]).
    pub storage_timeout: Duration,
    /// How often every hop sends a keepalive ([`KEEPALIVE`], or [`TERMINAL_KEEPALIVE`]).
    pub keepalive_interval: Duration,
}

/// Keepalive of SFTP, tunnels, Mosh's start and the other connections that do not reconnect.
pub(crate) const KEEPALIVE: Duration = Duration::from_secs(30);
/// Keepalive of terminal tabs, which reconnect by themselves: a dead link is noticed in about
/// 45 s (3 unanswered) instead of 90 s.
pub(crate) const TERMINAL_KEEPALIVE: Duration = Duration::from_secs(15);

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

/// An authenticated connection and the jump host connections it goes through.
pub(crate) struct Chain {
    pub connection: Connection,
    /// Outermost first; they must stay open as long as `connection`.
    pub jumps: Vec<Connection>,
    /// User-facing keyring problems after the logins (see [`apply_storage`]).
    pub warnings: Vec<String>,
}

/// Ends jump host connections, innermost first.
pub(crate) async fn disconnect_jumps(jumps: &[Connection]) {
    for jump in jumps.iter().rev() {
        let _ = jump
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
    }
}

/// One SSH server to log into, either directly or through the previous hop.
struct Hop {
    host: String,
    port: u16,
    username: String,
    auth: SshAuth,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    /// Set on the target of a session that forwards the agent, never on a jump host.
    agent: Option<AgentEndpoint>,
    /// Set on the target of a proxied session: the transport is this command, not TCP.
    proxy: Option<HopProxy>,
}

/// The expanded proxy command of a hop and where its stderr lines go.
struct HopProxy {
    command: String,
    stderr: tokio::sync::mpsc::Sender<String>,
}

/// What [`connect_chain`] opened, beyond the [`Chain`].
struct Opened {
    chain: Chain,
    /// Whether the target's connection serves agent channels.
    forwarding_agent: bool,
    /// The proxy command's stderr lines, when the target is proxied.
    proxy_stderr: Option<tokio::sync::mpsc::Receiver<String>>,
}

/// Most stderr lines of a failed proxy command quoted in the error.
const PROXY_ERROR_LINES: usize = 5;

/// `err` with the last stderr lines of the proxy command that failed, which usually say why.
async fn with_proxy_output(
    err: SshError,
    stderr: &mut tokio::sync::mpsc::Receiver<String>,
) -> SshError {
    let mut lines: Vec<String> = Vec::new();
    // The command was killed with its connection; its last lines arrive right after.
    let _ = tokio::time::timeout(Duration::from_secs(1), async {
        while let Some(line) = stderr.recv().await {
            lines.push(line);
        }
    })
    .await;
    while let Ok(line) = stderr.try_recv() {
        lines.push(line);
    }
    let tail = lines.len().saturating_sub(PROXY_ERROR_LINES);
    match err {
        SshError::Connection { message } if lines.len() > tail => SshError::Connection {
            message: format!(
                "{message} (the proxy command said: {})",
                lines[tail..].join(" / ")
            ),
        },
        other => other,
    }
}

/// Connects to `target` through its jump hosts (if any), applying the known_hosts
/// policy and authenticating at every hop, then applies `storage` to the target's
/// saved password (each jump host carries its own). Nothing is stored or deleted
/// for a hop whose login failed.
///
/// A jump host failure is returned as [`SshError::Hop`] and closes the hops already
/// opened. Keyring problems never fail the login: they are returned as warnings.
pub(crate) async fn connect_authenticated(
    target: SshTarget,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    ctx: ConnectContext<'_>,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
) -> Result<Chain, SshError> {
    connect_proxied(target, None, trusted_fingerprint, storage, ctx, forwarded).await
}

/// [`connect_authenticated`] through `proxy_command` (blank: none) instead of TCP; the command's
/// stderr is not shown anywhere but in the error of a connection that failed.
pub(crate) async fn connect_proxied(
    target: SshTarget,
    proxy_command: Option<String>,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    ctx: ConnectContext<'_>,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
) -> Result<Chain, SshError> {
    let opened = connect_chain(
        target,
        proxy_command,
        trusted_fingerprint,
        storage,
        ctx,
        forwarded,
        false,
    )
    .await?;
    Ok(opened.chain)
}

/// [`connect_authenticated`], and with `forward_agent` the target's connection serves agent
/// channels from the local agent. Also returns whether it does: an agent that cannot be reached
/// turns forwarding off for this connection with a warning instead of failing the login.
///
/// With `proxy_command` (blank: none) the target is reached through that command (see
/// [`proxy`]); it is refused, before anything runs, together with jump hosts, when too long or
/// multi-line, or when the host or user it names could change its meaning to the shell.
#[allow(
    clippy::too_many_arguments,
    reason = "private; mirrors connect_proxied plus one flag"
)]
async fn connect_chain(
    target: SshTarget,
    proxy_command: Option<String>,
    trusted_fingerprint: Option<String>,
    storage: Option<PasswordStorage>,
    ctx: ConnectContext<'_>,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
    forward_agent: bool,
) -> Result<Opened, SshError> {
    if target.jumps.len() > MAX_JUMPS {
        return Err(SshError::Connection {
            message: format!("at most {MAX_JUMPS} jump hosts are supported"),
        });
    }
    let proxy_command = proxy_command
        .map(|command| command.trim().to_string())
        .filter(|command| !command.is_empty());
    let (proxy, mut proxy_stderr) = match proxy_command {
        None => (None, None),
        Some(template) => {
            if !target.jumps.is_empty() {
                return Err(SshError::Connection {
                    message: "a proxy command cannot be combined with jump hosts".into(),
                });
            }
            let refused = |message| SshError::Connection { message };
            proxy::check(&template).map_err(refused)?;
            let command = proxy::expand(&template, &target.host, target.port, &target.username)
                .map_err(refused)?;
            let (tx, rx) = tokio::sync::mpsc::channel(proxy::STDERR_BACKLOG);
            (
                Some(HopProxy {
                    command,
                    stderr: tx,
                }),
                Some(rx),
            )
        }
    };
    let mut jumps: Vec<Connection> = Vec::with_capacity(target.jumps.len());
    let mut warnings = Vec::new();
    for (index, jump) in target.jumps.into_iter().enumerate() {
        let (hop, name) = (index + 1, jump.name);
        let next = Hop {
            host: jump.host,
            port: jump.port,
            username: jump.username,
            auth: jump.auth,
            trusted_fingerprint: jump.trusted_fingerprint,
            storage: jump.storage,
            agent: None,
            proxy: None,
        };
        match connect_hop(next, jumps.last(), ctx, None).await {
            Ok((connection, warning)) => {
                jumps.push(connection);
                warnings.extend(warning.map(|w| format!("via {name} (jump host {hop}): {w}")));
            }
            Err(err) => {
                disconnect_jumps(&jumps).await;
                return Err(SshError::Hop {
                    hop,
                    name,
                    error: Box::new(err),
                });
            }
        }
    }
    let agent = match forward_agent {
        false => None,
        true => match platform::connect_agent(ctx.agent_socket).await {
            Ok(_) => Some(AgentEndpoint(ctx.agent_socket.map(Path::to_path_buf))),
            Err(err) => {
                warnings.push(format!(
                    "SSH agent forwarding is off for this session: no SSH agent is available ({err})"
                ));
                None
            }
        },
    };
    let forwarding_agent = agent.is_some();
    let last = Hop {
        host: target.host,
        port: target.port,
        username: target.username,
        auth: target.auth,
        trusted_fingerprint,
        storage,
        agent,
        proxy,
    };
    match connect_hop(last, jumps.last(), ctx, forwarded).await {
        Ok((connection, warning)) => {
            warnings.extend(warning);
            let chain = Chain {
                connection,
                jumps,
                warnings,
            };
            Ok(Opened {
                chain,
                forwarding_agent,
                proxy_stderr,
            })
        }
        Err(err) => {
            disconnect_jumps(&jumps).await;
            Err(match &mut proxy_stderr {
                Some(stderr) => with_proxy_output(err, stderr).await,
                None => err,
            })
        }
    }
}

/// Connects to one hop (over a `direct-tcpip` channel of `via` when given), applies
/// the known_hosts policy, authenticates and then applies the hop's `storage`.
///
/// A password login first tries the default keys; when the server drops the connection
/// while they are tried (too many authentication failures), the hop is reconnected once
/// and only the password is tried.
async fn connect_hop(
    hop: Hop,
    via: Option<&Connection>,
    ctx: ConnectContext<'_>,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
) -> Result<(Connection, Option<String>), SshError> {
    let ConnectContext {
        known_hosts,
        agent_socket,
        secrets,
        storage_timeout,
        keepalive_interval,
    } = ctx;
    let mut handle = open_hop(
        &hop,
        via,
        known_hosts,
        keepalive_interval,
        forwarded.clone(),
    )
    .await?;
    let endpoint = endpoint(&hop.username, &hop.host, hop.port);

    if matches!(
        hop.auth,
        SshAuth::Password { .. } | SshAuth::StoredPassword { .. } | SshAuth::PasswordCommand { .. }
    ) {
        let identity_dir = known_hosts.parent();
        match try_default_keys(&mut handle, &hop.username, agent_socket, identity_dir).await {
            // The typed password was never checked, so it is not saved.
            KeysOutcome::Accepted => {
                let warning =
                    apply_storage(secrets, hop.storage, None, endpoint, storage_timeout).await;
                return Ok((handle, warning));
            }
            KeysOutcome::Rejected => {}
            KeysOutcome::Disconnected => {
                handle = open_hop(&hop, via, known_hosts, keepalive_interval, forwarded).await?;
            }
        }
    }

    let typed_password = match &hop.auth {
        SshAuth::Password { password } => Some(password.clone()),
        _ => None,
    };
    authenticate(
        &mut handle,
        &hop.username,
        hop.auth,
        agent_socket,
        secrets,
        &endpoint,
    )
    .await?;
    let warning = apply_storage(
        secrets,
        hop.storage,
        typed_password,
        endpoint,
        storage_timeout,
    )
    .await;
    Ok((handle, warning))
}

/// Opens the SSH connection to `hop` (over a `direct-tcpip` channel of `via` when given)
/// and applies the known_hosts policy, without authenticating.
/// A hop's client settings: a keepalive every `keepalive_interval`, the link given up after 3
/// unanswered (network gone, laptop resumed).
fn client_config(keepalive_interval: Duration) -> client::Config {
    client::Config {
        keepalive_interval: Some(keepalive_interval),
        keepalive_max: 3,
        ..Default::default()
    }
}

async fn open_hop(
    hop: &Hop,
    via: Option<&Connection>,
    known_hosts: &Path,
    keepalive_interval: Duration,
    forwarded: Option<UnboundedSender<ForwardedChannel>>,
) -> Result<Connection, SshError> {
    let rejection = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        host: hop.host.clone(),
        port: hop.port,
        known_hosts: known_hosts.to_path_buf(),
        trusted_fingerprint: hop.trusted_fingerprint.clone(),
        rejection: rejection.clone(),
        forwarded,
        agent: hop.agent.clone(),
    };
    let config = Arc::new(client_config(keepalive_interval));
    let label = host_label(&hop.host, hop.port);

    let connecting = async {
        let connected = match (via, &hop.proxy) {
            (None, Some(proxy)) => {
                let stream = proxy::spawn(&proxy.command, proxy.stderr.clone()).map_err(|err| {
                    SshError::Connection {
                        message: format!("the proxy command could not be started: {err}"),
                    }
                })?;
                client::connect_stream(config, stream, handler).await
            }
            (None, None) => client::connect(config, (hop.host.as_str(), hop.port), handler).await,
            (Some(jump), _) => {
                let channel = jump
                    .channel_open_direct_tcpip(hop.host.clone(), hop.port.into(), "127.0.0.1", 0)
                    .await
                    .map_err(|err| SshError::Connection {
                        message: format!("the jump host cannot reach {label}: {err}"),
                    })?;
                client::connect_stream(config, channel.into_stream(), handler).await
            }
        };
        connected.map_err(|err| {
            rejection
                .lock()
                .unwrap()
                .take()
                .unwrap_or_else(|| connection(err))
        })
    };
    match tokio::time::timeout(CONNECT_TIMEOUT, connecting).await {
        Err(_) => Err(SshError::Connection {
            message: format!("connection to {label} timed out"),
        }),
        Ok(result) => result,
    }
}

/// Default identity files tried by password logins, in OpenSSH's order.
const DEFAULT_IDENTITIES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

/// Most keys a password login tries before the password. OpenSSH servers allow 6
/// authentication attempts by default, so the password always keeps one.
const MAX_DEFAULT_KEY_ATTEMPTS: usize = 5;

/// What trying the default keys before a password led to.
#[derive(Debug, PartialEq, Eq)]
enum KeysOutcome {
    Accepted,
    /// Every key was rejected (or there was none): the password comes next.
    Rejected,
    /// The server closed the connection while keys were tried.
    Disconnected,
}

/// Tries the SSH agent's keys, then the unencrypted default identity files in
/// `identity_dir` that the agent did not already offer, at most
/// [`MAX_DEFAULT_KEY_ATTEMPTS`] in all. Nothing here prompts or fails the login: an
/// unavailable agent, a missing, unreadable or encrypted file, or a key that cannot sign
/// is skipped.
async fn try_default_keys(
    handle: &mut Connection,
    user: &str,
    agent_socket: Option<&Path>,
    identity_dir: Option<&Path>,
) -> KeysOutcome {
    let hash = match handle.best_supported_rsa_hash().await {
        Ok(hash) => hash.flatten(),
        Err(_) if handle.is_closed() => return KeysOutcome::Disconnected,
        Err(_) => None,
    };
    let mut attempts = 0;
    let mut offered: Vec<PublicKey> = Vec::new();

    // Tests only use an explicit agent socket, never the developer's own agent.
    if (agent_socket.is_some() || !cfg!(test))
        && let Ok(mut agent) = platform::connect_agent(agent_socket).await
    {
        let identities = agent.request_identities().await.unwrap_or_default();
        for identity in identities {
            if attempts == MAX_DEFAULT_KEY_ATTEMPTS {
                return KeysOutcome::Rejected;
            }
            let key = identity.public_key().into_owned();
            attempts += 1;
            offered.push(key.clone());
            match handle
                .authenticate_publickey_with(user, key, hash, &mut agent)
                .await
            {
                Ok(result) if result.success() => return KeysOutcome::Accepted,
                _ if handle.is_closed() => return KeysOutcome::Disconnected,
                _ => {}
            }
        }
    }

    let Some(dir) = identity_dir else {
        return KeysOutcome::Rejected;
    };
    for name in DEFAULT_IDENTITIES {
        if attempts == MAX_DEFAULT_KEY_ATTEMPTS {
            break;
        }
        // Missing, unreadable and passphrase-protected files are skipped without asking.
        let Ok(key) = load_secret_key(dir.join(name), None) else {
            continue;
        };
        if offered
            .iter()
            .any(|known| known.key_data() == key.public_key().key_data())
        {
            continue;
        }
        attempts += 1;
        match handle
            .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
            .await
        {
            Ok(result) if result.success() => return KeysOutcome::Accepted,
            _ if handle.is_closed() => return KeysOutcome::Disconnected,
            _ => {}
        }
    }
    KeysOutcome::Rejected
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
        SshAuth::PasswordCommand { command } => {
            let password = secret_command::read_secret(
                &command,
                secret_command::SecretKind::Password,
                secret_command::SECRET_COMMAND_TIMEOUT,
            )
            .await?;
            handle
                .authenticate_password(user, password.as_str())
                .await
                .map_err(connection)?
                .success()
        }
        SshAuth::Key {
            path,
            passphrase,
            passphrase_command,
        } => {
            // A typed passphrase wins; the command only runs when none was given.
            let from_command = match (&passphrase, &passphrase_command) {
                (None, Some(command)) => Some(
                    secret_command::read_secret(
                        command,
                        secret_command::SecretKind::Passphrase,
                        secret_command::SECRET_COMMAND_TIMEOUT,
                    )
                    .await?,
                ),
                _ => None,
            };
            let passphrase = passphrase
                .as_deref()
                .or(from_command.as_ref().map(|secret| secret.as_str()));
            let key = load_secret_key(platform::expand_home(&path), passphrase).map_err(|err| {
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
            let mut agent = platform::connect_agent(agent_socket).await.map_err(|err| {
                SshError::Connection {
                    message: format!("SSH agent unavailable: {err}"),
                }
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
}

/// The SFTP subsystem of a session, opened on first use.
type SftpSlot = Arc<tokio::sync::Mutex<Option<Arc<SftpSession>>>>;

struct SessionEntry {
    tx: UnboundedSender<Command>,
    handle: Arc<Connection>,
    sftp: SftpSlot,
    /// Dropped when the session is closed (or the manager is): the writer task stops at once,
    /// even in the middle of a write the remote does not accept, instead of after it.
    _closed: tokio::sync::oneshot::Sender<()>,
    /// The gate the reader waits on while the webview catches up; closed with the session so a
    /// paused reader still sees the end.
    flow: Option<Arc<FlowGate>>,
    /// Woken when a probe got no answer: the reader ends the session as a lost connection.
    dead: Arc<tokio::sync::Notify>,
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

    #[cfg(all(test, unix))]
    fn with_agent_socket(mut self, socket: PathBuf) -> Self {
        self.agent_socket = Some(socket);
        self
    }

    /// How this manager reaches servers and saved passwords, for logins made by
    /// other session kinds (Mosh starts its server over SSH).
    pub(crate) fn context(&self) -> ConnectContext<'_> {
        ConnectContext {
            known_hosts: &self.known_hosts,
            agent_socket: self.agent_socket.as_deref(),
            secrets: &self.secrets,
            storage_timeout: self.storage_timeout,
            keepalive_interval: KEEPALIVE,
        }
    }

    /// The context of a terminal tab's connection: it notices a dead link sooner, to reconnect.
    fn terminal_context(&self) -> ConnectContext<'_> {
        ConnectContext {
            keepalive_interval: TERMINAL_KEEPALIVE,
            ..self.context()
        }
    }

    /// Uses the current user's `~/.ssh/known_hosts`, like OpenSSH.
    pub fn for_current_user() -> Self {
        Self::new(platform::known_hosts_path())
    }

    /// Connects without touching saved passwords (tests; the app uses `connect_reporting_loss`).
    #[cfg(test)]
    pub async fn connect(
        &self,
        req: ConnectRequest,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        self.connect_with(req, None, sink).await
    }

    /// Opens an interactive shell, then saves or forgets the session's
    /// password as `storage` asks once the login succeeded (tests; the app uses
    /// `connect_reporting_loss`).
    #[cfg(test)]
    pub async fn connect_with(
        &self,
        req: ConnectRequest,
        storage: Option<PasswordStorage>,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        self.connect_reporting_loss(req, ShellOptions::default(), storage, sink, || {})
            .await
    }

    /// Like [`Self::connect_with`], and calls `on_lost` just before the sink's exit when the
    /// connection went away under the session: neither the remote ended the channel (exit
    /// status, close) nor the app closed it. The frontend reconnects such a session.
    ///
    /// `options` may forward the local agent to the target and keep the shell in tmux; an
    /// invalid tmux session name fails before anything is sent.
    pub async fn connect_reporting_loss(
        &self,
        req: ConnectRequest,
        options: ShellOptions,
        storage: Option<PasswordStorage>,
        sink: impl TerminalSink,
        on_lost: impl FnOnce() + Send + 'static,
    ) -> Result<u32, SshError> {
        let target = SshTarget {
            host: req.host,
            port: req.port,
            username: req.username,
            auth: req.auth,
            jumps: req.jumps,
        };
        if let Some(name) = &options.tmux_session
            && !valid_tmux_session(name)
        {
            return Err(SshError::Connection {
                message: format!("{name:?} is not a valid tmux session name"),
            });
        }
        let ctx = self.terminal_context();
        let Opened {
            chain:
                Chain {
                    connection: handle,
                    jumps,
                    warnings,
                },
            forwarding_agent,
            mut proxy_stderr,
        } = connect_chain(
            target,
            options.proxy_command.clone(),
            req.trusted_fingerprint,
            storage,
            ctx,
            None,
            options.forward_agent,
        )
        .await?;
        let jumps = Arc::new(jumps);

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
        if forwarding_agent {
            // Like OpenSSH, before the shell starts, so it sees SSH_AUTH_SOCK.
            channel.agent_forward(false).await.map_err(connection)?;
        }
        match &options.tmux_session {
            Some(name) => channel.exec(false, tmux_command(name)).await,
            None => channel.request_shell(false).await,
        }
        .map_err(connection)?;
        // Shown before any remote output, which only the reader task below forwards.
        for warning in warnings {
            sink.data(format!("\r\n\x1b[33m{warning}\x1b[0m\r\n"));
        }

        let (tx, mut commands) = unbounded_channel();
        let (closed_tx, mut closed) = tokio::sync::oneshot::channel::<()>();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (mut reader, writer) = channel.split();
        let handle = Arc::new(handle);
        let flow = sink.flow();
        let dead = Arc::new(tokio::sync::Notify::new());
        self.sessions.lock().unwrap().insert(
            id,
            SessionEntry {
                tx,
                handle: handle.clone(),
                sftp: SftpSlot::default(),
                _closed: closed_tx,
                flow: flow.clone(),
                dead: dead.clone(),
            },
        );

        // Writes run in their own task: a large paste can wait for the remote
        // window while the reader keeps draining output (otherwise both stall).
        let (writer_handle, writer_jumps) = (handle.clone(), jumps.clone());
        // Set once the app closes the session, whose end is then no lost connection.
        let closing = Arc::new(AtomicBool::new(false));
        let closed_by_app = closing.clone();
        tokio::spawn(async move {
            // A write waits for the remote's window, which a remote that stops reading never
            // opens again (not even once the connection is gone): closing must not queue behind it.
            let mut cancelled = false;
            loop {
                let command = tokio::select! {
                    biased;
                    _ = &mut closed => {
                        cancelled = true;
                        break;
                    }
                    command = commands.recv() => command,
                };
                match command {
                    None => {
                        closed_by_app.store(true, Ordering::SeqCst);
                        break;
                    }
                    Some(Command::Data(data)) => {
                        tokio::select! {
                            biased;
                            _ = &mut closed => {
                                cancelled = true;
                                break;
                            }
                            written = writer.data(&data[..]) => {
                                if written.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    Some(Command::Resize(cols, rows)) => {
                        let _ = writer.window_change(cols.into(), rows.into(), 0, 0).await;
                    }
                }
            }
            // Closed by the user (or the manager was dropped): end the whole connection,
            // which also ends the reader below. Closing the channel politely is only tried
            // briefly: a remote that stopped reading may never answer.
            if cancelled {
                closed_by_app.store(true, Ordering::SeqCst);
            }
            if !cancelled {
                let _ = writer.close().await;
            } else {
                let _ = tokio::time::timeout(Duration::from_secs(1), writer.close()).await;
            }
            let _ = writer_handle
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
            disconnect_jumps(&writer_jumps).await;
        });

        tokio::spawn(async move {
            let mut decoder = sink.decoder();
            let mut exit_code = None;
            // The remote ended the channel (or the shell): a clean end, not a lost connection.
            let mut ended_by_remote = false;
            loop {
                if let Some(gate) = &flow {
                    gate.wait().await;
                }
                // A probe that got no answer ends the session like a dead link would, without
                // waiting for the keepalives to run out.
                let message = tokio::select! {
                    message = reader.wait() => message,
                    _ = dead.notified() => None,
                    line = next_proxy_line(&mut proxy_stderr) => {
                        sink.data(format!("\x1b[33m{line}\x1b[0m\r\n"));
                        continue;
                    }
                };
                let Some(message) = message else {
                    break;
                };
                match message {
                    ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                        let text = decoder.push(&data);
                        if !text.is_empty() {
                            sink.data(text);
                        }
                    }
                    ChannelMsg::ExitStatus { exit_status } => {
                        exit_code = Some(exit_status);
                        ended_by_remote = true;
                    }
                    ChannelMsg::ExitSignal { .. } | ChannelMsg::Eof => ended_by_remote = true,
                    ChannelMsg::Close => {
                        ended_by_remote = true;
                        break;
                    }
                    _ => {}
                }
            }
            // Bounded: over a dead link the goodbye may never leave.
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                let _ = handle
                    .disconnect(russh::Disconnect::ByApplication, "", "en")
                    .await;
                disconnect_jumps(&jumps).await;
            })
            .await;
            if !ended_by_remote && !closing.load(Ordering::SeqCst) {
                on_lost();
            }
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

    /// Whether session `id`'s server still answers: a keepalive that must be answered within
    /// `wait`. Without an answer the session ends as a lost connection (the app reconnects it),
    /// sooner than the keepalives running out would end it.
    pub async fn probe(&self, id: u32, wait: Duration) -> Result<bool, SshError> {
        let (handle, dead) = {
            let sessions = self.sessions.lock().unwrap();
            let entry = sessions.get(&id).ok_or(SshError::UnknownSession { id })?;
            (entry.handle.clone(), entry.dead.clone())
        };
        let answered = matches!(
            tokio::time::timeout(wait, handle.send_ping()).await,
            Ok(Ok(()))
        );
        if !answered {
            dead.notify_one();
        }
        Ok(answered)
    }

    pub fn close(&self, id: u32) -> Result<(), SshError> {
        let entry = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(SshError::UnknownSession { id })?;
        // A paused reader must see the end too.
        if let Some(gate) = &entry.flow {
            gate.close();
        }
        // Dropping the entry drops its `_closed` sender, which stops the writer task (it may
        // already have ended; nothing else to clean up then).
        drop(entry);
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

    /// Runs `command` on session `id` over a new exec channel of its existing
    /// connection (no new login) and returns its stdout. Output beyond
    /// [`MAX_EXEC_OUTPUT`] is dropped; a non-zero exit status or no answer within
    /// [`EXEC_TIMEOUT`] is an error.
    pub async fn exec(&self, id: u32, command: &str) -> Result<String, SshError> {
        let handle = {
            let sessions = self.sessions.lock().unwrap();
            let entry = sessions.get(&id).ok_or(SshError::UnknownSession { id })?;
            entry.handle.clone()
        };
        let run = async {
            let mut channel = handle.channel_open_session().await.map_err(connection)?;
            channel.exec(true, command).await.map_err(connection)?;
            let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
            let mut exit_status = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => append_capped(&mut stdout, &data),
                    ChannelMsg::ExtendedData { data, .. } => append_capped(&mut stderr, &data),
                    ChannelMsg::ExitStatus { exit_status: s } => exit_status = Some(s),
                    ChannelMsg::Close => break,
                    _ => {}
                }
            }
            match exit_status {
                Some(0) | None => Ok(String::from_utf8_lossy(&stdout).into_owned()),
                Some(status) => Err(SshError::Connection {
                    message: format!(
                        "remote command failed (exit status {status}): {}",
                        String::from_utf8_lossy(&stderr).trim()
                    ),
                }),
            }
        };
        tokio::time::timeout(EXEC_TIMEOUT, run)
            .await
            .unwrap_or_else(|_| {
                Err(SshError::Connection {
                    message: format!(
                        "remote command did not finish within {} s",
                        EXEC_TIMEOUT.as_secs()
                    ),
                })
            })
    }
}

/// How long [`SshManager::exec`] waits for a command to finish.
const EXEC_TIMEOUT: Duration = Duration::from_secs(10);
/// Bytes of stdout (and, separately, stderr) [`SshManager::exec`] keeps.
const MAX_EXEC_OUTPUT: usize = 256 * 1024;

fn append_capped(buffer: &mut Vec<u8>, data: &[u8]) {
    let room = MAX_EXEC_OUTPUT.saturating_sub(buffer.len());
    buffer.extend_from_slice(&data[..data.len().min(room)]);
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

    /// A session opened like the app opens one, with what its loss callback reports.
    struct Watched {
        id: u32,
        rx: UnboundedReceiver<Event>,
        lost: UnboundedReceiver<()>,
    }

    impl Watched {
        /// How the session ended: `Some(true)` when it was reported lost before its exit,
        /// `Some(false)` for a plain exit, None when it did not end within 5 seconds.
        async fn end(&mut self) -> Option<bool> {
            let (_, exit) = wait_for(&mut self.rx, "").await;
            exit.map(|_| self.lost.try_recv().is_ok())
        }
    }

    async fn connect_noting_loss(mgr: &SshManager, port: u16) -> Watched {
        let (s, mut rx) = sink();
        let (lost_tx, lost) = unbounded_channel();
        let id = mgr
            .connect_reporting_loss(
                request(port, password(PASSWORD)),
                ShellOptions::default(),
                None,
                s,
                move || {
                    let _ = lost_tx.send(());
                },
            )
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        Watched { id, rx, lost }
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
            jumps: vec![],
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
            passphrase_command: None,
        };
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[cfg(unix)]
    fn password_command(command: &str) -> SshAuth {
        SshAuth::PasswordCommand {
            command: command.into(),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_password_command_logs_in_with_what_it_prints() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let auth = password_command(&format!("printf '%s\\n' {PASSWORD}"));
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failing_password_command_fails_the_login_without_sending_a_password() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, _rx) = sink();

        let auth = password_command(&format!("printf {PASSWORD}; echo locked >&2; exit 2"));
        let err = mgr
            .connect(request(server.addr.port(), auth), s)
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "the password command exited with code 2: locked"
        );
        assert!(!serde_json::to_string(&err).unwrap().contains(PASSWORD));
        assert_eq!(server.password_attempts(), 0, "a password was sent");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_password_command_is_not_run_when_a_default_key_logs_in() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &client_key);
        let marker = dir.path().join("ran");
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let auth = password_command(&format!("touch '{}'; printf {PASSWORD}", marker.display()));
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 0);
        assert!(!marker.exists(), "the password command ran");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_password_from_a_command_is_never_saved_in_the_keyring() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        let auth = password_command(&format!("printf {PASSWORD}"));
        mgr.connect_with(request(server.addr.port(), auth), remember("s1"), s)
            .await
            .unwrap();
        assert_eq!(store.get("s1").unwrap(), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_passphrase_command_unlocks_an_encrypted_key() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let encrypted = client_key
            .encrypt(
                &mut russh::keys::ssh_key::rand_core::UnwrapErr(rand::rngs::SysRng),
                "open sesame",
            )
            .unwrap();
        let key_path = dir.path().join("work_key");
        let pem = encrypted
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        std::fs::write(&key_path, pem.as_bytes()).unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let auth = SshAuth::Key {
            path: key_path.to_string_lossy().into(),
            passphrase: None,
            passphrase_command: Some("printf 'open sesame\\n'".into()),
        };
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[test]
    fn password_command_auth_deserializes_from_the_frontend_shape() {
        let auth: SshAuth =
            serde_json::from_str(r#"{"method":"passwordCommand","command":"pass show db"}"#)
                .unwrap();
        assert!(
            matches!(auth, SshAuth::PasswordCommand { ref command } if command == "pass show db")
        );
        let key: SshAuth = serde_json::from_str(
            r#"{"method":"key","path":"~/k","passphraseCommand":"op read op://v/i/p"}"#,
        )
        .unwrap();
        assert!(matches!(
            key,
            SshAuth::Key { passphrase: None, passphrase_command: Some(ref c), .. } if c == "op read op://v/i/p"
        ));
        let plain: SshAuth = serde_json::from_str(r#"{"method":"key","path":"~/k"}"#).unwrap();
        assert!(matches!(
            plain,
            SshAuth::Key {
                passphrase_command: None,
                ..
            }
        ));
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
            passphrase_command: None,
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

    /// Writes `key` unencrypted to `path` (mode 0600 on Unix, as ssh-add requires).
    fn write_key(path: &Path, key: &russh::keys::PrivateKey) {
        let pem = key
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        std::fs::write(path, pem.as_bytes()).unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600))
            .unwrap();
    }

    /// An `ssh-agent` holding `key`, listening in `dir`; `None` when ssh-agent is not installed.
    #[cfg(unix)]
    async fn spawn_agent(
        dir: &tempfile::TempDir,
        key: &russh::keys::PrivateKey,
    ) -> Option<(std::process::Child, PathBuf)> {
        if std::process::Command::new("ssh-agent")
            .arg("-h")
            .output()
            .is_err()
        {
            eprintln!("skipping: ssh-agent not installed");
            return None;
        }
        let socket = dir.path().join("agent.sock");
        let agent = std::process::Command::new("ssh-agent")
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
        // Outside `dir`, so it is never taken for a default identity file.
        let keys = tempfile::tempdir().unwrap();
        let key_path = keys.path().join("agent_key");
        write_key(&key_path, key);
        let added = std::process::Command::new("ssh-add")
            .arg(&key_path)
            .env("SSH_AUTH_SOCK", &socket)
            .output()
            .unwrap();
        assert!(added.status.success(), "ssh-add failed: {added:?}");
        Some((agent, socket))
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn agent_login_uses_the_agent_identities() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let Some((mut agent, socket)) = spawn_agent(&dir, &client_key).await else {
            return;
        };

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

    #[test]
    fn a_dead_link_is_given_up_after_three_missed_keepalives_15_seconds_apart() {
        let config = client_config(TERMINAL_KEEPALIVE);
        assert_eq!(config.keepalive_interval, Some(Duration::from_secs(15)));
        assert_eq!(config.keepalive_max, 3);
    }

    #[test]
    fn only_terminal_tabs_send_keepalives_every_15_seconds() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        assert_eq!(
            mgr.terminal_context().keepalive_interval,
            Duration::from_secs(15)
        );
        // SFTP, tunnels, Mosh's start and key installs keep the 30 s they had.
        assert_eq!(mgr.context().keepalive_interval, Duration::from_secs(30));
    }

    #[tokio::test]
    async fn a_clean_exit_is_not_reported_as_lost() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        mgr.write(session.id, b"exit").unwrap();
        assert_eq!(session.end().await, Some(false));
    }

    #[tokio::test]
    async fn a_channel_closed_without_exit_status_is_not_reported_as_lost() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        mgr.write(session.id, b"hangup").unwrap();
        assert_eq!(session.end().await, Some(false));
    }

    #[tokio::test]
    async fn a_dropped_connection_is_reported_as_lost() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        mgr.write(session.id, b"drop").unwrap();
        assert_eq!(session.end().await, Some(true));
    }

    #[tokio::test]
    async fn a_probe_of_a_live_session_answers_and_leaves_it_open() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        assert!(mgr.probe(session.id, Duration::from_secs(3)).await.unwrap());
        mgr.write(session.id, b"exit").unwrap();
        assert_eq!(session.end().await, Some(false));
    }

    #[tokio::test]
    async fn a_probe_the_remote_never_answers_reports_the_session_lost() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        mgr.write(session.id, b"stall").unwrap();
        // The write goes through the writer task: let the server freeze before the ping leaves.
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            !mgr.probe(session.id, Duration::from_millis(300))
                .await
                .unwrap()
        );
        assert_eq!(session.end().await, Some(true));
    }

    #[tokio::test]
    async fn probing_an_unknown_session_fails() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        assert!(matches!(
            mgr.probe(42, Duration::from_secs(1)).await,
            Err(SshError::UnknownSession { id: 42 })
        ));
    }

    #[tokio::test]
    async fn closing_a_session_is_not_reported_as_lost() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let mut session = connect_noting_loss(&mgr, server.addr.port()).await;

        mgr.close(session.id).unwrap();
        assert_eq!(session.end().await, Some(false));
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
    async fn close_ends_a_session_whose_input_the_remote_stopped_reading() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        // The server stops reading: the next large write waits for a window that never opens.
        mgr.write(id, b"stall").unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        mgr.write(id, &vec![b'x'; 8 << 20]).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        mgr.close(id).unwrap();
        let exit = tokio::time::timeout(Duration::from_secs(4), async {
            loop {
                match rx.recv().await {
                    Some(Event::Exit(code)) => return Some(code),
                    Some(Event::Data(_)) => {}
                    None => return None,
                }
            }
        })
        .await;
        assert!(
            matches!(exit, Ok(Some(_))),
            "the session did not end after close: {exit:?}"
        );
    }

    /// A sink whose reader waits on `gate`, as the webview's does.
    struct GatedSink(UnboundedSender<Event>, Arc<crate::terminal::FlowGate>);

    impl TerminalSink for GatedSink {
        fn data(&self, text: String) {
            let _ = self.0.send(Event::Data(text));
        }
        fn exit(&self, code: Option<u32>) {
            let _ = self.0.send(Event::Exit(code));
        }
        fn flow(&self) -> Option<Arc<crate::terminal::FlowGate>> {
            Some(self.1.clone())
        }
    }

    fn gated_sink() -> (
        GatedSink,
        Arc<crate::terminal::FlowGate>,
        UnboundedReceiver<Event>,
    ) {
        let (tx, rx) = unbounded_channel();
        let gate = Arc::new(crate::terminal::FlowGate::new());
        (GatedSink(tx, gate.clone()), gate, rx)
    }

    #[tokio::test]
    async fn a_paused_session_reads_nothing_until_resumed() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, gate, mut rx) = gated_sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        gate.set_paused(true);
        // A read already waiting when the pause came may still deliver one message.
        mgr.write(id, b"first").unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        while rx.try_recv().is_ok() {}
        mgr.write(id, b"second").unwrap();
        let early = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(early.is_err(), "output was read while paused");
        gate.set_paused(false);
        let (out, _) = wait_for(&mut rx, "second").await;
        assert!(out.contains("second"), "output was {out:?}");
    }

    #[tokio::test]
    async fn closing_a_paused_session_still_ends_it_at_once() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, gate, mut rx) = gated_sink();

        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        gate.set_paused(true);
        mgr.write(id, b"first").unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        mgr.close(id).unwrap();
        let exit = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                match rx.recv().await {
                    Some(Event::Exit(code)) => return Some(code),
                    Some(Event::Data(_)) => {}
                    None => return None,
                }
            }
        })
        .await;
        assert!(
            matches!(exit, Ok(Some(_))),
            "the session did not end after close: {exit:?}"
        );
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
            label: "PlexusTerm: tester@127.0.0.1:22".into(),
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
            Some("PlexusTerm: tester@127.0.0.1:22")
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

    // --- Jump hosts (S14) ---

    /// known_hosts trusting every server in `servers`.
    fn trust_all(dir: &tempfile::TempDir, servers: &[&test_server::TestServer]) -> PathBuf {
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
        path
    }

    fn jump(name: &str, server: &test_server::TestServer, auth: SshAuth) -> JumpHost {
        JumpHost {
            name: name.into(),
            host: "127.0.0.1".into(),
            port: server.addr.port(),
            username: "tester".into(),
            auth,
            trusted_fingerprint: None,
            storage: None,
        }
    }

    /// Polls until `server` has `expected` open connections (5 s at most).
    async fn wait_connections(server: &test_server::TestServer, expected: usize) -> usize {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while server.open_connections() != expected && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        server.open_connections()
    }

    #[tokio::test]
    async fn one_jump_host_reaches_the_final_shell() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];
        let (s, mut rx) = sink();

        let id = mgr.connect(req, s).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        mgr.write(id, b"ping").unwrap();
        assert!(wait_for(&mut rx, "ping").await.0.contains("ping"));
        assert_eq!(bastion.password_attempts(), 1);
        assert_eq!(target.password_attempts(), 1);
    }

    #[tokio::test]
    async fn two_jump_hosts_reach_the_final_shell() {
        let first = test_server::start(2, None).await;
        let second = test_server::start(3, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&first, &second, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![
            jump("first", &first, password(PASSWORD)),
            jump("second", &second, password(PASSWORD)),
        ];
        let (s, mut rx) = sink();

        let id = mgr.connect(req, s).await.unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.write(id, b"through two hops").unwrap();
        let (out, _) = wait_for(&mut rx, "through two hops").await;
        assert!(out.contains("through two hops"), "output was {out:?}");
        assert_eq!(second.password_attempts(), 1);
    }

    #[tokio::test]
    async fn an_unknown_jump_host_names_the_hop_and_trusting_it_connects() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];

        let (s, _rx) = sink();
        let err = mgr.connect(req.clone(), s).await.unwrap_err();
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "hop", "{json}");
        assert_eq!(json["hop"], 1);
        assert_eq!(json["name"], "bastion");
        assert_eq!(json["error"]["kind"], "unknownHost");
        assert_eq!(
            json["error"]["host"],
            format!("[127.0.0.1]:{}", bastion.addr.port())
        );
        assert_eq!(json["error"]["fingerprint"], fingerprint(&bastion.host_key));
        assert_eq!(target.password_attempts(), 0);

        req.jumps[0].trusted_fingerprint = Some(fingerprint(&bastion.host_key));
        let (s, mut rx) = sink();
        mgr.connect(req, s).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[tokio::test]
    async fn an_unknown_target_behind_a_jump_host_is_not_wrapped() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];

        let (s, _rx) = sink();
        let err = mgr.connect(req.clone(), s).await.unwrap_err();
        assert!(matches!(err, SshError::UnknownHost { .. }), "got {err:?}");
        req.trusted_fingerprint = Some(fingerprint(&target.host_key));
        let (s, mut rx) = sink();
        mgr.connect(req, s).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[tokio::test]
    async fn a_wrong_jump_password_names_the_hop_and_never_reaches_the_target() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password("nope"))];
        let (s, _rx) = sink();

        let err = mgr.connect(req, s).await.unwrap_err();
        assert_eq!(
            err.to_string(),
            "via bastion (jump host 1): authentication failed"
        );
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({"kind": "hop", "hop": 1, "name": "bastion", "error": {"kind": "authFailed"}})
        );
        assert_eq!(target.password_attempts(), 0);
        assert_eq!(wait_connections(&bastion, 0).await, 0);
        assert_eq!(wait_connections(&target, 0).await, 0);
    }

    #[tokio::test]
    async fn a_failing_second_jump_names_its_position_and_closes_the_first() {
        let first = test_server::start(2, None).await;
        let second = test_server::start(3, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&first, &second, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![
            jump("first", &first, password(PASSWORD)),
            jump("second", &second, password("nope")),
        ];
        let (s, _rx) = sink();

        let err = mgr.connect(req, s).await.unwrap_err();
        assert_eq!(
            err.to_string(),
            "via second (jump host 2): authentication failed"
        );
        assert_eq!(wait_connections(&first, 0).await, 0);
    }

    #[tokio::test]
    async fn stored_jump_passwords_are_bound_to_the_jump_endpoint() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr =
            SshManager::new(trust_all(&dir, &[&bastion, &target])).with_secrets(store.clone());
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, stored("j1"))];

        // Saved for the target's endpoint, not the jump host's: never sent to the jump host.
        store
            .set("j1", "label", &secret_for(target.addr.port(), PASSWORD))
            .unwrap();
        let (s, _rx) = sink();
        let err = mgr.connect(req.clone(), s).await.unwrap_err();
        assert!(
            matches!(&err, SshError::Hop { hop: 1, error, .. } if matches!(**error, SshError::SecretMissing)),
            "got {err:?}"
        );
        assert_eq!(bastion.password_attempts(), 0);

        store
            .set("j1", "label", &secret_for(bastion.addr.port(), PASSWORD))
            .unwrap();
        let (s, mut rx) = sink();
        mgr.connect(req, s).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(bastion.password_attempts(), 1);
    }

    #[tokio::test]
    async fn remember_on_a_jump_host_saves_its_password_for_its_endpoint() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let store = MemoryStore::shared();
        let mgr =
            SshManager::new(trust_all(&dir, &[&bastion, &target])).with_secrets(store.clone());
        let mut req = request(target.addr.port(), password(PASSWORD));
        let mut bastion_hop = jump("bastion", &bastion, password(PASSWORD));
        bastion_hop.storage = remember("j1");
        req.jumps = vec![bastion_hop];
        let (s, _rx) = sink();

        mgr.connect(req, s).await.unwrap();
        let saved: serde_json::Value =
            serde_json::from_str(&store.get("j1").unwrap().unwrap()).unwrap();
        let expected: serde_json::Value =
            serde_json::from_str(&secret_for(bastion.addr.port(), PASSWORD)).unwrap();
        assert_eq!(saved, expected);
        assert_eq!(store.get("s1").unwrap(), None);
    }

    #[tokio::test]
    async fn closing_a_chained_session_closes_every_hop() {
        let first = test_server::start(2, None).await;
        let second = test_server::start(3, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&first, &second, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![
            jump("first", &first, password(PASSWORD)),
            jump("second", &second, password(PASSWORD)),
        ];
        let (s, mut rx) = sink();
        let id = mgr.connect(req, s).await.unwrap();
        wait_for(&mut rx, "welcome").await;
        assert_eq!(first.open_connections(), 1);
        assert_eq!(second.open_connections(), 1);

        mgr.close(id).unwrap();
        let (_, exit) = wait_for(&mut rx, "").await;
        assert!(exit.is_some(), "session did not end after close");
        assert_eq!(wait_connections(&target, 0).await, 0, "target still open");
        assert_eq!(wait_connections(&second, 0).await, 0, "jump 2 still open");
        assert_eq!(wait_connections(&first, 0).await, 0, "jump 1 still open");
    }

    #[tokio::test]
    async fn a_remote_exit_behind_jump_hosts_closes_every_hop() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];
        let (s, mut rx) = sink();
        let id = mgr.connect(req, s).await.unwrap();
        wait_for(&mut rx, "welcome").await;

        mgr.write(id, b"exit").unwrap();
        let (_, exit) = wait_for(&mut rx, "").await;
        assert_eq!(exit, Some(Some(7)));
        assert_eq!(wait_connections(&bastion, 0).await, 0, "jump still open");
    }

    #[tokio::test]
    async fn sftp_works_over_a_chained_session() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("hello.txt"), b"hi").unwrap();
        let bastion = test_server::start(2, None).await;
        let target = test_server::start_with_sftp(root.path()).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];
        let (s, _rx) = sink();
        let id = mgr.connect(req, s).await.unwrap();

        let sftp = tokio::time::timeout(Duration::from_secs(10), mgr.sftp(id))
            .await
            .expect("opening SFTP timed out")
            .unwrap();
        let names: Vec<String> = crate::sftp::list(&sftp, "/")
            .await
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["hello.txt".to_string()]);
    }

    #[tokio::test]
    async fn more_than_three_jump_hosts_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let target = test_server::start(1, None).await;
        let mgr = SshManager::new(trust_all(&dir, &[&target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("j", &target, password(PASSWORD)); MAX_JUMPS + 1];
        let (s, _rx) = sink();

        let err = mgr.connect(req, s).await.unwrap_err();
        assert!(matches!(err, SshError::Connection { .. }), "got {err:?}");
        assert_eq!(target.open_connections(), 0);
    }

    #[test]
    fn jump_hosts_deserialize_from_camel_case() {
        let req: ConnectRequest = serde_json::from_value(serde_json::json!({
            "host": "target", "username": "u", "auth": {"method": "agent"},
            "cols": 80, "rows": 24, "trustedFingerprint": null,
            "jumps": [{
                "name": "bastion", "host": "b", "port": 2222, "username": "j",
                "auth": {"method": "storedPassword", "sessionId": "j1"},
                "trustedFingerprint": "SHA256:x",
                "storage": {"action": "forget", "sessionId": "j1"}
            }, {
                "name": "inner", "host": "c", "username": "k", "auth": {"method": "agent"}
            }]
        }))
        .unwrap();
        assert_eq!(req.jumps.len(), 2);
        assert_eq!(req.jumps[0].port, 2222);
        assert_eq!(
            req.jumps[0].trusted_fingerprint.as_deref(),
            Some("SHA256:x")
        );
        assert!(matches!(
            req.jumps[0].storage,
            Some(PasswordStorage::Forget { .. })
        ));
        assert_eq!(req.jumps[1].port, 22);
        assert!(req.jumps[1].trusted_fingerprint.is_none());

        // Older frontends send no `jumps`.
        let target: SshTarget = serde_json::from_value(serde_json::json!({
            "host": "h", "username": "u", "auth": {"method": "agent"}
        }))
        .unwrap();
        assert!(target.jumps.is_empty());
    }

    #[test]
    fn debug_of_jump_hosts_never_contains_their_passwords() {
        let mut req = request(22, password("hunter2"));
        req.jumps = vec![JumpHost {
            name: "b".into(),
            host: "b".into(),
            port: 22,
            username: "u".into(),
            auth: password("jumpsecret"),
            trusted_fingerprint: None,
            storage: remember("j1"),
        }];
        let dbg = format!("{req:?}");
        assert!(
            !dbg.contains("jumpsecret") && !dbg.contains("hunter2"),
            "{dbg}"
        );
    }

    #[tokio::test]
    async fn exec_returns_the_stdout_of_a_command_over_the_existing_connection() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();
        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;

        let out = mgr.exec(id, "mosh-server new").await.unwrap();

        assert_eq!(out, test_server::MOSH_CONNECT_REPLY);
        assert_eq!(server.exec_commands(), vec!["mosh-server new".to_string()]);
        // No second login: the command ran on the shell's connection.
        assert_eq!(server.open_connections(), 1);
        // The shell keeps working afterwards.
        mgr.write(id, b"ping").unwrap();
        assert!(wait_for(&mut rx, "ping").await.0.contains("ping"));
    }

    #[tokio::test]
    async fn exec_reports_a_failing_command_with_its_stderr() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();
        let id = mgr
            .connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;

        let err = mgr.exec(id, "nope").await.unwrap_err();

        let message = err.to_string();
        assert!(message.contains("exit status 127"), "{message}");
        assert!(message.contains("nope: not found"), "{message}");
    }

    #[tokio::test]
    async fn exec_on_an_unknown_session_fails() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        let err = mgr.exec(42, "true").await.unwrap_err();
        assert!(
            matches!(err, SshError::UnknownSession { id: 42 }),
            "{err:?}"
        );
    }

    // Password logins try the agent and the default identity files first (S1).

    #[tokio::test]
    async fn a_password_login_uses_an_accepted_default_key_without_sending_the_password() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &client_key);
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        mgr.connect(request(server.addr.port(), password("nope")), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 0, "the password was sent");
    }

    #[tokio::test]
    async fn a_stored_password_login_uses_an_accepted_default_key_without_reading_the_keyring() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_rsa"), &client_key);
        // No saved password: the login must not need one.
        let mgr = with_store(&dir, &server, &MemoryStore::shared());
        let (s, mut rx) = sink();

        mgr.connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 0);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn a_password_login_uses_an_accepted_agent_key_without_sending_the_password() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let Some((mut agent, socket)) = spawn_agent(&dir, &client_key).await else {
            return;
        };
        let mgr = trusting(&dir, server.addr.port(), &server.host_key).with_agent_socket(socket);
        let (s, mut rx) = sink();

        let result = mgr
            .connect(request(server.addr.port(), password("nope")), s)
            .await;
        let _ = agent.kill();
        let _ = agent.wait();
        result.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 0, "the password was sent");
    }

    #[tokio::test]
    async fn an_encrypted_default_key_is_skipped_and_the_password_logs_in() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        let encrypted = client_key
            .encrypt(
                &mut russh::keys::ssh_key::rand_core::UnwrapErr(rand::rngs::SysRng),
                "passphrase",
            )
            .unwrap();
        let pem = encrypted
            .to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap();
        std::fs::write(dir.path().join("id_ed25519"), pem.as_bytes()).unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        mgr.connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(
            server.publickey_attempts(),
            0,
            "the encrypted key was offered"
        );
        assert_eq!(server.password_attempts(), 1);
    }

    #[tokio::test]
    async fn rejected_default_keys_fall_back_to_the_stored_password() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &key_from_seed(20));
        write_key(&dir.path().join("id_ecdsa"), &key_from_seed(21));
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
        assert_eq!(server.publickey_attempts(), 2);
        assert_eq!(server.password_attempts(), 1);
    }

    #[tokio::test]
    async fn rejected_default_keys_without_a_stored_password_are_secret_missing() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &key_from_seed(20));
        let mgr = with_store(&dir, &server, &MemoryStore::shared());
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), stored("s1")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::SecretMissing), "got {err:?}");
        assert_eq!(
            server.publickey_attempts(),
            1,
            "the default key was not tried first"
        );
        assert_eq!(server.password_attempts(), 0);
    }

    #[tokio::test]
    async fn rejected_default_keys_then_a_wrong_password_is_auth_failed() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &key_from_seed(20));
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, _rx) = sink();

        let err = mgr
            .connect(request(server.addr.port(), password("nope")), s)
            .await
            .unwrap_err();
        assert!(matches!(err, SshError::AuthFailed), "got {err:?}");
        assert_eq!(server.password_attempts(), 1);
    }

    #[tokio::test]
    async fn the_password_still_gets_a_chance_when_the_server_drops_after_too_many_keys() {
        // Disconnects at the third attempt, like OpenSSH with `MaxAuthTries 2`.
        let server = test_server::start_limited(1, None, 2).await;
        let dir = tempfile::tempdir().unwrap();
        for (name, seed) in [("id_ed25519", 20), ("id_ecdsa", 21), ("id_rsa", 22)] {
            write_key(&dir.path().join(name), &key_from_seed(seed));
        }
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, mut rx) = sink();

        mgr.connect(request(server.addr.port(), password(PASSWORD)), s)
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(server.password_attempts(), 1);
    }

    #[tokio::test]
    async fn remember_saves_nothing_when_a_default_key_logged_in() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &client_key);
        let store = MemoryStore::shared();
        let mgr = with_store(&dir, &server, &store);
        let (s, _rx) = sink();

        mgr.connect_with(
            request(server.addr.port(), password("unverified")),
            remember("s1"),
            s,
        )
        .await
        .unwrap();
        assert_eq!(
            store.get("s1").unwrap(),
            None,
            "an unverified password was saved"
        );
    }

    #[tokio::test]
    async fn a_key_file_login_does_not_try_the_default_keys() {
        let client_key = key_from_seed(9);
        let server = test_server::start(1, Some(client_key.public_key().clone())).await;
        let dir = tempfile::tempdir().unwrap();
        write_key(&dir.path().join("id_ed25519"), &key_from_seed(20));
        let keys = tempfile::tempdir().unwrap();
        let key_path = keys.path().join("chosen");
        write_key(&key_path, &client_key);
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let (s, _rx) = sink();

        let auth = SshAuth::Key {
            path: key_path.to_string_lossy().into(),
            passphrase: None,
            passphrase_command: None,
        };
        mgr.connect(request(server.addr.port(), auth), s)
            .await
            .unwrap();
        assert_eq!(server.publickey_attempts(), 1);
    }

    #[tokio::test]
    async fn a_password_jump_host_logs_in_with_a_default_key() {
        let client_key = key_from_seed(9);
        let bastion = test_server::start(2, Some(client_key.public_key().clone())).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        write_key(&dir.path().join("id_ed25519"), &client_key);
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password("nope"))];
        let (s, mut rx) = sink();

        mgr.connect(req, s).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert_eq!(bastion.password_attempts(), 0, "the jump password was sent");
        assert_eq!(target.publickey_attempts(), 1);
        assert_eq!(target.password_attempts(), 1);
    }

    // Shell options: agent forwarding (S1) and tmux (S2).

    /// A shell opened like the app opens one, with `options`.
    async fn shell_with(
        mgr: &SshManager,
        req: ConnectRequest,
        options: ShellOptions,
    ) -> Result<(u32, UnboundedReceiver<Event>), SshError> {
        let (s, rx) = sink();
        let id = mgr
            .connect_reporting_loss(req, options, None, s, || {})
            .await?;
        Ok((id, rx))
    }

    #[cfg(unix)]
    fn forwarding() -> ShellOptions {
        ShellOptions {
            forward_agent: true,
            ..ShellOptions::default()
        }
    }

    fn in_tmux(name: &str) -> ShellOptions {
        ShellOptions {
            tmux_session: Some(name.into()),
            ..ShellOptions::default()
        }
    }

    #[tokio::test]
    async fn without_forwarding_no_agent_is_requested_and_agent_channels_are_refused() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let (id, mut rx) = shell_with(&mgr, req, ShellOptions::default())
            .await
            .unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.write(id, b"agent?").unwrap();
        let out = wait_for(&mut rx, "agent=").await.0;
        assert!(out.contains("agent=refused"), "output was {out:?}");
        assert_eq!(server.agent_requests(), 0);
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn forwarding_requests_the_agent_and_its_channels_reach_the_local_agent() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let Some((mut agent, socket)) = spawn_agent(&dir, &key_from_seed(9)).await else {
            return;
        };
        let mgr = trusting(&dir, server.addr.port(), &server.host_key).with_agent_socket(socket);
        let req = request(server.addr.port(), password(PASSWORD));

        let (id, mut rx) = shell_with(&mgr, req, forwarding()).await.unwrap();
        let out = wait_for(&mut rx, "welcome").await.0;
        mgr.write(id, b"agent?").unwrap();
        let reply = wait_for(&mut rx, "agent").await.0;
        let _ = agent.kill();
        let _ = agent.wait();
        assert!(!out.contains("\x1b[33m"), "output was {out:?}");
        assert_eq!(server.agent_requests(), 1);
        assert!(reply.contains("agent-keys=1"), "output was {reply:?}");
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn forwarding_without_an_agent_opens_the_session_with_one_warning() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key)
            .with_agent_socket(dir.path().join("no-agent.sock"));
        let req = request(server.addr.port(), password(PASSWORD));

        let (id, mut rx) = shell_with(&mgr, req, forwarding()).await.unwrap();
        let out = wait_for(&mut rx, "welcome").await.0;
        let warning = "\r\n\x1b[33mSSH agent forwarding is off for this session: \
                       no SSH agent is available (";
        assert!(out.starts_with(warning), "output was {out:?}");
        assert_eq!(out.matches("\x1b[33m").count(), 1, "output was {out:?}");
        assert_eq!(server.agent_requests(), 0);
        mgr.write(id, b"agent?").unwrap();
        let reply = wait_for(&mut rx, "agent=").await.0;
        assert!(reply.contains("agent=refused"), "output was {reply:?}");
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn forwarding_never_reaches_the_jump_hosts() {
        let bastion = test_server::start(2, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let Some((mut agent, socket)) = spawn_agent(&dir, &key_from_seed(9)).await else {
            return;
        };
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target])).with_agent_socket(socket);
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];

        let (id, mut rx) = shell_with(&mgr, req, forwarding()).await.unwrap();
        wait_for(&mut rx, "welcome").await;
        mgr.write(id, b"agent?").unwrap();
        let reply = wait_for(&mut rx, "agent").await.0;
        let _ = agent.kill();
        let _ = agent.wait();
        assert_eq!(bastion.agent_requests(), 0);
        assert_eq!(target.agent_requests(), 1);
        assert!(reply.contains("agent-keys=1"), "output was {reply:?}");
    }

    #[test]
    fn tmux_session_names_are_letters_digits_dots_underscores_and_dashes() {
        for name in ["plexus", "Work.2_main-x", &"a".repeat(64)] {
            assert!(valid_tmux_session(name), "{name:?} should be valid");
        }
        for name in [
            "",
            &"a".repeat(65),
            "a b",
            "a'b",
            "a;b",
            "$(x)",
            "a:b",
            "ñ",
            "a\nb",
        ] {
            assert!(!valid_tmux_session(name), "{name:?} should be invalid");
        }
    }

    #[test]
    fn the_tmux_command_attaches_or_falls_back_to_the_login_shell() {
        assert_eq!(
            tmux_command("plexus"),
            "command -v tmux >/dev/null 2>&1 && exec tmux new -A -s 'plexus' \
             || echo 'PlexusTerm: tmux is not installed on this server, so this is the login shell.' \
             && exec \"$SHELL\" -l"
        );
        assert!(tmux_command("plexus").starts_with(test_server::TMUX_EXEC_PREFIX));
    }

    /// Runs `command` with `shell -c` (fish without its configuration) in a clean environment
    /// whose PATH is `path` and SHELL is `login_shell`; None when `shell` is not installed.
    #[cfg(unix)]
    fn run_in(shell: &str, command: &str, path: &Path, login_shell: &Path) -> Option<String> {
        let program = platform::find_program(shell, &std::env::var_os("PATH")?)?;
        let home = tempfile::tempdir().unwrap();
        let mut run = std::process::Command::new(program);
        if shell == "fish" {
            run.arg("--no-config");
        }
        let output = run
            .arg("-c")
            .arg(command)
            .env_clear()
            .env("PATH", path)
            .env("HOME", home.path())
            .env("SHELL", login_shell)
            .output()
            .unwrap();
        Some(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    #[test]
    #[cfg(unix)]
    fn the_tmux_command_works_in_sh_bash_zsh_and_fish_login_shells() {
        use std::os::unix::fs::PermissionsExt;
        let with_tmux = tempfile::tempdir().unwrap();
        let fake = with_tmux.path().join("tmux");
        std::fs::write(&fake, "#!/bin/sh\necho \"tmux $*\"\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let without_tmux = tempfile::tempdir().unwrap();
        // Stands for the login shell: prints the arguments it was started with.
        let login = with_tmux.path().join("login-shell");
        std::fs::write(&login, "#!/bin/sh\necho \"login $*\"\n").unwrap();
        std::fs::set_permissions(&login, std::fs::Permissions::from_mode(0o755)).unwrap();

        let command = tmux_command("work");
        let mut tried = 0;
        for shell in ["sh", "bash", "zsh", "fish"] {
            let Some(attached) = run_in(shell, &command, with_tmux.path(), &login) else {
                eprintln!("skipping {shell}: not installed");
                continue;
            };
            tried += 1;
            assert_eq!(attached, "tmux new -A -s work\n", "{shell}");
            let fallback = run_in(shell, &command, without_tmux.path(), &login).unwrap();
            assert_eq!(
                fallback,
                "PlexusTerm: tmux is not installed on this server, so this is the login shell.\n\
                 login -l\n",
                "{shell}"
            );
        }
        assert!(tried > 0, "no shell to try the command in");
    }

    #[tokio::test]
    async fn a_tmux_session_runs_its_command_instead_of_the_shell() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let (id, mut rx) = shell_with(&mgr, req, in_tmux("work")).await.unwrap();
        let out = wait_for(&mut rx, "tmux").await.0;
        assert!(!out.contains("welcome"), "output was {out:?}");
        mgr.write(id, b"ping").unwrap();
        assert!(wait_for(&mut rx, "ping").await.0.contains("ping"));
        assert_eq!(server.exec_commands(), vec![tmux_command("work")]);
    }

    #[tokio::test]
    async fn every_reconnection_of_a_tmux_tab_resumes_the_same_session() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        for _ in 0..2 {
            let req = request(server.addr.port(), password(PASSWORD));
            let (id, mut rx) = shell_with(&mgr, req, in_tmux("work")).await.unwrap();
            wait_for(&mut rx, "tmux").await;
            mgr.write(id, b"drop").unwrap();
            wait_for(&mut rx, "").await;
        }
        assert_eq!(server.exec_commands(), vec![tmux_command("work"); 2]);
    }

    #[tokio::test]
    async fn without_tmux_the_plain_shell_is_started() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let (_, mut rx) = shell_with(&mgr, req, ShellOptions::default())
            .await
            .unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
        assert!(server.exec_commands().is_empty());
        assert_eq!(server.agent_requests(), 0);
    }

    #[tokio::test]
    async fn an_invalid_tmux_session_name_fails_before_connecting() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let Err(err) = shell_with(&mgr, req, in_tmux("x'; rm -rf ~; '")).await else {
            panic!("an invalid name connected");
        };
        assert!(matches!(err, SshError::Connection { .. }), "{err:?}");
        assert_eq!(server.password_attempts(), 0);
        assert!(server.exec_commands().is_empty());
    }

    #[test]
    fn shell_options_deserialize_from_camel_case_and_default_to_none() {
        let options: ShellOptions = serde_json::from_value(
            serde_json::json!({"forwardAgent": true, "tmuxSession": "work"}),
        )
        .unwrap();
        assert!(options.forward_agent);
        assert_eq!(options.tmux_session.as_deref(), Some("work"));
        let none: ShellOptions = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!none.forward_agent);
        assert_eq!(none.tmux_session, None);
        assert_eq!(none.proxy_command, None);
        let proxied: ShellOptions =
            serde_json::from_value(serde_json::json!({"proxyCommand": "nc %h %p"})).unwrap();
        assert_eq!(proxied.proxy_command.as_deref(), Some("nc %h %p"));
    }

    // Proxy commands (terminal-features-3 S1).

    /// A proxy command that connects its stdio to `%h:%p` over TCP, from the tools installed
    /// here; None (the test is skipped) when there is none.
    #[cfg(unix)]
    fn bridge() -> Option<&'static str> {
        let path = std::env::var_os("PATH")?;
        if platform::find_program("socat", &path).is_some() {
            Some("socat STDIO TCP:%h:%p")
        } else if platform::find_program("nc", &path).is_some() {
            Some("nc %h %p")
        } else {
            eprintln!("skipped: neither socat nor nc is installed");
            None
        }
    }

    fn proxied(command: &str) -> ShellOptions {
        ShellOptions {
            proxy_command: Some(command.into()),
            ..ShellOptions::default()
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn a_proxied_session_speaks_ssh_over_the_command_and_shows_its_stderr_in_yellow() {
        let Some(bridge) = bridge() else { return };
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));
        let command = format!("echo proxy says hi >&2; {bridge}");

        let (id, mut rx) = shell_with(&mgr, req, proxied(&command)).await.unwrap();
        let out = wait_for(&mut rx, "welcome").await.0;
        let out = out + &wait_for(&mut rx, "proxy says hi").await.0;
        assert!(out.contains("welcome"), "output was {out:?}");
        assert!(
            out.contains("\x1b[33mproxy says hi\x1b[0m\r\n"),
            "output was {out:?}"
        );
        mgr.write(id, b"echo").unwrap();
        assert_eq!(server.password_attempts(), 1);
    }

    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn the_proxy_command_and_what_it_started_end_with_the_session() {
        let Some(bridge) = bridge() else { return };
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));
        let pid_file = dir.path().join("proxy.pid");
        // `sleep` and the bridge are children of the shell, which stays: the whole group must end.
        let command = format!("echo $$ > {}; sleep 600 & {bridge}", pid_file.display());

        let (id, mut rx) = shell_with(&mgr, req, proxied(&command)).await.unwrap();
        wait_for(&mut rx, "welcome").await;
        let group: i32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(
            live_in_group(group) >= 2,
            "the proxy command is not running"
        );

        mgr.close(id).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while live_in_group(group) > 0 && std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(
            live_in_group(group),
            0,
            "the proxy command outlived its session"
        );
    }

    /// Processes of process group `group` that are not zombies (read from /proc).
    #[cfg(target_os = "linux")]
    fn live_in_group(group: i32) -> usize {
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return 0;
        };
        entries
            .flatten()
            .filter_map(|entry| std::fs::read_to_string(entry.path().join("stat")).ok())
            .filter(|stat| {
                // `pid (comm) state ppid pgrp ...`; comm may hold spaces and parentheses.
                let fields: Vec<&str> = stat
                    .rsplit_once(')')
                    .map(|(_, rest)| rest.split_whitespace().collect())
                    .unwrap_or_default();
                fields.len() > 2 && fields[0] != "Z" && fields[2] == group.to_string()
            })
            .count()
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn a_failing_proxy_command_fails_the_connection_with_its_stderr() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let Err(err) = shell_with(&mgr, req, proxied("echo no route to bastion >&2; exit 3")).await
        else {
            panic!("a failing proxy command connected");
        };
        let SshError::Connection { message } = &err else {
            panic!("got {err:?}");
        };
        assert!(message.contains("no route to bastion"), "{message}");
        assert_eq!(server.password_attempts(), 0);
    }

    #[tokio::test]
    async fn a_proxy_command_with_jump_hosts_is_refused_before_anything_runs() {
        let bastion = test_server::start(1, None).await;
        let target = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(trust_all(&dir, &[&bastion, &target]));
        let mut req = request(target.addr.port(), password(PASSWORD));
        req.jumps = vec![jump("bastion", &bastion, password(PASSWORD))];
        let marker = dir.path().join("ran");

        let command = format!("touch {}", marker.display());
        let Err(err) = shell_with(&mgr, req, proxied(&command)).await else {
            panic!("jump hosts and a proxy command connected");
        };
        assert!(
            err.to_string()
                .contains("cannot be combined with jump hosts"),
            "{err}"
        );
        assert!(!marker.exists(), "the proxy command ran");
        assert_eq!(bastion.password_attempts(), 0);
    }

    #[tokio::test]
    async fn a_host_the_shell_would_interpret_is_refused_before_the_command_runs() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = SshManager::new(dir.path().join("known_hosts"));
        let marker = dir.path().join("ran");
        let mut req = request(22, password(PASSWORD));
        req.host = format!("x;touch {}", marker.display());

        let Err(err) = shell_with(&mgr, req, proxied("nc %h %p")).await else {
            panic!("connected");
        };
        assert!(
            err.to_string()
                .contains("cannot be used in a proxy command"),
            "{err}"
        );
        assert!(!marker.exists(), "the host reached the shell");
    }

    #[tokio::test]
    async fn a_blank_proxy_command_connects_over_tcp_as_before() {
        let server = test_server::start(1, None).await;
        let dir = tempfile::tempdir().unwrap();
        let mgr = trusting(&dir, server.addr.port(), &server.host_key);
        let req = request(server.addr.port(), password(PASSWORD));

        let (_, mut rx) = shell_with(&mgr, req, proxied("   ")).await.unwrap();
        assert!(wait_for(&mut rx, "welcome").await.0.contains("welcome"));
    }

    #[test]
    fn a_proxied_target_deserializes_the_target_and_its_proxy_command() {
        let value = serde_json::json!({
            "host": "h", "port": 2222, "username": "u", "auth": {"method": "agent"},
            "proxyCommand": "cloudflared access ssh --hostname %h",
        });
        let proxied: ProxiedTarget = serde_json::from_value(value).unwrap();
        assert_eq!(proxied.target.host, "h");
        assert_eq!(proxied.target.port, 2222);
        assert!(matches!(proxied.target.auth, SshAuth::Agent));
        assert_eq!(
            proxied.proxy_command.as_deref(),
            Some("cloudflared access ssh --hostname %h")
        );
        let plain: ProxiedTarget = serde_json::from_value(
            serde_json::json!({"host": "h", "username": "u", "auth": {"method": "agent"}}),
        )
        .unwrap();
        assert_eq!(plain.proxy_command, None);
        assert_eq!(plain.target.port, 22);
    }
}
