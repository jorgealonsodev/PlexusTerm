//! Receiving files the remote's `sz` sends, into the folder the user picked.

use std::fs::File;
use std::io::Write as _;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use zmodem2::{Action, Event, Receiver};

use super::{Direction, Emit, Notice, Out, Progress, Writer, detect, names};

/// Without a word from the sender for this long, ZRINIT is sent again.
const NUDGE_AFTER: Duration = Duration::from_secs(10);
/// Without a word from the sender for this long, the transfer is given up.
const GIVE_UP_AFTER: Duration = Duration::from_secs(40);
/// Without a file starting this long after the user accepted, the start is taken for text that
/// only looked like `sz` (or an `sz` that already gave up), and what came meanwhile is shown.
#[cfg(not(test))]
pub const NO_START_AFTER: Duration = Duration::from_secs(10);
#[cfg(test)]
pub const NO_START_AFTER: Duration = Duration::from_millis(1500);
/// At most this much output is kept to show again in that case.
const UNCLAIMED_MAX: usize = 64 * 1024;
/// Most bytes kept of a file whose sender gives no size (it could otherwise fill the disk).
pub const MAX_UNDECLARED: u64 = 1 << 30;
/// Wire errors in a row (corrupt headers) before the transfer is given up.
const MAX_ERRORS: u32 = 20;

/// What a read did to the transfer.
pub enum Step {
    Running,
    /// The transfer is over; `rest` is the output after its end, for the terminal. `early` when
    /// it did not complete.
    Ended {
        rest: Vec<u8>,
        early: bool,
    },
}

/// Whether `n` more bytes may be written to a file with `written` bytes: never more than the
/// sender announced, nor than MAX_UNDECLARED when it announced no size (it could fill the disk).
fn room(name: &str, size: Option<u64>, written: u64, n: usize) -> Result<(), String> {
    let limit = size.unwrap_or(MAX_UNDECLARED);
    if written.saturating_add(n as u64) <= limit {
        return Ok(());
    }
    Err(match size {
        Some(size) => format!("{name} is longer than the {size} bytes announced"),
        None => format!("{name} has no size and passed {MAX_UNDECLARED} bytes"),
    })
}

struct Current {
    name: String,
    path: PathBuf,
    file: File,
    size: Option<u64>,
    written: u64,
}

pub struct Inbound {
    rx: Receiver,
    folder: PathBuf,
    current: Option<Current>,
    saved: Vec<String>,
    /// Output the receiver has not taken yet.
    pending: Vec<u8>,
    accepted: Instant,
    /// A file (or the end of the session) came: the other end really runs `sz`.
    begun: bool,
    /// The output before that, to show again if nothing begins.
    unclaimed: Vec<u8>,
    last_heard: Instant,
    last_nudge: Instant,
    errors: u32,
    cans: u8,
    progress: Progress,
}

enum Outcome {
    Running,
    Done,
    /// Stopped: by the other end (`None`) or by an error.
    Stopped(Option<String>),
}

impl Inbound {
    pub fn new(folder: PathBuf) -> Result<Self, String> {
        // Nonstop streaming: every session here is flow-controlled (a pipe, TCP or a serial line
        // read as fast as it comes) and the file is written as it arrives.
        let rx = Receiver::with_flow_control(0, true).map_err(|e| e.to_string())?;
        let now = Instant::now();
        Ok(Self {
            rx,
            folder,
            current: None,
            saved: Vec::new(),
            pending: Vec::new(),
            accepted: now,
            begun: false,
            unclaimed: Vec::new(),
            last_heard: now,
            last_nudge: now,
            errors: 0,
            cans: 0,
            progress: Progress::new(),
        })
    }

    /// Takes a read of the session's output (empty to just send what is due, such as ZRINIT).
    pub fn feed(&mut self, bytes: &[u8], writer: Option<&Writer>, emit: &Emit) -> Step {
        if !bytes.is_empty() {
            self.last_heard = Instant::now();
            self.last_nudge = self.last_heard;
            if !self.begun && self.unclaimed.len() < UNCLAIMED_MAX {
                let room = UNCLAIMED_MAX - self.unclaimed.len();
                self.unclaimed
                    .extend_from_slice(&bytes[..bytes.len().min(room)]);
            }
        }
        if detect::cancelled(bytes, &mut self.cans) {
            return self.stop(Some("the other end cancelled the transfer".into()), emit);
        }
        self.pending.extend_from_slice(bytes);
        let Some(writer) = writer else {
            return self.stop(Some("the session cannot take input".into()), emit);
        };
        loop {
            match self.pump(writer, emit) {
                Outcome::Running => {}
                Outcome::Done => {
                    let rest = std::mem::take(&mut self.pending);
                    emit(Out::Notice(Notice::Done {
                        direction: Direction::Receive,
                        files: std::mem::take(&mut self.saved),
                    }));
                    return Step::Ended { rest, early: false };
                }
                Outcome::Stopped(reason) => {
                    let reason =
                        reason.unwrap_or_else(|| "the other end cancelled the transfer".into());
                    return self.stop(Some(reason), emit);
                }
            }
            if self.pending.is_empty() {
                return Step::Running;
            }
            match self.rx.submit_wire(&self.pending) {
                Ok(0) => return Step::Running, // needs more bytes than it has
                Ok(n) => {
                    self.pending.drain(..n);
                    self.errors = 0;
                }
                Err(err) => {
                    // The receiver asked for a resend; what was left of this read is lost.
                    self.pending.clear();
                    self.errors += 1;
                    if self.errors > MAX_ERRORS {
                        self.rx_abort(writer);
                        return self.stop(Some(format!("too many transfer errors ({err})")), emit);
                    }
                }
            }
        }
    }

    /// Does what the receiver asks until it waits for more output.
    fn pump(&mut self, writer: &Writer, emit: &Emit) -> Outcome {
        loop {
            match self.rx.poll() {
                Action::WriteWire(bytes) => {
                    let n = bytes.len();
                    if let Err(err) = writer(bytes) {
                        return Outcome::Stopped(Some(err));
                    }
                    self.rx.wire_written(n);
                }
                Action::WriteFile(bytes) => {
                    let n = bytes.len();
                    let Some(current) = &mut self.current else {
                        return Outcome::Stopped(Some("file data before a file".into()));
                    };
                    if let Err(message) = room(&current.name, current.size, current.written, n) {
                        self.rx_abort(writer);
                        return Outcome::Stopped(Some(message));
                    }
                    if let Err(err) = current.file.write_all(bytes) {
                        let message = format!("could not write {}: {err}", current.name);
                        self.rx_abort(writer);
                        return Outcome::Stopped(Some(message));
                    }
                    current.written = current.written.saturating_add(n as u64);
                    if self.progress.due(false) {
                        notify_progress(current, emit);
                    }
                    if let Err(err) = self.rx.file_written(n) {
                        return Outcome::Stopped(Some(err.to_string()));
                    }
                }
                Action::Event(Event::FileStarted(info)) => {
                    self.begun = true;
                    self.unclaimed = Vec::new();
                    let name = names::sanitize(info.name);
                    let size = info.size.map(|s| u64::from(s.get()));
                    match names::create_unique(&self.folder, &name) {
                        Ok((path, file)) => {
                            let current = Current {
                                name: path
                                    .file_name()
                                    .map(|n| n.to_string_lossy().into_owned())
                                    .unwrap_or(name),
                                path,
                                file,
                                size,
                                written: 0,
                            };
                            self.progress.due(true);
                            notify_progress(&current, emit);
                            self.current = Some(current);
                        }
                        Err(err) => {
                            self.rx_abort(writer);
                            return Outcome::Stopped(Some(format!(
                                "could not create {name} in {}: {err}",
                                self.folder.display()
                            )));
                        }
                    }
                }
                Action::Event(Event::FileCompleted) => {
                    if let Some(mut current) = self.current.take() {
                        if let Err(err) = current.file.flush() {
                            return Outcome::Stopped(Some(err.to_string()));
                        }
                        notify_progress(&current, emit);
                        self.saved.push(current.path.to_string_lossy().into_owned());
                    }
                }
                Action::Event(Event::SessionCompleted) => {
                    // The receiver queued its ZFIN: write it before leaving.
                    while let Action::WriteWire(bytes) = self.rx.poll() {
                        let n = bytes.len();
                        if writer(bytes).is_err() {
                            break;
                        }
                        self.rx.wire_written(n);
                    }
                    return Outcome::Done;
                }
                Action::Event(Event::Aborted) => return Outcome::Stopped(None),
                _ => return Outcome::Running,
            }
        }
    }

    /// Queues the cancel sequence and writes it.
    fn rx_abort(&mut self, writer: &Writer) {
        if self.rx.abort().is_ok() {
            while let Action::WriteWire(bytes) = self.rx.poll() {
                let n = bytes.len();
                if writer(bytes).is_err() {
                    break;
                }
                self.rx.wire_written(n);
            }
        }
    }

    fn stop(&mut self, reason: Option<String>, emit: &Emit) -> Step {
        self.discard();
        let files = std::mem::take(&mut self.saved);
        emit(Out::Notice(match reason {
            Some(message) => Notice::Failed {
                direction: Direction::Receive,
                message,
                files,
            },
            None => Notice::Cancelled {
                direction: Direction::Receive,
                files,
            },
        }));
        Step::Ended {
            rest: Vec::new(),
            early: true,
        }
    }

    /// The user cancelled: the other end is told and the unfinished file removed.
    pub fn cancel(&mut self, writer: Option<&Writer>, emit: &Emit) {
        if let Some(writer) = writer {
            self.rx_abort(writer);
        }
        self.stop(None, emit);
    }

    /// Removes the file being received, if any.
    pub fn discard(&mut self) {
        if let Some(current) = self.current.take() {
            drop(current.file);
            let _ = std::fs::remove_file(&current.path);
        }
    }

    /// Called every second: a sender silent for a while is answered again, then given up on.
    pub fn tick(&mut self, writer: Option<&Writer>, emit: &Emit) -> Step {
        if !self.begun && self.accepted.elapsed() >= NO_START_AFTER {
            // No CANs: what is on the other end may be a shell, not `sz`.
            let rest = std::mem::take(&mut self.unclaimed);
            self.stop(Some("no file transfer started".into()), emit);
            return Step::Ended { rest, early: false };
        }
        let silent = self.last_heard.elapsed();
        if silent >= GIVE_UP_AFTER {
            if let Some(writer) = writer {
                self.rx_abort(writer);
            }
            return self.stop(Some("the other end stopped answering".into()), emit);
        }
        if self.last_nudge.elapsed() >= NUDGE_AFTER {
            self.last_nudge = Instant::now();
            if self.rx.timeout().is_ok() {
                return self.feed(&[], writer, emit);
            }
        }
        Step::Running
    }
}

fn notify_progress(current: &Current, emit: &Emit) {
    emit(Out::Notice(Notice::Progress {
        direction: Direction::Receive,
        file: current.name.clone(),
        bytes: current.written,
        total: current.size,
    }));
}

#[cfg(test)]
mod room_tests {
    use super::*;

    #[test]
    fn a_file_never_grows_past_its_announced_size() {
        assert!(room("a", Some(10), 0, 10).is_ok());
        assert!(
            room("a", Some(10), 4, 7)
                .unwrap_err()
                .contains("10 bytes announced")
        );
    }

    #[test]
    fn a_file_without_a_size_stops_at_the_limit() {
        assert!(room("a", None, MAX_UNDECLARED - 1, 1).is_ok());
        assert!(
            room("a", None, MAX_UNDECLARED, 1)
                .unwrap_err()
                .contains("has no size")
        );
    }
}
