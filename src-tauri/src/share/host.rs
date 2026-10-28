//! The host loop of one share (integration guide §4, §11): the relay WebSocket, reconnection with
//! back-off, pings, and what to do with every [`Action`] of the engine.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use plexusterm_share_client::sharer::{Action, Snapshot};
use plexusterm_share_protocol::content::Access;
use plexusterm_share_protocol::keys::{DerivedKeys, LinkId};
use plexusterm_share_protocol::wire::{EndReason, RelayToSharer, SharerToRelay};
use serde_json::json;
use tokio::net::TcpStream;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

use super::audit::{Audit, BURST_GAP_MS, Burst};
use super::marker::Marker;
use super::viewers::Viewers;
use super::{Command, Core, EndKind, LinkInfo, ShareEvent, now_ms, now_secs, qr_svg};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;
type Connecting = Pin<Box<dyn Future<Output = Result<Ws, String>> + Send>>;

/// Pings keep the relay connection under common proxy idle timeouts (PRD §5.4).
pub const PING: Duration = Duration::from_secs(20);
pub const MIN_BACKOFF: Duration = Duration::from_secs(1);
pub const MAX_BACKOFF: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// After Stop, how long to wait for the relay to confirm before ending anyway.
const STOP_WAIT: Duration = Duration::from_secs(5);

pub struct Setup {
    pub endpoint: String,
    pub origin: String,
    pub core: Arc<Core>,
    pub outbox: UnboundedReceiver<Action>,
    pub commands: UnboundedReceiver<Command>,
    pub events: Box<dyn Fn(ShareEvent) + Send + Sync>,
    pub audit: Option<Audit>,
    pub link_access: HashMap<LinkId, Access>,
    pub view_needs_approval: bool,
    pub auto_approve: bool,
    pub record_input: bool,
}

pub struct Host {
    s: Setup,
    viewers: Viewers,
    bursts: HashMap<u32, Burst>,
    /// The relay confirmed the share on the current connection; frames may flow.
    attached: bool,
    /// Changes made while the relay was unreachable (a Disconnect's rotate and kick, a new end
    /// time, a denial), sent once the share is back so none is lost.
    held: Vec<String>,
}

/// What to do with a message for the relay while the share is not attached.
#[derive(Debug, PartialEq, Eq)]
enum Pending {
    /// Part of attaching (`create`, `resume`) or worthless later (`ping`): send it now.
    Send,
    /// A change the relay must still get: keep it for when the share is back.
    Hold,
    /// Ending the share: with no relay to tell, the share ends here.
    End,
}

fn pending_kind(text: &str) -> Pending {
    match serde_json::from_str::<SharerToRelay>(text) {
        Ok(SharerToRelay::End) => Pending::End,
        Ok(
            SharerToRelay::Rotate { .. }
            | SharerToRelay::Kick { .. }
            | SharerToRelay::Deny { .. }
            | SharerToRelay::SetExpiry { .. },
        ) => Pending::Hold,
        _ => Pending::Send,
    }
}

fn connect(endpoint: String, delay: Duration) -> Connecting {
    Box::pin(async move {
        tokio::time::sleep(delay).await;
        match tokio::time::timeout(CONNECT_TIMEOUT, connect_async(endpoint.as_str())).await {
            Ok(Ok((ws, _))) => Ok(ws),
            Ok(Err(err)) => Err(err.to_string()),
            Err(_) => Err("timed out".into()),
        }
    })
}

/// The relay's code as the frontend and the audit log name it (`not_found`, `unauthorized`...).
fn code_name(code: impl serde::Serialize) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// How the share ended, and the relay's code when it refused.
type Done = (EndKind, Option<String>);

impl Host {
    pub fn new(s: Setup) -> Self {
        Self {
            s,
            viewers: Viewers::default(),
            bursts: HashMap::new(),
            attached: false,
            held: Vec::new(),
        }
    }

    fn emit(&self, event: ShareEvent) {
        (self.s.events)(event);
    }

    fn log(&self, event: &str, fields: serde_json::Value) {
        if let Some(audit) = &self.s.audit {
            audit.log(now_secs(), event, fields);
        }
    }

    fn links(&self) -> Vec<LinkInfo> {
        self.s
            .core
            .read(|e| e.links(&self.s.origin))
            .into_iter()
            .map(|(access, url)| LinkInfo {
                access,
                qr: qr_svg(&url),
                url,
            })
            .collect()
    }

    /// Runs the share until it ends; the end is reported to the frontend and the audit log, and returned.
    pub async fn run(mut self, marker: Option<&Marker>) -> EndKind {
        let (kind, code) = self.serve(marker).await;
        self.flush_bursts(true);
        self.log("end", json!({ "reason": kind, "code": code }));
        self.emit(ShareEvent::Ended { kind: kind.clone(), code });
        kind
    }

    async fn serve(&mut self, marker: Option<&Marker>) -> Done {
        let mut connecting: Option<Connecting> =
            Some(connect(self.s.endpoint.clone(), Duration::ZERO));
        let mut conn: Option<(SplitSink<Ws, Message>, SplitStream<Ws>)> = None;
        let mut backoff = MIN_BACKOFF;
        let mut ping = tokio::time::interval(PING);
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut stopping: Option<tokio::time::Instant> = None;
        loop {
            let mut lost = false;
            tokio::select! {
                result = async { connecting.as_mut().unwrap().await }, if connecting.is_some() => {
                    connecting = None;
                    match result {
                        Ok(ws) => {
                            conn = Some(ws.split());
                            backoff = MIN_BACKOFF;
                            ping.reset();
                        }
                        Err(_) => {
                            self.emit(ShareEvent::Unreachable { retry_in: backoff.as_secs() });
                            connecting = Some(connect(self.s.endpoint.clone(), backoff));
                            backoff = (backoff * 2).min(MAX_BACKOFF);
                        }
                    }
                }
                msg = async { conn.as_mut().unwrap().1.next().await }, if conn.is_some() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            self.note(&text);
                            self.s.core.run(|e| e.on_text(&text));
                        }
                        Some(Ok(Message::Binary(bytes))) => self.s.core.run(|e| e.on_binary(&bytes)),
                        Some(Ok(_)) => {}
                        _ => lost = true,
                    }
                }
                Some(action) = self.s.outbox.recv() => {
                    match action {
                        Action::Text(text) => match (self.attached, pending_kind(&text)) {
                            (false, Pending::End) => return (self.end_kind(EndReason::Stopped), None),
                            (false, Pending::Hold) => self.held.push(text),
                            _ => {
                                if let Some((sink, _)) = conn.as_mut() {
                                    lost = sink.send(Message::Text(text.into())).await.is_err();
                                }
                            }
                        },
                        Action::Binary(bytes) => {
                            if self.attached && let Some((sink, _)) = conn.as_mut() {
                                lost = sink.send(Message::Binary(bytes.into())).await.is_err();
                            }
                        }
                        other => {
                            if let Some(done) = self.handle(other) {
                                if let Some((mut sink, _)) = conn.take() {
                                    let _ = sink.close().await;
                                }
                                return done;
                            }
                            // Back on the relay: what changed meanwhile goes now, in order.
                            if self.attached && !self.held.is_empty() && let Some((sink, _)) = conn.as_mut() {
                                for text in std::mem::take(&mut self.held) {
                                    if sink.send(Message::Text(text.into())).await.is_err() {
                                        lost = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                command = self.s.commands.recv() => match command {
                    None | Some(Command::Stop) => {
                        if !self.attached {
                            return (EndKind::Stopped, None);
                        }
                        self.s.core.run(|e| e.end());
                        stopping.get_or_insert(tokio::time::Instant::now() + STOP_WAIT);
                    }
                    Some(command) => self.command(command),
                },
                _ = ping.tick() => {
                    if conn.is_some() {
                        self.s.core.run(|e| vec![e.ping()]);
                    }
                    if let Some(marker) = marker {
                        marker.touch(now_secs());
                    }
                }
                _ = tick.tick() => {
                    self.flush_bursts(false);
                    if stopping.is_some_and(|at| tokio::time::Instant::now() >= at) {
                        return (EndKind::Stopped, None);
                    }
                }
            }
            if lost && conn.take().is_some() {
                self.attached = false;
                // Frames sealed for the lost connection are not sent on the next one: viewers
                // ask for what they missed once the share is back (`Resync`).
                while let Ok(action) = self.s.outbox.try_recv() {
                    if !matches!(action, Action::Text(_) | Action::Binary(_))
                        && let Some(done) = self.handle(action)
                    {
                        return done;
                    }
                }
                self.s.core.engine.lock().unwrap().connection_lost();
                if stopping.is_some() {
                    return (EndKind::Stopped, None);
                }
                self.emit(ShareEvent::Unreachable { retry_in: 0 });
                connecting = Some(connect(self.s.endpoint.clone(), Duration::ZERO));
            }
        }
    }

    /// Reads what the relay says about viewers (their link, IP and browser), which the engine keeps
    /// to itself, before the engine handles the message.
    fn note(&mut self, text: &str) {
        match serde_json::from_str::<RelayToSharer>(text) {
            Ok(RelayToSharer::Join(info)) => self.viewers.seen(info),
            Ok(RelayToSharer::Ready { viewers, .. }) => {
                for info in viewers {
                    self.viewers.seen(info);
                }
            }
            _ => {}
        }
    }

    fn access_of(&self, viewer: u32) -> Access {
        self.viewers
            .info(viewer)
            .and_then(|info| self.s.link_access.get(&info.link_id).copied())
            .unwrap_or(Access::View)
    }

    /// The engine's decisions; returns how the share ended when it did.
    fn handle(&mut self, action: Action) -> Option<Done> {
        match action {
            Action::Text(_) | Action::Binary(_) => {}
            Action::Ready { expires_at } => {
                self.attached = true;
                self.emit(ShareEvent::Live {
                    links: self.links(),
                    expires_at,
                });
            }
            Action::JoinRequest {
                viewer,
                access,
                ip,
                ua,
            } => {
                let entry = self.viewers.add(viewer, access, &ip, &ua, now_ms());
                self.log(
                    "joinRequest",
                    json!({ "viewer": entry.number, "access": access, "ip": ip, "ua": ua }),
                );
                if self.s.auto_approve || (access == Access::View && !self.s.view_needs_approval) {
                    self.s.core.run(|e| e.approve(viewer));
                    self.log("approved", json!({ "viewer": entry.number, "auto": true }));
                    self.emit(ShareEvent::ViewerJoined {
                        viewer: entry,
                        rejoined: false,
                        auto: true,
                    });
                } else {
                    self.emit(ShareEvent::JoinRequest { viewer: entry });
                }
            }
            Action::Rejoined { viewer } => {
                let access = self.access_of(viewer);
                let (ip, ua) = self
                    .viewers
                    .info(viewer)
                    .map(|i| (i.ip.clone(), i.ua.clone()))
                    .unwrap_or_default();
                let entry = self.viewers.add(viewer, access, &ip, &ua, now_ms());
                self.emit(ShareEvent::ViewerJoined {
                    viewer: entry,
                    rejoined: true,
                    auto: false,
                });
            }
            Action::Input { viewer, data } => {
                self.note_input(viewer, &data);
                self.emit(ShareEvent::Input {
                    viewer,
                    data: String::from_utf8_lossy(&data).into_owned(),
                });
            }
            Action::ViewerLeft { viewer } => {
                self.flush_burst(viewer);
                if let Some(left) = self.viewers.remove(viewer) {
                    self.log("left", json!({ "viewer": left.number }));
                    self.emit(ShareEvent::ViewerLeft { viewer });
                }
            }
            Action::Dropped { viewer, error } => {
                let number = self.viewers.get(viewer).map(|v| v.number);
                self.log(
                    "dropped",
                    json!({ "viewer": number, "error": error.to_string() }),
                );
            }
            Action::LinkRotated { access, url_secret } => {
                let link_id = DerivedKeys::derive(&url_secret).link_id;
                self.s.link_access.insert(link_id, access);
                self.log("linkRotated", json!({ "access": access }));
                self.emit(ShareEvent::Links {
                    links: self.links(),
                });
            }
            Action::SnapshotRequest { viewer } => {
                self.emit(ShareEvent::SnapshotRequest { viewer });
            }
            Action::ExpiryChanged { expires_at } => {
                self.log("expiry", json!({ "expiresAt": expires_at }));
                self.emit(ShareEvent::Expiry { expires_at });
            }
            Action::Ended { reason } => return Some((self.end_kind(reason), None)),
            Action::Refused { code } => {
                return Some((EndKind::Refused, Some(code_name(code))));
            }
        }
        None
    }

    /// How the share ended: as the relay says, unless the shared program exited.
    fn end_kind(&self, reason: EndReason) -> EndKind {
        if self.s.core.program_exited.load(Ordering::Relaxed) {
            return EndKind::ProgramExited;
        }
        match reason {
            EndReason::Stopped => EndKind::Stopped,
            EndReason::Expired => EndKind::Expired,
            EndReason::Offline => EndKind::Offline,
            EndReason::Idle => EndKind::Idle,
        }
    }

    fn command(&mut self, command: Command) {
        match command {
            Command::Allow { viewer } => {
                let before = self.s.core.read(|e| e.viewer_count());
                self.s.core.run(|e| e.approve(viewer));
                let joined = self.s.core.read(|e| e.viewer_count()) > before;
                if let Some(entry) = self.viewers.get(viewer).cloned() {
                    self.log("approved", json!({ "viewer": entry.number }));
                    if joined {
                        self.emit(ShareEvent::ViewerJoined {
                            viewer: entry,
                            rejoined: false,
                            auto: false,
                        });
                    }
                }
            }
            Command::Deny { viewer } => {
                self.s.core.run(|e| e.deny(viewer));
                if let Some(entry) = self.viewers.remove(viewer) {
                    self.log("denied", json!({ "viewer": entry.number }));
                }
            }
            Command::Disconnect { viewer } => {
                self.s.core.run(|e| e.kick(viewer));
                if let Some(entry) = self.viewers.get(viewer) {
                    self.log("disconnected", json!({ "viewer": entry.number }));
                }
            }
            Command::ViewOnly => {
                self.s.core.run(|e| e.downgrade_to_view());
                self.viewers.view_only();
                for access in self.s.link_access.values_mut() {
                    *access = Access::View;
                }
                self.log("viewOnly", json!({}));
                self.emit(ShareEvent::Links {
                    links: self.links(),
                });
            }
            Command::Pause { on } => {
                self.s.core.run(|e| e.pause_input(on));
                self.log("inputPaused", json!({ "paused": on }));
            }
            Command::Expiry { expiry } => {
                let at = expiry.at(now_secs());
                self.s.core.run(|e| e.set_expiry(at));
            }
            Command::Snapshot {
                viewer,
                covers_seq,
                screen,
                full,
            } => {
                let snapshot = Snapshot {
                    screen: screen.map(String::into_bytes),
                    full: full.into_bytes(),
                };
                self.s
                    .core
                    .run(|e| e.snapshot_ready(viewer, covers_seq, snapshot));
            }
            Command::Resize { cols, rows } => self.s.core.run(|e| e.resize(cols, rows)),
            // Handled by the loop.
            Command::Stop => {}
        }
    }

    fn note_input(&mut self, viewer: u32, data: &[u8]) {
        let now = now_ms();
        if self
            .bursts
            .get(&viewer)
            .is_some_and(|b| now.saturating_sub(b.last_ms) >= BURST_GAP_MS)
        {
            self.flush_burst(viewer);
        }
        let burst = self.bursts.entry(viewer).or_insert(Burst {
            started_ms: now,
            last_ms: now,
            bytes: 0,
            text: String::new(),
        });
        burst.last_ms = now;
        burst.bytes += data.len();
        if self.s.record_input {
            burst.text.push_str(&String::from_utf8_lossy(data));
        }
    }

    fn flush_burst(&mut self, viewer: u32) {
        let Some(burst) = self.bursts.remove(&viewer) else {
            return;
        };
        let number = self.viewers.get(viewer).map(|v| v.number);
        let mut fields = json!({
            "viewer": number,
            "startedAt": burst.started_ms / 1000,
            "bytes": burst.bytes,
        });
        if self.s.record_input {
            fields["text"] = json!(burst.text);
        }
        self.log("input", fields);
    }

    /// Logs the bursts that ended (every one when `all`).
    fn flush_bursts(&mut self, all: bool) {
        let now = now_ms();
        let done: Vec<u32> = self
            .bursts
            .iter()
            .filter(|(_, b)| all || now.saturating_sub(b.last_ms) >= BURST_GAP_MS)
            .map(|(v, _)| *v)
            .collect();
        for viewer in done {
            self.flush_burst(viewer);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_wait_for_the_relay_while_attaching_goes_at_once() {
        let text = |m: &SharerToRelay| serde_json::to_string(m).unwrap();
        assert_eq!(
            pending_kind(&text(&SharerToRelay::Kick { viewer: 3 })),
            Pending::Hold
        );
        assert_eq!(
            pending_kind(&text(&SharerToRelay::Deny { viewer: 3 })),
            Pending::Hold
        );
        assert_eq!(
            pending_kind(&text(&SharerToRelay::SetExpiry { expires_at: 9 })),
            Pending::Hold
        );
        assert_eq!(pending_kind(&text(&SharerToRelay::End)), Pending::End);
        assert_eq!(pending_kind(&text(&SharerToRelay::Ping)), Pending::Send);
        assert_eq!(pending_kind("not json"), Pending::Send);
    }
}
