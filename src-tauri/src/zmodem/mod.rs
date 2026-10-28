//! ZMODEM (`rz`/`sz`) file transfers inside a terminal session.
//!
//! Every session's output passes through its [`Link`] before it is decoded to text. While no
//! transfer runs the link only watches for the header `sz` or `rz` sends first and reports it to
//! the pane as an offer; the pane asks the user for a folder or files and answers with
//! [`receive`] or [`send`] (or [`cancel`]). While a transfer runs, the session's output goes to
//! the transfer instead of the terminal, and its answers are written back to the session; when it
//! ends the output flows to the terminal again. The protocol itself is the `zmodem2` crate.
//!
//! Mosh sessions have no link: Mosh redraws a screen instead of passing bytes through.

mod detect;
mod names;
mod receive;
mod send;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant};

use crate::terminal::Utf8Stream;
use detect::{Detector, Segment};

/// Writes bytes to the session (its input), as if typed.
pub type Writer = Arc<dyn Fn(&[u8]) -> Result<(), String> + Send + Sync>;
/// Where the link sends what the pane must see, in order with the session's other output.
pub type Emit = Arc<dyn Fn(Out) + Send + Sync>;

/// What a link sends to its pane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Out {
    /// Output text that comes before a notice (the rest goes back to the reader).
    Text(String),
    Notice(Notice),
}

/// Which way the files go, seen from this computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    /// The remote runs `sz`: files come here.
    Receive,
    /// The remote runs `rz`: files go there.
    Send,
}

/// A transfer's progress, for the pane.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum Notice {
    /// The remote started `sz` or `rz`: the pane asks the user what to do.
    Offer { direction: Direction },
    /// Bytes of `file` done so far, of `total` when known.
    Progress {
        direction: Direction,
        file: String,
        bytes: u64,
        total: Option<u64>,
    },
    /// Every file went through; for a receive, the paths they were saved to.
    Done {
        direction: Direction,
        files: Vec<String>,
    },
    /// Cancelled by the user; `files` are the ones finished before.
    Cancelled {
        direction: Direction,
        files: Vec<String>,
    },
    /// Stopped by an error or by the other end; `files` are the ones finished before.
    Failed {
        direction: Direction,
        message: String,
        files: Vec<String>,
    },
}

/// How long the start of a possible header is held back before it is shown as text.
const HOLD: Duration = Duration::from_millis(500);
/// After a transfer stops early, output is dropped this long: the other end may still be sending
/// file data, whose raw bytes would garble the terminal.
const DRAIN: Duration = Duration::from_secs(1);
/// Progress notices are sent at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// Off until the webview applies the setting (on by default there), so nothing is taken from a
/// session's output before the pane can answer an offer.
static ENABLED: LazyLock<Arc<AtomicBool>> = LazyLock::new(|| Arc::new(AtomicBool::new(false)));

/// Turns detection on or off for every session (Settings → Terminal → ZMODEM transfers).
pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

enum State {
    Idle,
    /// An offer the pane has not answered yet.
    Offered(Direction),
    Receiving(Box<receive::Inbound>),
    Sending(send::Outbound),
}

/// The ZMODEM side of one session's output.
pub struct Link {
    me: Weak<Mutex<Link>>,
    utf8: Utf8Stream,
    detector: Detector,
    state: State,
    /// Changes whenever a hold or a transfer starts, so a timer from an earlier one does nothing.
    generation: u64,
    writer: Option<Writer>,
    emit: Emit,
    enabled: Arc<AtomicBool>,
    /// `O`s of the `OO` that ends a session, still to drop from the output.
    over_and_out: u8,
    drain_until: Option<Instant>,
}

pub fn lock(link: &Mutex<Link>) -> MutexGuard<'_, Link> {
    link.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Link {
    pub fn new(emit: Emit) -> Arc<Mutex<Link>> {
        Self::with_switch(emit, ENABLED.clone())
    }

    fn with_switch(emit: Emit, enabled: Arc<AtomicBool>) -> Arc<Mutex<Link>> {
        Arc::new_cyclic(|me| {
            Mutex::new(Link {
                me: me.clone(),
                utf8: Utf8Stream::default(),
                detector: Detector::default(),
                state: State::Idle,
                generation: 0,
                writer: None,
                emit,
                enabled,
                over_and_out: 0,
                drain_until: None,
            })
        })
    }

    /// How the link writes to its session; set once the session exists.
    pub fn set_writer(&mut self, writer: Writer) {
        self.writer = Some(writer);
    }

    /// Takes a read of the session's output and returns the text for the terminal. Text that
    /// comes before a notice is sent ahead of it through `emit`, so the order is kept.
    pub fn feed(&mut self, bytes: &[u8]) -> String {
        let mut text = String::new();
        let mut rest = bytes.to_vec();
        loop {
            match &mut self.state {
                State::Receiving(inbound) => {
                    let writer = self.writer.clone();
                    let step = inbound.feed(&rest, writer.as_ref(), &self.emit);
                    match step {
                        receive::Step::Running => return text,
                        receive::Step::Ended { rest: left, early } => {
                            self.state = State::Idle;
                            self.over_and_out = if early { 0 } else { 2 };
                            if early {
                                self.drain_until = Some(Instant::now() + DRAIN);
                            }
                            rest = left;
                        }
                    }
                }
                State::Sending(outbound) => {
                    outbound.forward(rest);
                    return text;
                }
                State::Idle | State::Offered(_) => {
                    self.idle_feed(&rest, &mut text);
                    return text;
                }
            }
        }
    }

    fn idle_feed(&mut self, bytes: &[u8], text: &mut String) {
        let mut bytes = bytes;
        if let Some(until) = self.drain_until {
            if Instant::now() < until {
                return;
            }
            self.drain_until = None;
        }
        // The end of a receive: the line trailer of the last header, then the sender's "OO".
        while self.over_and_out > 0
            && let Some(&byte) = bytes.first()
            && matches!(byte, b'O' | b'\r' | b'\n' | 0x8a | 0x11)
        {
            if byte == b'O' {
                self.over_and_out -= 1;
            }
            bytes = &bytes[1..];
        }
        if !bytes.is_empty() {
            self.over_and_out = 0;
        }
        if !self.enabled.load(Ordering::SeqCst) {
            let held = self.detector.release();
            text.push_str(&self.utf8.push(&held));
            text.push_str(&self.utf8.push(bytes));
            return;
        }
        for segment in self.detector.feed(bytes) {
            match segment {
                Segment::Text(part) => text.push_str(&self.utf8.push(&part)),
                Segment::Header(direction) => {
                    if matches!(self.state, State::Offered(d) if d == direction) {
                        continue; // the remote repeating its start while the user decides
                    }
                    if !text.is_empty() {
                        (self.emit)(Out::Text(std::mem::take(text)));
                    }
                    self.state = State::Offered(direction);
                    (self.emit)(Out::Notice(Notice::Offer { direction }));
                }
            }
        }
        if self.detector.holding() {
            self.generation += 1;
            let generation = self.generation;
            self.after(HOLD, move |link| {
                if link.generation == generation && link.detector.holding() {
                    let held = link.detector.release();
                    let text = link.utf8.push(&held);
                    if !text.is_empty() {
                        (link.emit)(Out::Text(text));
                    }
                }
            });
        }
    }

    /// Runs `f` on the link after `wait`, from a timer thread (nothing when the link is gone).
    fn after(&self, wait: Duration, f: impl FnOnce(&mut Link) + Send + 'static) {
        let me = self.me.clone();
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            if let Some(link) = me.upgrade() {
                f(&mut lock(&link));
            }
        });
    }

    fn writer(&self) -> Result<Writer, String> {
        self.writer
            .clone()
            .ok_or_else(|| "the session cannot take input yet".to_string())
    }

    /// Accepts a receive offer: files are saved in `folder`.
    pub fn receive(&mut self, folder: PathBuf) -> Result<(), String> {
        if !matches!(self.state, State::Offered(Direction::Receive)) {
            return Err("no file transfer is waiting".into());
        }
        if !folder.is_dir() {
            return Err(format!("{} is not a folder", folder.display()));
        }
        let writer = self.writer()?;
        let mut inbound = receive::Inbound::new(folder)?;
        self.generation += 1;
        let step = inbound.feed(&[], Some(&writer), &self.emit);
        self.state = State::Receiving(Box::new(inbound));
        if let receive::Step::Ended { .. } = step {
            self.state = State::Idle;
            return Ok(());
        }
        self.watch(self.generation);
        Ok(())
    }

    /// Every second while a receive runs: answers a silent sender again, and gives up on one that
    /// stays silent.
    fn watch(&self, generation: u64) {
        self.after(Duration::from_secs(1), move |link| {
            if link.generation != generation {
                return;
            }
            let writer = link.writer.clone();
            let State::Receiving(inbound) = &mut link.state else {
                return;
            };
            match inbound.tick(writer.as_ref(), &link.emit) {
                receive::Step::Running => link.watch(generation),
                receive::Step::Ended { rest, early } => {
                    link.state = State::Idle;
                    if early {
                        link.drain_until = Some(Instant::now() + DRAIN);
                    }
                    link.show(&rest);
                }
            }
        });
    }

    /// Accepts a send offer: `paths` are sent in order.
    pub fn send(&mut self, paths: Vec<PathBuf>) -> Result<(), String> {
        if !matches!(self.state, State::Offered(Direction::Send)) {
            return Err("no file transfer is waiting".into());
        }
        if paths.is_empty() {
            return Err("no files to send".into());
        }
        let writer = self.writer()?;
        let files = send::open_all(&paths)?;
        self.generation += 1;
        let generation = self.generation;
        let me = self.me.clone();
        let finished = move |early: bool, rest: Vec<u8>| {
            if let Some(link) = me.upgrade() {
                let mut link = lock(&link);
                if link.generation == generation && matches!(link.state, State::Sending(_)) {
                    link.state = State::Idle;
                    if early {
                        link.drain_until = Some(Instant::now() + DRAIN);
                    }
                    link.show(&rest);
                }
            }
        };
        let outbound = send::Outbound::start(files, writer, self.emit.clone(), finished);
        self.state = State::Sending(outbound);
        Ok(())
    }

    /// Shows output a transfer took but turned out not to be its own.
    fn show(&mut self, bytes: &[u8]) {
        let text = self.utf8.push(bytes);
        if !text.is_empty() {
            (self.emit)(Out::Text(text));
        }
    }

    /// Declines an offer or stops the running transfer; the other end is told with CANs.
    pub fn cancel(&mut self) -> Result<(), String> {
        match &mut self.state {
            State::Idle => Ok(()),
            State::Offered(direction) => {
                let direction = *direction;
                self.state = State::Idle;
                self.drain_until = Some(Instant::now() + DRAIN);
                (self.emit)(Out::Notice(Notice::Cancelled {
                    direction,
                    files: Vec::new(),
                }));
                self.writer()?(&send::ABORT)
            }
            State::Receiving(inbound) => {
                let writer = self.writer.clone();
                inbound.cancel(writer.as_ref(), &self.emit);
                self.state = State::Idle;
                self.drain_until = Some(Instant::now() + DRAIN);
                Ok(())
            }
            State::Sending(outbound) => {
                outbound.cancel();
                Ok(())
            }
        }
    }

    /// The session is gone: a running transfer stops and its unfinished file is removed.
    pub fn ended(&mut self) {
        match std::mem::replace(&mut self.state, State::Idle) {
            State::Receiving(mut inbound) => inbound.discard(),
            State::Sending(outbound) => outbound.cancel(),
            State::Idle | State::Offered(_) => {}
        }
    }
}

/// Throttles progress notices to [`PROGRESS_EVERY`].
pub(crate) struct Progress {
    last: Option<Instant>,
}

impl Progress {
    pub fn new() -> Self {
        Self { last: None }
    }

    /// Whether a notice is due now; `force` for a file's first and last one.
    pub fn due(&mut self, force: bool) -> bool {
        let now = Instant::now();
        if force
            || self
                .last
                .is_none_or(|at| now.duration_since(at) >= PROGRESS_EVERY)
        {
            self.last = Some(now);
            return true;
        }
        false
    }
}

/// The links of open sessions, by share tap id (the id their pane knows them by).
pub fn links() -> &'static Mutex<HashMap<u64, Arc<Mutex<Link>>>> {
    static LINKS: LazyLock<Mutex<HashMap<u64, Arc<Mutex<Link>>>>> = LazyLock::new(Default::default);
    &LINKS
}

/// A new session's link, registered under its share tap id.
pub fn register(tap: u64, emit: Emit) -> Arc<Mutex<Link>> {
    let link = Link::new(emit);
    links()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(tap, link.clone());
    link
}

fn link_of(tap: u64) -> Result<Arc<Mutex<Link>>, String> {
    links()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&tap)
        .cloned()
        .ok_or_else(|| "the session has ended".to_string())
}

/// Lets the link of `tap` write to its session.
pub fn set_writer(tap: u64, writer: Writer) {
    if let Ok(link) = link_of(tap) {
        lock(&link).set_writer(writer);
    }
}

/// The session of `tap` ended: its link stops any transfer and is forgotten.
pub fn unregister(tap: u64) {
    let link = links()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&tap);
    if let Some(link) = link {
        lock(&link).ended();
    }
}

pub fn receive(tap: u64, folder: PathBuf) -> Result<(), String> {
    let link = link_of(tap)?;
    lock(&link).receive(folder)
}

pub fn send(tap: u64, paths: Vec<PathBuf>) -> Result<(), String> {
    let link = link_of(tap)?;
    lock(&link).send(paths)
}

pub fn cancel(tap: u64) -> Result<(), String> {
    let link = link_of(tap)?;
    lock(&link).cancel()
}
