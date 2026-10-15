//! Mosh sessions (S17.2): `mosh-server` is started over SSH (with the full SSH login
//! rules: known_hosts, jump hosts, saved passwords), then the local `mosh-client` runs
//! in a PTY and talks UDP to that server.
//!
//! The session key printed by `mosh-server` (`MOSH CONNECT <port> <key>`) only travels
//! through the environment of `mosh-client` (`MOSH_KEY`): never on its command line, in
//! an error, a log or anything sent to the frontend.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use russh::ChannelMsg;

use crate::platform::{self, Os};
use crate::pty::{ChildEnv, PtyManager, SpawnRequest};
use crate::ssh::{
    Chain, ConnectRequest, Connection, PasswordStorage, SshError, SshManager, SshTarget,
    connect_authenticated, disconnect_jumps,
};
use crate::terminal::TerminalSink;

/// Run on the server when the session does not override it.
pub const DEFAULT_SERVER_COMMAND: &str = "mosh-server new -s -c 256 -l LANG=en_US.UTF-8";

/// How long `mosh-server` may take to print its `MOSH CONNECT` line.
const SERVER_TIMEOUT: Duration = Duration::from_secs(20);

/// Most server output kept while waiting for `MOSH CONNECT`.
const MAX_SERVER_OUTPUT: usize = 64 * 1024;

const CLIENT_PROGRAM: &str = "mosh-client";

const CLIENT_MISSING: &str = "mosh-client not found — install mosh";
const WINDOWS_CLIENT_MISSING: &str = "Mosh is not available on Windows";
const SERVER_MISSING: &str = "mosh-server not found on the server — install mosh there";

/// A saved or typed SSH login plus the command that starts the Mosh server.
///
/// Wire shape (camelCase): the fields of the SSH `ConnectRequest` (`host`, `port`,
/// `username`, `auth`, `cols`, `rows`, `trustedFingerprint`, `jumps`) and an optional
/// `serverCommand`.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoshRequest {
    #[serde(flatten)]
    pub login: ConnectRequest,
    #[serde(default)]
    pub server_command: Option<String>,
}

/// Where the Mosh server listens and the key of the session. Deliberately not `Debug`
/// with the key: see the module docs.
pub struct MoshConnect {
    pub port: u16,
    key: String,
}

impl std::fmt::Debug for MoshConnect {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MoshConnect")
            .field("port", &self.port)
            .field("key", &"<redacted>")
            .finish()
    }
}

/// A Mosh key: 22 characters of unpadded base64 (128 bits).
fn valid_key(key: &str) -> bool {
    key.len() == 22
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
}

/// Finds `MOSH CONNECT <port> <key>` in the server output.
pub fn parse_connect(output: &str) -> Option<MoshConnect> {
    output.lines().find_map(|line| {
        let mut words = line
            .trim()
            .strip_prefix("MOSH CONNECT ")?
            .split_whitespace();
        let port = words.next()?.parse::<u16>().ok().filter(|p| *p != 0)?;
        let key = words.next().filter(|k| valid_key(k))?;
        Some(MoshConnect {
            port,
            key: key.to_string(),
        })
    })
}

fn failure(message: impl Into<String>) -> SshError {
    SshError::Connection {
        message: message.into(),
    }
}

/// The error for a missing `mosh-client`: Windows has no packaged Mosh, so say so plainly.
fn client_missing(os: Os) -> &'static str {
    match os {
        Os::Unix => CLIENT_MISSING,
        Os::Windows => WINDOWS_CLIENT_MISSING,
    }
}

/// Explains why the server command ended without a `MOSH CONNECT` line.
fn server_failed(output: &str, exit_status: Option<u32>) -> SshError {
    if exit_status == Some(127)
        || output.contains("command not found")
        || output.contains("mosh-server: not found")
    {
        return failure(SERVER_MISSING);
    }
    // Never echo a line that may hold a key, however it is spelled.
    if output.contains("MOSH") && output.contains("CONNECT") {
        return failure("mosh-server printed an unreadable MOSH CONNECT line");
    }
    let tail: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    let tail = tail[tail.len().saturating_sub(3)..].join(" / ");
    let tail: String = tail.chars().take(300).collect();
    let status = exit_status.map_or(String::new(), |s| format!(" (exit status {s})"));
    if tail.is_empty() {
        failure(format!("mosh-server did not start{status}"))
    } else {
        failure(format!("mosh-server did not start{status}: {tail}"))
    }
}

/// Runs `command` on `connection` and waits for its `MOSH CONNECT` line.
async fn start_server(
    connection: &Connection,
    command: &str,
    timeout: Duration,
) -> Result<MoshConnect, SshError> {
    let mut channel = connection
        .channel_open_session()
        .await
        .map_err(|err| failure(format!("cannot run mosh-server: {err}")))?;
    channel
        .exec(true, command)
        .await
        .map_err(|err| failure(format!("cannot run mosh-server: {err}")))?;

    let mut output = Vec::new();
    let mut exit_status = None;
    let wait = async {
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    if output.len() < MAX_SERVER_OUTPUT {
                        output.extend_from_slice(&data);
                    }
                    if let Some(connect) = parse_connect(&String::from_utf8_lossy(&output)) {
                        return Some(connect);
                    }
                }
                ChannelMsg::ExitStatus { exit_status: s } => exit_status = Some(s),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        None
    };
    match tokio::time::timeout(timeout, wait).await {
        Ok(Some(connect)) => Ok(connect),
        Ok(None) => Err(server_failed(
            &String::from_utf8_lossy(&output),
            exit_status,
        )),
        Err(_) => Err(failure(format!(
            "mosh-server did not answer within {} s",
            timeout.as_secs()
        ))),
    }
}

/// Starts Mosh sessions: the server over SSH, the client in a PTY of [`PtyManager`].
pub struct MoshLauncher {
    /// Directories searched for `mosh-client`; `$PATH` when `None` (tests override it).
    search_path: Option<OsString>,
    server_timeout: Duration,
}

impl Default for MoshLauncher {
    fn default() -> Self {
        Self {
            search_path: None,
            server_timeout: SERVER_TIMEOUT,
        }
    }
}

impl MoshLauncher {
    #[cfg(all(test, unix))]
    fn with_search_path(mut self, path: &std::path::Path) -> Self {
        self.search_path = Some(path.as_os_str().to_owned());
        self
    }

    #[cfg(all(test, unix))]
    fn with_server_timeout(mut self, timeout: Duration) -> Self {
        self.server_timeout = timeout;
        self
    }

    fn client_path(&self) -> Result<PathBuf, SshError> {
        let path = self
            .search_path
            .clone()
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        platform::find_program(&platform::program_name(CLIENT_PROGRAM), &path)
            .ok_or_else(|| failure(client_missing(platform::CURRENT)))
    }

    /// Logs in over SSH (applying `storage` like an SSH tab), starts the server, closes
    /// the SSH connection and runs `mosh-client` in a PTY. Returns the PTY session id;
    /// the session is then driven with the PTY commands.
    pub async fn connect(
        &self,
        ssh: &SshManager,
        ptys: &PtyManager,
        req: MoshRequest,
        storage: Option<PasswordStorage>,
        sink: impl TerminalSink,
    ) -> Result<u32, SshError> {
        // Checked first: a server started for a client that cannot run would linger.
        let client = self.client_path()?;
        let MoshRequest {
            login,
            server_command,
        } = req;
        let command = server_command
            .map(|c| c.trim().to_string())
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| DEFAULT_SERVER_COMMAND.to_string());
        let host = login.host.trim().to_string();
        let target = SshTarget {
            host: host.clone(),
            port: login.port,
            username: login.username,
            auth: login.auth,
            jumps: login.jumps,
        };
        let Chain {
            connection,
            jumps,
            warnings,
        } = connect_authenticated(
            target,
            login.trusted_fingerprint,
            storage,
            ssh.context(),
            None,
        )
        .await?;
        let started = start_server(&connection, &command, self.server_timeout).await;
        let _ = connection
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
        disconnect_jumps(&jumps).await;
        let server = started?;

        // mosh-client only takes a numeric address.
        let ip = tokio::net::lookup_host((host.as_str(), server.port))
            .await
            .ok()
            .and_then(|mut addrs| addrs.next())
            .map(|addr| addr.ip().to_string())
            .ok_or_else(|| failure(format!("cannot resolve {host} for mosh-client")))?;

        for warning in warnings {
            sink.data(format!("\r\n\x1b[33m{warning}\x1b[0m\r\n"));
        }
        let request = SpawnRequest {
            program: Some(client.to_string_lossy().into_owned()),
            args: vec![ip, server.port.to_string()],
            cwd: None,
            cols: login.cols,
            rows: login.rows,
            env: ChildEnv::new([("MOSH_KEY".to_string(), server.key)]),
        };
        ptys.spawn(request, sink)
            .map_err(|err| failure(format!("cannot start mosh-client: {err}")))
    }
}

// The tests fake `mosh-client` with a shell script.
#[cfg(all(test, unix))]
mod tests;
