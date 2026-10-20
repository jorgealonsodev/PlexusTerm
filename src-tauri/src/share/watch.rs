//! PlexusTerm as viewer (PRD-share P3, integration guide §16): a share link pasted into
//! PlexusTerm opens as a pane, through the same `ViewerEngine` the web viewer runs.
//!
//! A pasted link names the viewer page, not the relay: the relay is the one that page connects to,
//! which it publishes in `<meta name="plexusterm-relay">`. The frontend asks "Connect to share on
//! <relay-host>?" before anything connects to it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use plexusterm_share_client::viewer::{Action, Event, ViewerEngine};
use plexusterm_share_protocol::content::{Access, ClientId};
use plexusterm_share_protocol::link::parse_share_url;
use plexusterm_share_protocol::wire::{EndReason, ErrorCode};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use super::host::{MAX_BACKOFF, MIN_BACKOFF, PING};
use crate::terminal::Utf8Stream;

/// The viewer page is small; anything bigger is not one.
const MAX_PAGE_BYTES: usize = 256 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, thiserror::Error)]
pub enum ViewError {
    #[error("This is not a PlexusTerm share link.")]
    NotALink,
    #[error("This link is incomplete — the part after # is missing. Copy the whole link.")]
    Incomplete,
    #[error("Can't reach {0}. Check your connection.")]
    Unreachable(String),
    #[error("{0} does not serve a PlexusTerm viewer page.")]
    NoRelay(String),
    #[error("This share has ended.")]
    UnknownView,
}

impl serde::Serialize for ViewError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

/// Where a link's share lives, for the confirmation.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub relay_url: String,
    /// The relay's host name, as the confirmation names it.
    pub relay_host: String,
}

/// The link's share id and secret, or why it is not one.
fn check_link(url: &str) -> Result<plexusterm_share_protocol::link::ParsedLink, ViewError> {
    let parsed = parse_share_url(url.trim()).map_err(|_| ViewError::NotALink)?;
    if parsed.secret.is_none() {
        return Err(ViewError::Incomplete);
    }
    Ok(parsed)
}

/// The relay a viewer page connects to: its `plexusterm-relay` meta tag.
pub fn relay_of_page(html: &str) -> Option<String> {
    let at = html.find(r#"name="plexusterm-relay""#)?;
    let tag_start = html[..at].rfind('<')?;
    let tag_end = at + html[at..].find('>')?;
    let tag = &html[tag_start..tag_end];
    let content = tag.split("content=\"").nth(1)?.split('"').next()?.trim();
    // The page's own placeholder means the deployment did not set its relay.
    if content.is_empty() || content == "__RELAY_URL__" {
        return None;
    }
    super::sharer_endpoint(content).ok()?;
    Some(content.trim_end_matches('/').to_string())
}

fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    rest.split(['/', '?', '#'])
        .next()
        .unwrap_or(rest)
        .to_string()
}

/// Reads the relay of a share link from its viewer page (the fragment is never sent).
pub async fn resolve(url: &str) -> Result<Resolved, ViewError> {
    let link = check_link(url)?;
    let page = format!("{}/s/{}", link.origin, link.share_id.to_b64());
    let host = host_of(&link.origin);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ViewError::Unreachable(host.clone()))?;
    let response = client
        .get(&page)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| ViewError::Unreachable(host.clone()))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|_| ViewError::Unreachable(host.clone()))?;
    if bytes.len() > MAX_PAGE_BYTES {
        return Err(ViewError::NoRelay(host));
    }
    let relay_url =
        relay_of_page(&String::from_utf8_lossy(&bytes)).ok_or(ViewError::NoRelay(host))?;
    Ok(Resolved {
        relay_host: host_of(&relay_url),
        relay_url,
    })
}

/// Events streamed to a shared pane.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(
    tag = "event",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ViewEvent {
    /// Connecting again after a drop; no input is sent meanwhile.
    Reconnecting {
        retry_in: u64,
    },
    /// "Waiting for the sharer to let you in".
    Waiting,
    Joined {
        access: Access,
        cols: u16,
        rows: u16,
    },
    /// Clear the terminal before the next write (a snapshot follows).
    Reset,
    Output(String),
    Resized {
        cols: u16,
        rows: u16,
    },
    Access(Access),
    InputPaused(bool),
    ProgramExited,
    SharerAway,
    SharerBack,
    /// The share's end time, Unix seconds.
    Expiry(u64),
    /// Final: denied, kicked, ended or refused. `code` is the relay's code when refused.
    Done {
        reason: DoneReason,
        code: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DoneReason {
    Denied,
    Kicked,
    Stopped,
    Expired,
    Offline,
    Idle,
    Refused,
    /// The relay could not be reached again.
    Lost,
}

fn code_name(code: ErrorCode) -> String {
    serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// What the frontend asks of a shared pane.
enum Ask {
    Input(Vec<u8>),
    Close,
}

/// The shared panes open in this process.
#[derive(Clone, Default)]
pub struct Watches {
    next: Arc<AtomicU32>,
    open: Arc<Mutex<HashMap<u32, UnboundedSender<Ask>>>>,
}

impl Watches {
    /// Joins the share of `url` through `relay_url`; events go to `events` until `done`.
    pub fn start(
        &self,
        url: &str,
        relay_url: &str,
        events: impl Fn(ViewEvent) + Send + Sync + 'static,
    ) -> Result<u32, ViewError> {
        let link = check_link(url)?;
        let endpoint = super::sharer_endpoint(relay_url)
            .map_err(|_| ViewError::NoRelay(host_of(relay_url)))?
            .replace("/v1/sharer", "/v1/viewer");
        let secret = link.secret.ok_or(ViewError::Incomplete)?;
        let engine = ViewerEngine::new(link.share_id, &secret, ClientId::random());
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (asks, asks_rx) = unbounded_channel();
        self.open.lock().unwrap().insert(id, asks);
        let open = self.open.clone();
        tauri::async_runtime::spawn(async move {
            watch(engine, endpoint, asks_rx, &events).await;
            open.lock().unwrap().remove(&id);
        });
        Ok(id)
    }

    pub fn input(&self, id: u32, data: &[u8]) -> Result<(), ViewError> {
        let open = self.open.lock().unwrap();
        let asks = open.get(&id).ok_or(ViewError::UnknownView)?;
        asks.send(Ask::Input(data.to_vec()))
            .map_err(|_| ViewError::UnknownView)
    }

    pub fn close(&self, id: u32) {
        if let Some(asks) = self.open.lock().unwrap().get(&id) {
            let _ = asks.send(Ask::Close);
        }
    }
}

/// The final event for an engine event, if it is one.
fn done_of(event: &Event) -> Option<ViewEvent> {
    let (reason, code) = match event {
        Event::Denied => (DoneReason::Denied, None),
        Event::Kicked => (DoneReason::Kicked, None),
        Event::Ended(EndReason::Stopped) => (DoneReason::Stopped, None),
        Event::Ended(EndReason::Expired) => (DoneReason::Expired, None),
        Event::Ended(EndReason::Offline) => (DoneReason::Offline, None),
        Event::Ended(EndReason::Idle) => (DoneReason::Idle, None),
        Event::Refused(code) => (DoneReason::Refused, Some(code_name(*code))),
        _ => return None,
    };
    Some(ViewEvent::Done { reason, code })
}

/// Runs one shared pane until its share is over for it or the pane closes.
async fn watch(
    mut engine: ViewerEngine,
    endpoint: String,
    mut asks: UnboundedReceiver<Ask>,
    events: &(impl Fn(ViewEvent) + Send + Sync),
) {
    let mut backoff = MIN_BACKOFF;
    let mut decoder = Utf8Stream::default();
    let mut first = true;
    loop {
        if !first {
            events(ViewEvent::Reconnecting {
                retry_in: backoff.as_secs(),
            });
            let wait = tokio::time::sleep(backoff);
            tokio::pin!(wait);
            // Keys typed while reconnecting are not sent (PRD §5.4); Close still closes.
            loop {
                tokio::select! {
                    _ = &mut wait => break,
                    ask = asks.recv() => if matches!(ask, None | Some(Ask::Close)) { return },
                }
            }
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
        first = false;
        let connecting = tokio::time::timeout(CONNECT_TIMEOUT, connect_async(endpoint.as_str()));
        tokio::pin!(connecting);
        let ws = loop {
            tokio::select! {
                result = &mut connecting => break result,
                ask = asks.recv() => if matches!(ask, None | Some(Ask::Close)) { return },
            }
        };
        let Ok(Ok((ws, _))) = ws else {
            if !engine.connection_lost() {
                return events(ViewEvent::Done {
                    reason: DoneReason::Lost,
                    code: None,
                });
            }
            continue;
        };
        let (mut sink, mut stream) = ws.split();
        let mut ping = tokio::time::interval(PING);
        ping.tick().await;
        loop {
            let actions = tokio::select! {
                msg = stream.next() => match msg {
                    Some(Ok(Message::Text(text))) => engine.on_text(&text),
                    Some(Ok(Message::Binary(bytes))) => engine.on_binary(&bytes),
                    Some(Ok(_)) => continue,
                    _ => break,
                },
                ask = asks.recv() => match ask {
                    Some(Ask::Input(data)) => engine.input(&data).into_iter().collect(),
                    None | Some(Ask::Close) => {
                        let _ = sink.close().await;
                        return;
                    }
                },
                _ = ping.tick() => vec![engine.ping()],
            };
            let mut sent = true;
            for action in actions {
                match action {
                    Action::Text(text) => {
                        sent = sink.send(Message::Text(text.into())).await.is_ok()
                    }
                    Action::Binary(bytes) => {
                        sent = sink.send(Message::Binary(bytes.into())).await.is_ok()
                    }
                    Action::Event(event) => {
                        if let Some(done) = done_of(&event) {
                            let _ = sink.close().await;
                            return events(done);
                        }
                        if engine.is_live() {
                            backoff = MIN_BACKOFF;
                        }
                        let shown = match event {
                            Event::Waiting => ViewEvent::Waiting,
                            Event::Joined { access, cols, rows } => {
                                ViewEvent::Joined { access, cols, rows }
                            }
                            Event::Reset => {
                                decoder = Utf8Stream::default();
                                ViewEvent::Reset
                            }
                            Event::Write(bytes) => ViewEvent::Output(decoder.push(&bytes)),
                            Event::Resized { cols, rows } => ViewEvent::Resized { cols, rows },
                            Event::AccessChanged(access) => ViewEvent::Access(access),
                            Event::InputPaused(paused) => ViewEvent::InputPaused(paused),
                            Event::ProgramExited => ViewEvent::ProgramExited,
                            Event::SharerAway => ViewEvent::SharerAway,
                            Event::SharerBack => ViewEvent::SharerBack,
                            Event::Expiry(at) => ViewEvent::Expiry(at),
                            // Dropped frames are not shown; final events were handled above.
                            _ => continue,
                        };
                        events(shown);
                    }
                }
                if !sent {
                    break;
                }
            }
            if !sent {
                break;
            }
        }
        if !engine.connection_lost() {
            return events(ViewEvent::Done {
                reason: DoneReason::Lost,
                code: None,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_relay_a_viewer_page_connects_to() {
        let page = r#"<head><meta charset="utf-8" /><meta name="plexusterm-relay" content="wss://relay.example.com/" /></head>"#;
        assert_eq!(
            relay_of_page(page).as_deref(),
            Some("wss://relay.example.com")
        );
        // A deployment that did not set its relay, another page, or a relay without TLS.
        assert_eq!(
            relay_of_page(r#"<meta name="plexusterm-relay" content="__RELAY_URL__" />"#),
            None
        );
        assert_eq!(relay_of_page("<html><body>hello</body></html>"), None);
        assert_eq!(
            relay_of_page(r#"<meta name="plexusterm-relay" content="ws://evil.example.com" />"#),
            None
        );
    }

    #[test]
    fn a_link_needs_its_key() {
        assert!(matches!(
            check_link("https://view.example.com/s/abc"),
            Err(ViewError::NotALink)
        ));
        assert!(matches!(check_link("not a link"), Err(ViewError::NotALink)));
        let id = plexusterm_share_protocol::keys::ShareId::random().to_b64();
        assert!(matches!(
            check_link(&format!("https://view.example.com/s/{id}")),
            Err(ViewError::Incomplete)
        ));
    }

    #[test]
    fn names_the_relay_host() {
        assert_eq!(
            host_of("wss://relay.example.com:8443/x"),
            "relay.example.com:8443"
        );
    }
}
