//! SSH tunnels: local (`-L`), remote (`-R`) and dynamic SOCKS5 (`-D`) port forwards.

mod socks;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::{Channel, client};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use tokio::sync::oneshot;
use tokio::task::JoinSet;

#[cfg(test)]
use crate::ssh::SshAuth;
use crate::ssh::{Connection, ForwardedChannel, SshError, SshTarget, connect_authenticated};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TunnelKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelDefinition {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: TunnelKind,
    pub session_id: String,
    pub listen_host: String,
    pub listen_port: u16,
    /// Unused for dynamic tunnels.
    #[serde(default)]
    pub dest_host: String,
    #[serde(default)]
    pub dest_port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum TunnelStatus {
    Stopped,
    Starting,
    Running,
    Error { message: String },
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct StatusUpdate {
    pub id: String,
    pub status: TunnelStatus,
}

#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("cannot listen on {address}: {message}")]
    Listen { address: String, message: String },
    #[error("the tunnel is already running")]
    AlreadyRunning { id: String },
}

type Notify = Arc<dyn Fn(StatusUpdate) + Send + Sync>;

/// How often a running tunnel checks that its SSH connection is still open.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);
/// Upper bound for the polite part of stopping (cancel forward, disconnect).
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// Resources of a running tunnel. Dropping it aborts the listener, the
/// forwarded connections and the watcher, which releases the SSH connection.
struct Running {
    tasks: JoinSet<()>,
    connection: Arc<Connection>,
    /// Address and port the server listens on for a remote forward.
    remote_forward: Option<(String, u32)>,
}

impl Running {
    /// Stops every task first (closing the listener), then ends the SSH connection.
    async fn shutdown(mut self) {
        self.tasks.shutdown().await;
        let connection = self.connection;
        let polite = async {
            if let Some((address, port)) = self.remote_forward {
                let _ = connection.cancel_tcpip_forward(address, port).await;
            }
            let _ = connection
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
        };
        let _ = tokio::time::timeout(STOP_TIMEOUT, polite).await;
    }
}

struct Entry {
    status: TunnelStatus,
    /// Start attempt that owns this entry; a stop or a new start changes it.
    generation: u64,
    running: Option<Running>,
    /// Set while starting: firing it aborts the start and releases its listener.
    cancel: Option<oneshot::Sender<()>>,
}

struct Shared {
    entries: Mutex<HashMap<String, Entry>>,
    next_generation: AtomicU64,
    notify: Notify,
}

impl Shared {
    fn generation(&self) -> u64 {
        self.next_generation.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Marks a running tunnel as failed, unless it was stopped or restarted meanwhile.
    fn fail(&self, id: &str, generation: u64, message: String) {
        let running = {
            let mut entries = self.entries.lock().unwrap();
            match entries.get_mut(id) {
                Some(entry) if entry.generation == generation => {
                    entry.status = TunnelStatus::Error {
                        message: message.clone(),
                    };
                    entry.running.take()
                }
                _ => return,
            }
        };
        (self.notify)(StatusUpdate {
            id: id.to_string(),
            status: TunnelStatus::Error { message },
        });
        drop(running);
    }
}

pub struct TunnelManager {
    known_hosts: PathBuf,
    /// Overrides `SSH_AUTH_SOCK` (used by tests).
    agent_socket: Option<PathBuf>,
    shared: Arc<Shared>,
}

impl TunnelManager {
    /// `notify` receives every status change.
    pub fn new(
        known_hosts: PathBuf,
        notify: impl Fn(StatusUpdate) + Send + Sync + 'static,
    ) -> Self {
        Self {
            known_hosts,
            agent_socket: None,
            shared: Arc::new(Shared {
                entries: Mutex::new(HashMap::new()),
                next_generation: AtomicU64::new(0),
                notify: Arc::new(notify),
            }),
        }
    }

    /// Uses the current user's `~/.ssh/known_hosts`, like SSH sessions.
    pub fn for_current_user(notify: impl Fn(StatusUpdate) + Send + Sync + 'static) -> Self {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        Self::new(home.join(".ssh").join("known_hosts"), notify)
    }

    fn notify(&self, id: &str, status: TunnelStatus) {
        (self.shared.notify)(StatusUpdate {
            id: id.to_string(),
            status,
        });
    }

    /// Opens the tunnel's SSH connection and starts forwarding.
    pub async fn start(
        &self,
        tunnel: TunnelDefinition,
        target: SshTarget,
        trusted_fingerprint: Option<String>,
    ) -> Result<(), TunnelError> {
        let id = tunnel.id.clone();
        let generation = self.shared.generation();
        let (cancel, cancelled) = oneshot::channel();
        {
            let mut entries = self.shared.entries.lock().unwrap();
            if let Some(entry) = entries.get(&id)
                && matches!(entry.status, TunnelStatus::Starting | TunnelStatus::Running)
            {
                return Err(TunnelError::AlreadyRunning { id });
            }
            entries.insert(
                id.clone(),
                Entry {
                    status: TunnelStatus::Starting,
                    generation,
                    running: None,
                    cancel: Some(cancel),
                },
            );
        }
        self.notify(&id, TunnelStatus::Starting);

        let result = tokio::select! {
            result = self.open(tunnel, target, trusted_fingerprint, generation) => result,
            // `stop` already marked the tunnel stopped; dropping `open` releases its listener.
            _ = cancelled => return Ok(()),
        };

        let status = match &result {
            Ok(_) => TunnelStatus::Running,
            Err(err) => TunnelStatus::Error {
                message: err.to_string(),
            },
        };
        let (outcome, orphan) = {
            let mut entries = self.shared.entries.lock().unwrap();
            match entries.get_mut(&id).filter(|e| e.generation == generation) {
                Some(entry) => {
                    entry.status = status.clone();
                    (
                        Some(result.map(|running| entry.running = Some(running))),
                        None,
                    )
                }
                None => (None, result.ok()),
            }
        };
        match outcome {
            Some(outcome) => {
                self.notify(&id, status);
                outcome
            }
            None => {
                // Stopped while starting: release what was opened.
                if let Some(running) = orphan {
                    running.shutdown().await;
                }
                Ok(())
            }
        }
    }

    async fn open(
        &self,
        tunnel: TunnelDefinition,
        target: SshTarget,
        trusted_fingerprint: Option<String>,
        generation: u64,
    ) -> Result<Running, TunnelError> {
        let default_host = match tunnel.kind {
            TunnelKind::Remote => "localhost",
            TunnelKind::Local | TunnelKind::Dynamic => "127.0.0.1",
        };
        let listen_host = match tunnel.listen_host.trim() {
            "" => default_host.to_string(),
            host => host.to_string(),
        };
        let listen_address = address_label(&listen_host, tunnel.listen_port);
        let dest = (tunnel.dest_host.clone(), tunnel.dest_port);

        // Local listeners are bound first so a busy port fails before connecting.
        let listener = match tunnel.kind {
            TunnelKind::Remote => None,
            TunnelKind::Local | TunnelKind::Dynamic => Some(
                TcpListener::bind((listen_host.as_str(), tunnel.listen_port))
                    .await
                    .map_err(|err| TunnelError::Listen {
                        address: listen_address.clone(),
                        message: listen_message(&err),
                    })?,
            ),
        };
        let (forwarded_tx, forwarded_rx) = match tunnel.kind {
            TunnelKind::Remote => {
                let (tx, rx) = unbounded_channel();
                (Some(tx), Some(rx))
            }
            _ => (None, None),
        };
        let connection = Arc::new(
            connect_authenticated(
                target,
                trusted_fingerprint,
                &self.known_hosts,
                self.agent_socket.as_deref(),
                forwarded_tx,
            )
            .await?,
        );

        let mut tasks = JoinSet::new();
        let mut remote_forward = None;
        match (listener, forwarded_rx) {
            (Some(listener), _) => {
                tasks.spawn(serve_listener(
                    listener,
                    connection.clone(),
                    tunnel.kind,
                    dest,
                ));
            }
            (None, Some(forwarded)) => {
                let requested = u32::from(tunnel.listen_port);
                let allocated = connection
                    .tcpip_forward(listen_host.clone(), requested)
                    .await
                    .map_err(|err| TunnelError::Listen {
                        address: format!("{listen_address} on the SSH server"),
                        message: match err {
                            russh::Error::RequestDenied => {
                                "the server refused (port in use or forwarding disabled)".into()
                            }
                            other => other.to_string(),
                        },
                    })?;
                // Servers only report the port when they chose it (request for port 0).
                let port = if allocated == 0 { requested } else { allocated };
                remote_forward = Some((listen_host, port));
                tasks.spawn(serve_forwarded(forwarded, dest));
            }
            (None, None) => unreachable!("every tunnel kind has a listener or a forward"),
        }
        tasks.spawn(watch_connection(
            self.shared.clone(),
            tunnel.id,
            generation,
            connection.clone(),
        ));
        Ok(Running {
            tasks,
            connection,
            remote_forward,
        })
    }

    /// Stops the tunnel: closes its listener, its forwarded connections and its SSH connection.
    pub async fn stop(&self, id: &str) {
        let running = {
            let mut entries = self.shared.entries.lock().unwrap();
            let Some(entry) = entries.get_mut(id) else {
                return;
            };
            entry.generation = self.shared.generation();
            entry.status = TunnelStatus::Stopped;
            if let Some(cancel) = entry.cancel.take() {
                let _ = cancel.send(());
            }
            entry.running.take()
        };
        self.notify(id, TunnelStatus::Stopped);
        if let Some(running) = running {
            running.shutdown().await;
        }
    }

    #[cfg(test)]
    fn status(&self, id: &str) -> TunnelStatus {
        self.shared
            .entries
            .lock()
            .unwrap()
            .get(id)
            .map_or(TunnelStatus::Stopped, |entry| entry.status.clone())
    }

    /// Status of every tunnel started since launch.
    pub fn statuses(&self) -> Vec<StatusUpdate> {
        self.shared
            .entries
            .lock()
            .unwrap()
            .iter()
            .map(|(id, entry)| StatusUpdate {
                id: id.clone(),
                status: entry.status.clone(),
            })
            .collect()
    }
}

/// `host:port`, with brackets around IPv6 addresses.
fn address_label(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn listen_message(err: &std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::AddrInUse => "the port is already in use".into(),
        std::io::ErrorKind::AddrNotAvailable => {
            "the address is not available on this machine".into()
        }
        std::io::ErrorKind::PermissionDenied => {
            "permission denied (ports below 1024 need privileges)".into()
        }
        _ => err.to_string(),
    }
}

/// Copies bytes both ways between a channel and a TCP stream until both sides close.
async fn pipe(channel: Channel<client::Msg>, mut tcp: TcpStream) {
    let mut stream = channel.into_stream();
    let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
}

/// Accepts local connections (local and dynamic tunnels) and forwards each one
/// through a `direct-tcpip` channel. Aborting it drops every open connection.
async fn serve_listener(
    listener: TcpListener,
    connection: Arc<Connection>,
    kind: TunnelKind,
    dest: (String, u16),
) {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((tcp, peer)) = accepted else {
                    // Usually out of file descriptors: back off instead of spinning.
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                };
                let connection = connection.clone();
                let dest = dest.clone();
                connections.spawn(async move {
                    // A failed connection only affects that client.
                    if kind == TunnelKind::Dynamic {
                        let _ = forward_socks(connection, tcp, peer).await;
                    } else {
                        let _ = forward_direct(connection, tcp, peer, dest).await;
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn forward_direct(
    connection: Arc<Connection>,
    tcp: TcpStream,
    peer: SocketAddr,
    (host, port): (String, u16),
) -> Result<(), russh::Error> {
    let channel = connection
        .channel_open_direct_tcpip(host, port.into(), peer.ip().to_string(), peer.port().into())
        .await?;
    pipe(channel, tcp).await;
    Ok(())
}

async fn forward_socks(
    connection: Arc<Connection>,
    mut tcp: TcpStream,
    peer: SocketAddr,
) -> Result<(), socks::SocksError> {
    let target = socks::handshake(&mut tcp).await?;
    let opened = connection
        .channel_open_direct_tcpip(
            target.host,
            target.port.into(),
            peer.ip().to_string(),
            peer.port().into(),
        )
        .await;
    let io = |err: std::io::Error| socks::SocksError::Io(err.to_string());
    match opened {
        Ok(channel) => {
            tcp.write_all(&socks::reply(socks::REPLY_SUCCEEDED))
                .await
                .map_err(io)?;
            pipe(channel, tcp).await;
        }
        Err(_) => {
            tcp.write_all(&socks::reply(socks::REPLY_GENERAL_FAILURE))
                .await
                .map_err(io)?;
        }
    }
    Ok(())
}

/// Connects every `forwarded-tcpip` channel of a remote tunnel to its local destination.
async fn serve_forwarded(mut forwarded: UnboundedReceiver<ForwardedChannel>, dest: (String, u16)) {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            next = forwarded.recv() => {
                let Some(channel) = next else { break };
                let dest = dest.clone();
                connections.spawn(async move {
                    match TcpStream::connect((dest.0.as_str(), dest.1)).await {
                        Ok(tcp) => pipe(channel, tcp).await,
                        Err(_) => {
                            let _ = channel.close().await;
                        }
                    }
                });
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
    // The connection ended; keep forwarding what is still open.
    while connections.join_next().await.is_some() {}
}

/// Reports a running tunnel as failed when its SSH connection closes.
async fn watch_connection(
    shared: Arc<Shared>,
    id: String,
    generation: u64,
    connection: Arc<Connection>,
) {
    loop {
        tokio::time::sleep(WATCH_INTERVAL).await;
        if connection.is_closed() {
            shared.fail(&id, generation, "the SSH connection was closed".into());
            return;
        }
    }
}

impl serde::Serialize for TunnelError {
    /// Same shape as `SshError` (`kind` tag), so the frontend handles both alike.
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let kind = match self {
            Self::Ssh(err) => return err.serialize(s),
            Self::Listen { .. } => "listen",
            Self::AlreadyRunning { .. } => "alreadyRunning",
        };
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("kind", kind)?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}
