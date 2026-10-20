//! Sharing a terminal tab through `plexusterm-relay` (PRD-share P2, the sharing side).
//!
//! `SharerEngine` (crate `plexusterm-share-client`) does the protocol and the crypto; this module
//! is its host, as `plexusterm-relay/docs/plexusterm-integration.md` describes: one task and one
//! WebSocket per shared tab ([`host`]), the [`Tap`] that hands it every session's output right
//! before the webview gets it, and what a share needs from the system (staying awake, the audit
//! log, crash markers). Viewer input goes to the frontend, which holds it by the PRD's rules and
//! types it through the pane's own write path.

pub mod audit;
pub mod awake;
pub mod commands;
mod host;
pub mod marker;
mod viewers;
pub mod watch;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

use plexusterm_share_client::sharer::{Action, SharerConfig, SharerEngine};
use plexusterm_share_protocol::content::Access;
use plexusterm_share_protocol::keys::{DerivedKeys, LinkId};
use plexusterm_share_protocol::link::parse_share_url;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

pub use viewers::Viewer;

/// Every expiry ends after 12 h at most; the relay checks it against its own clock, so a margin
/// keeps a slightly fast local clock from being refused (integration guide §6).
pub const MAX_SECS: u64 = 12 * 60 * 60;
pub const CLOCK_MARGIN_SECS: u64 = 60;

/// The expiry choices of the Share dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Expiry {
    /// "When I stop sharing": still 12 h at most.
    WhenStopped,
    OneHour,
    TwelveHours,
}

impl Expiry {
    /// The end time, Unix seconds, of a share started or changed at `now`.
    pub fn at(self, now: u64) -> u64 {
        match self {
            Expiry::OneHour => now + 60 * 60,
            Expiry::WhenStopped | Expiry::TwelveHours => now + MAX_SECS - CLOCK_MARGIN_SECS,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ShareError {
    #[error("Set the relay token in Settings > Sharing first.")]
    NoToken,
    #[error("The relay URL must start with wss:// (ws:// only for localhost).")]
    BadRelayUrl,
    #[error("The viewer origin must start with https:// (http:// only for localhost).")]
    BadViewerOrigin,
    #[error("This tab is already shared.")]
    AlreadyShared,
    #[error("This tab can no longer be shared.")]
    UnknownTab,
    #[error("This share has ended.")]
    UnknownShare,
    #[error("Can't reach {0}.")]
    Unreachable(String),
    #[error("{0}")]
    Keyring(String),
}

impl serde::Serialize for ShareError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn is_local(host: &str) -> bool {
    let host = host.split(['/', '?', '#']).next().unwrap_or("");
    let name = host.rsplit_once(':').map_or(host, |(name, _)| name);
    matches!(name, "localhost" | "127.0.0.1" | "[::1]")
}

/// The sharer endpoint of a relay URL (`wss://relay.example.com` → `…/v1/sharer`).
pub fn sharer_endpoint(relay_url: &str) -> Result<String, ShareError> {
    let url = relay_url.trim().trim_end_matches('/');
    let ok = url.strip_prefix("wss://").is_some_and(|h| !h.is_empty())
        || url.strip_prefix("ws://").is_some_and(is_local);
    if !ok || url.contains(char::is_whitespace) {
        return Err(ShareError::BadRelayUrl);
    }
    Ok(format!("{url}/v1/sharer"))
}

/// The viewer origin without a trailing `/`, checked (Web Crypto needs HTTPS).
pub fn viewer_origin(origin: &str) -> Result<String, ShareError> {
    let origin = origin.trim().trim_end_matches('/');
    let ok = origin
        .strip_prefix("https://")
        .is_some_and(|h| !h.is_empty())
        || origin.strip_prefix("http://").is_some_and(is_local);
    if !ok || origin.contains(char::is_whitespace) {
        return Err(ShareError::BadViewerOrigin);
    }
    Ok(origin.to_string())
}

pub fn now_secs() -> u64 {
    now_ms() / 1000
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The engine of one share and the ordered queue of what it asks for.
///
/// Everything the engine returns goes into `outbox` while the engine is still locked, so the host
/// sends frames in the order they were sealed (a viewer drops a frame whose number is not above the
/// last one) whichever thread produced them: the tap's forwarder or the host task.
pub struct Core {
    engine: Mutex<SharerEngine>,
    outbox: UnboundedSender<Action>,
    /// The shared program exited (the tap saw it): the end is reported as such.
    program_exited: AtomicBool,
}

impl Core {
    fn run(&self, f: impl FnOnce(&mut SharerEngine) -> Vec<Action>) {
        let mut engine = self.engine.lock().unwrap();
        for action in f(&mut engine) {
            let _ = self.outbox.send(action);
        }
    }

    fn read<T>(&self, f: impl FnOnce(&SharerEngine) -> T) -> T {
        f(&self.engine.lock().unwrap())
    }
}

/// The share side of one terminal session's output stream.
#[derive(Default)]
pub struct Tap {
    share: Mutex<Option<Arc<Core>>>,
}

impl Tap {
    /// Output on its way to the webview. While the session is shared it goes to the engine first,
    /// and the number of the last output is returned for the webview to tag what it rendered.
    pub fn output(&self, data: &[u8]) -> Option<u64> {
        let core = self.share.lock().unwrap().clone()?;
        let mut engine = core.engine.lock().unwrap();
        for action in engine.output(data) {
            let _ = core.outbox.send(action);
        }
        Some(engine.last_seq())
    }

    /// The session's program exited: viewers see "The shared program exited", then the share ends.
    pub fn exited(&self) {
        let core = self.share.lock().unwrap().clone();
        if let Some(core) = core {
            core.program_exited.store(true, Ordering::Relaxed);
            core.run(|e| e.program_exited());
        }
    }

    fn attach(&self, core: Arc<Core>) -> bool {
        let mut share = self.share.lock().unwrap();
        if share.is_some() {
            return false;
        }
        *share = Some(core);
        true
    }

    fn detach(&self) {
        *self.share.lock().unwrap() = None;
    }
}

/// Every live session's tap, by id. A session keeps its tap alive; a closed one is gone here.
#[derive(Default)]
pub struct Taps {
    next: AtomicU64,
    taps: Mutex<HashMap<u64, Weak<Tap>>>,
}

impl Taps {
    pub fn register(&self) -> (u64, Arc<Tap>) {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let tap = Arc::new(Tap::default());
        let mut taps = self.taps.lock().unwrap();
        taps.retain(|_, t| t.strong_count() > 0);
        taps.insert(id, Arc::downgrade(&tap));
        (id, tap)
    }

    fn get(&self, id: u64) -> Option<Arc<Tap>> {
        self.taps.lock().unwrap().get(&id)?.upgrade()
    }
}

/// The taps of every session of this process (sessions are created by commands that have no
/// handle on the share manager).
pub fn taps() -> &'static Taps {
    static TAPS: OnceLock<Taps> = OnceLock::new();
    TAPS.get_or_init(Taps::default)
}

/// What the frontend asks of a live share.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    Allow {
        viewer: u32,
    },
    Deny {
        viewer: u32,
    },
    Disconnect {
        viewer: u32,
    },
    /// Can type → View only, for the rest of the share.
    ViewOnly,
    Pause {
        on: bool,
    },
    Expiry {
        expiry: Expiry,
    },
    /// The pane's serialization for `viewer`, as it was after output `covers_seq`.
    Snapshot {
        viewer: u32,
        covers_seq: u64,
        screen: Option<String>,
        full: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Stop,
}

/// A link to show, with its QR code.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub access: Access,
    pub url: String,
    /// SVG markup of the link's QR code.
    pub qr: String,
}

/// How a share ended, for the frontend's message.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EndKind {
    Stopped,
    Expired,
    Offline,
    Idle,
    ProgramExited,
    /// The relay refused the share or a message; `code` says why.
    Refused,
}

/// Events streamed to the frontend for one share.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(
    tag = "event",
    content = "data",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShareEvent {
    /// The relay cannot be reached; the next attempt is in `retry_in` seconds.
    Unreachable {
        retry_in: u64,
    },
    /// The share is live (again, after a reconnect): its links and end time.
    Live {
        links: Vec<LinkInfo>,
        expires_at: u64,
    },
    /// Ask the sharer: Allow or Deny.
    JoinRequest {
        viewer: Viewer,
    },
    /// A viewer is in: approved, let in without asking, or back after a drop (`rejoined`).
    ViewerJoined {
        viewer: Viewer,
        rejoined: bool,
    },
    ViewerLeft {
        viewer: u32,
    },
    /// Type these keys into the pane, by the hold rules.
    Input {
        viewer: u32,
        data: String,
    },
    /// Serialize the pane and answer with [`Command::Snapshot`].
    SnapshotRequest {
        viewer: u32,
    },
    /// The relay accepted a new end time.
    Expiry {
        expires_at: u64,
    },
    /// Every link, after a change (a Disconnect rotated one; View only changed one's access).
    Links {
        links: Vec<LinkInfo>,
    },
    Ended {
        kind: EndKind,
        code: Option<String>,
    },
}

/// What a share needs to start, as the frontend sends it.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRequest {
    /// The session's tap (sent to the pane as its first event).
    pub tap: u64,
    /// Tab name, for the audit log and the crash message.
    pub tab: String,
    pub relay_url: String,
    pub viewer_origin: String,
    pub accesses: Vec<Access>,
    pub expiry: Expiry,
    pub cols: u16,
    pub rows: u16,
    /// "View only joins need approval".
    pub view_needs_approval: bool,
    /// "Record what viewers type".
    pub record_input: bool,
    /// "Also block lid-close sleep while sharing" (Linux).
    pub block_lid: bool,
}

/// Keyring account of the relay token.
pub const TOKEN_ACCOUNT: &str = "share-relay-token";
const AUDIT_FILE: &str = "share-audit.log";
const MARKER_DIR: &str = "shares";

struct Handle {
    commands: UnboundedSender<Command>,
}

/// The live shares of this process.
#[derive(Clone, Default)]
pub struct ShareManager {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    next: AtomicU32,
    shares: Mutex<HashMap<u32, Handle>>,
    awake: Mutex<awake::Awake>,
    /// Where the audit log and crash markers live (the app's config folder).
    dir: OnceLock<PathBuf>,
    /// The user confirmed quitting: the window closes without asking again.
    quitting: AtomicBool,
}

/// The QR code of a link as SVG.
pub fn qr_svg(url: &str) -> String {
    use qrcode::render::svg;
    qrcode::QrCode::new(url.as_bytes())
        .map(|code| {
            code.render::<svg::Color>()
                .min_dimensions(200, 200)
                .dark_color(svg::Color("#000000"))
                .light_color(svg::Color("#ffffff"))
                .build()
        })
        .unwrap_or_default()
}

/// Each link's id, to know the access of a viewer from the link it proved.
fn link_ids(links: &[(Access, String)]) -> HashMap<LinkId, Access> {
    links
        .iter()
        .filter_map(|(access, url)| {
            let secret = parse_share_url(url).ok()?.secret?;
            Some((DerivedKeys::derive(&secret).link_id, *access))
        })
        .collect()
}

impl ShareManager {
    pub fn set_dir(&self, dir: PathBuf) {
        let _ = self.inner.dir.set(dir);
    }

    fn dir(&self) -> Option<&PathBuf> {
        self.inner.dir.get()
    }

    pub fn audit_path(&self) -> Option<PathBuf> {
        self.dir().map(|d| d.join(AUDIT_FILE))
    }

    /// The shares that ended with a crash of an earlier run (read once).
    pub fn take_crashed(&self) -> Vec<marker::Crashed> {
        self.dir()
            .map(|d| marker::take_crashed(&d.join(MARKER_DIR), now_secs()))
            .unwrap_or_default()
    }

    /// Starts sharing the session of `request.tap` with `token`; events go to `events`.
    /// Returns the share's id for [`ShareManager::command`].
    pub fn start(
        &self,
        request: StartRequest,
        token: String,
        events: impl Fn(ShareEvent) + Send + Sync + 'static,
    ) -> Result<u32, ShareError> {
        let endpoint = sharer_endpoint(&request.relay_url)?;
        let origin = viewer_origin(&request.viewer_origin)?;
        if token.trim().is_empty() {
            return Err(ShareError::NoToken);
        }
        let tap = taps().get(request.tap).ok_or(ShareError::UnknownTab)?;
        let now = now_secs();
        let mut engine = SharerEngine::new(SharerConfig {
            token: token.trim().to_string(),
            expires_at: request.expiry.at(now),
            accesses: request.accesses.clone(),
            cols: request.cols,
            rows: request.rows,
        });
        engine.set_async_snapshots(true);
        let link_access = link_ids(&engine.links(&origin));
        let (outbox, outbox_rx) = unbounded_channel();
        let core = Arc::new(Core {
            engine: Mutex::new(engine),
            outbox,
            program_exited: AtomicBool::new(false),
        });
        if !tap.attach(core.clone()) {
            return Err(ShareError::AlreadyShared);
        }
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed) + 1;
        let (commands, commands_rx) = unbounded_channel();
        self.inner
            .shares
            .lock()
            .unwrap()
            .insert(id, Handle { commands });

        let audit = self.audit_path().map(|path| {
            let _ = audit::prune(&path, now);
            audit::Audit::new(path, request.tab.clone())
        });
        if let Some(audit) = &audit {
            audit.log(
                now,
                "start",
                serde_json::json!({ "access": request.accesses, "expiresAt": request.expiry.at(now) }),
            );
        }
        let marker = self
            .dir()
            .map(|d| marker::Marker::create(&d.join(MARKER_DIR), id, &request.tab, now));
        let manager = self.clone();
        let lid = request.block_lid;
        let host = host::Host::new(host::Setup {
            endpoint,
            origin,
            core,
            outbox: outbox_rx,
            commands: commands_rx,
            events: Box::new(events),
            audit,
            link_access,
            view_needs_approval: request.view_needs_approval,
            record_input: request.record_input,
        });
        tauri::async_runtime::spawn(async move {
            let awake = manager.clone();
            let _ =
                tokio::task::spawn_blocking(move || awake.inner.awake.lock().unwrap().acquire(lid))
                    .await;
            host.run(marker.as_ref()).await;
            tap.detach();
            if let Some(marker) = marker {
                marker.remove();
            }
            manager.inner.shares.lock().unwrap().remove(&id);
            manager.inner.awake.lock().unwrap().release();
        });
        Ok(id)
    }

    pub fn command(&self, id: u32, command: Command) -> Result<(), ShareError> {
        let shares = self.inner.shares.lock().unwrap();
        let handle = shares.get(&id).ok_or(ShareError::UnknownShare)?;
        handle
            .commands
            .send(command)
            .map_err(|_| ShareError::UnknownShare)
    }

    /// Whether closing the window must ask first: shares are live and quitting was not confirmed.
    pub fn must_confirm_quit(&self) -> bool {
        !self.inner.quitting.load(Ordering::Relaxed)
            && !self.inner.shares.lock().unwrap().is_empty()
    }

    /// Ends every share and waits (at most `wait`) for them to end, so viewers are told and no
    /// crash marker is left behind.
    pub async fn stop_all(&self, wait: std::time::Duration) {
        self.inner.quitting.store(true, Ordering::Relaxed);
        for handle in self.inner.shares.lock().unwrap().values() {
            let _ = handle.commands.send(Command::Stop);
        }
        let deadline = tokio::time::Instant::now() + wait;
        while !self.inner.shares.lock().unwrap().is_empty()
            && tokio::time::Instant::now() < deadline
        {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }
}

#[cfg(test)]
mod tests;
