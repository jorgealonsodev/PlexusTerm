//! Sending files the user picked to the remote's `rz`, from a thread of its own: the session's
//! output (the receiver's answers) reaches it through a channel.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant, UNIX_EPOCH};

use zmodem2::{Action, Event, FileInfo, Position, Sender};

use super::{Direction, Emit, Notice, Out, Progress, Writer, detect};

/// The cancel sequence: CANs that make the other end give up, then backspaces that erase them
/// from a terminal showing them (what lrzsz sends).
pub const ABORT: [u8; 20] = [
    0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08,
    0x08, 0x08, 0x08, 0x08,
];
/// Without an answer from the receiver for this long, the sender asks again.
const WAIT: Duration = Duration::from_secs(10);
/// Unanswered waits in a row before the transfer is given up.
const MAX_WAITS: u32 = 4;
/// Subpackets sent before waiting for an acknowledgement, when the receiver streams nonstop.
const WINDOW: usize = 64;
/// Without the receiver asking for data this long after the user picked the files, the start is
/// taken for text that only looked like `rz` (or an `rz` that already gave up), and what came
/// meanwhile is shown.
#[cfg(not(test))]
const NO_START_AFTER: Duration = Duration::from_secs(10);
#[cfg(test)]
const NO_START_AFTER: Duration = Duration::from_millis(1500);
/// At most this much output is kept to show again in that case.
const UNCLAIMED_MAX: usize = 64 * 1024;
/// Wire errors in a row before the transfer is given up.
const MAX_ERRORS: u32 = 20;

enum ToWorker {
    Wire(Vec<u8>),
    Cancel,
}

/// One file to send.
pub struct Source {
    name: String,
    path: PathBuf,
    file: File,
    size: u32,
    modified: Option<u32>,
}

/// Opens every file before anything is sent, so a missing or unreadable one is reported at once.
pub fn open_all(paths: &[PathBuf]) -> Result<Vec<Source>, String> {
    paths.iter().map(|path| open(path)).collect()
}

fn open(path: &Path) -> Result<Source, String> {
    let shown = path.display();
    let file = File::open(path).map_err(|e| format!("could not open {shown}: {e}"))?;
    let meta = file
        .metadata()
        .map_err(|e| format!("could not read {shown}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{shown} is not a file"));
    }
    let size = u32::try_from(meta.len())
        .map_err(|_| format!("{shown} is larger than 4 GB, which ZMODEM cannot send"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| u32::try_from(d.as_secs()).ok());
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{shown} has no file name"))?;
    Ok(Source {
        name,
        path: path.to_path_buf(),
        file,
        size,
        modified,
    })
}

/// A send running on its worker thread.
pub struct Outbound {
    tx: mpsc::Sender<ToWorker>,
}

impl Outbound {
    /// Starts the worker; `finished(early, rest)` runs when it ends, with the output to show
    /// when the receiver never answered.
    pub fn start(
        files: Vec<Source>,
        writer: Writer,
        emit: Emit,
        finished: impl FnOnce(bool, Vec<u8>) + Send + 'static,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut unclaimed = Vec::new();
            let early = run(files, &writer, &emit, &rx, &mut unclaimed);
            finished(early, unclaimed);
        });
        Self { tx }
    }

    /// Hands the session's output (the receiver's answers) to the worker.
    pub fn forward(&self, bytes: Vec<u8>) {
        let _ = self.tx.send(ToWorker::Wire(bytes));
    }

    pub fn cancel(&self) {
        let _ = self.tx.send(ToWorker::Cancel);
    }
}

/// What ended a send.
enum End {
    Done,
    Cancelled,
    Failed(String),
    /// The receiver never asked for anything: the output it took goes back to the terminal.
    NotStarted,
}

/// Sends `files`; true when it did not complete. `unclaimed` gets the output to show again when
/// the receiver never answered.
fn run(
    files: Vec<Source>,
    writer: &Writer,
    emit: &Emit,
    rx: &mpsc::Receiver<ToWorker>,
    unclaimed: &mut Vec<u8>,
) -> bool {
    let mut sent = Vec::new();
    let end = transfer(files, writer, emit, rx, &mut sent, unclaimed);
    let early = matches!(end, End::Cancelled | End::Failed(_));
    if !matches!(end, End::NotStarted) {
        unclaimed.clear();
    }
    emit(Out::Notice(match end {
        End::Done => Notice::Done {
            direction: Direction::Send,
            files: sent,
        },
        End::Cancelled => Notice::Cancelled {
            direction: Direction::Send,
            files: sent,
        },
        End::Failed(message) => Notice::Failed {
            direction: Direction::Send,
            message,
            files: sent,
        },
        End::NotStarted => Notice::Failed {
            direction: Direction::Send,
            message: "no file transfer started".into(),
            files: sent,
        },
    }));
    early
}

fn transfer(
    files: Vec<Source>,
    writer: &Writer,
    emit: &Emit,
    rx: &mpsc::Receiver<ToWorker>,
    sent: &mut Vec<String>,
    unclaimed: &mut Vec<u8>,
) -> End {
    let mut sender = match Sender::new() {
        Ok(sender) => sender,
        Err(err) => return End::Failed(err.to_string()),
    };
    sender.set_streaming_window(WINDOW);
    let mut files = files.into_iter();
    let mut current = files.next();
    if let Some(source) = &current
        && let Err(err) = start(&mut sender, source)
    {
        return End::Failed(err);
    }
    let mut pending: Vec<u8> = Vec::new();
    let mut buf = vec![0u8; 8192];
    let mut progress = Progress::new();
    let mut waits = 0;
    let mut errors = 0;
    let mut cans = 0;
    let mut cancelled = false;
    let mut begun = false;
    let accepted = Instant::now();
    loop {
        if !begun && accepted.elapsed() >= NO_START_AFTER {
            // No CANs: what is on the other end may be a shell, not `rz`.
            return End::NotStarted;
        }
        match sender.poll() {
            Action::WriteWire(bytes) => {
                let n = bytes.len();
                if let Err(err) = writer(bytes) {
                    return End::Failed(err);
                }
                sender.wire_written(n);
                continue;
            }
            Action::ReadFile { offset, max_len } => {
                begun = true;
                let Some(source) = &mut current else {
                    return End::Failed("the receiver asked for data after the last file".into());
                };
                let len = max_len.min(buf.len());
                let read = read_at(&mut source.file, offset.get(), &mut buf[..len]);
                let n = match read {
                    Ok(n) => n,
                    Err(err) => {
                        sender.abort();
                        flush_wire(&mut sender, writer);
                        return End::Failed(format!("could not read {}: {err}", source.name));
                    }
                };
                if let Err(err) = sender.submit_file(&buf[..n]) {
                    return End::Failed(err.to_string());
                }
                let done = u64::from(offset.get()).saturating_add(n as u64);
                if progress.due(false) {
                    notify(source, done, emit);
                }
                continue;
            }
            Action::Event(Event::FileCompleted) => {
                begun = true;
                if let Some(source) = current.take() {
                    notify(&source, u64::from(source.size), emit);
                    sent.push(source.path.to_string_lossy().into_owned());
                }
                current = files.next();
                let next = match &current {
                    Some(source) => start(&mut sender, source),
                    None => sender.finish().map_err(|e| e.to_string()),
                };
                if let Err(err) = next {
                    return End::Failed(err);
                }
                continue;
            }
            Action::Event(Event::SessionCompleted) => {
                // The closing "OO" is still queued.
                flush_wire(&mut sender, writer);
                return End::Done;
            }
            Action::Event(Event::Aborted) => {
                return if cancelled {
                    End::Cancelled
                } else {
                    End::Failed("the other end cancelled the transfer".into())
                };
            }
            _ => {}
        }
        if !pending.is_empty() {
            match sender.submit_wire(&pending) {
                Ok(0) => {}
                Ok(n) => {
                    pending.drain(..n);
                    errors = 0;
                    continue;
                }
                Err(err) => {
                    pending.clear();
                    errors += 1;
                    if errors > MAX_ERRORS {
                        sender.abort();
                        flush_wire(&mut sender, writer);
                        return End::Failed(format!("too many transfer errors ({err})"));
                    }
                    continue;
                }
            }
        }
        let wait = if begun {
            WAIT
        } else {
            NO_START_AFTER.saturating_sub(accepted.elapsed()).min(WAIT)
        };
        match rx.recv_timeout(wait) {
            Ok(ToWorker::Wire(bytes)) => {
                waits = 0;
                if detect::cancelled(&bytes, &mut cans) {
                    return End::Failed("the other end cancelled the transfer".into());
                }
                if !begun && unclaimed.len() < UNCLAIMED_MAX {
                    let room = UNCLAIMED_MAX - unclaimed.len();
                    unclaimed.extend_from_slice(&bytes[..bytes.len().min(room)]);
                }
                pending.extend_from_slice(&bytes);
            }
            Ok(ToWorker::Cancel) => {
                cancelled = true;
                sender.abort();
            }
            Err(RecvTimeoutError::Timeout) => {
                waits += 1;
                if waits >= MAX_WAITS {
                    sender.abort();
                    flush_wire(&mut sender, writer);
                    return End::Failed("the other end stopped answering".into());
                }
                let _ = sender.timeout();
            }
            Err(RecvTimeoutError::Disconnected) => return End::Cancelled,
        }
    }
}

fn start(sender: &mut Sender, source: &Source) -> Result<(), String> {
    let mut info = FileInfo::new(source.name.as_bytes(), Some(Position::new(source.size)))
        .with_mode(0o100_644);
    if let Some(modified) = source.modified {
        info = info.with_modified(modified);
    }
    sender.start_file(info).map_err(|e| e.to_string())
}

fn read_at(file: &mut File, offset: u32, buf: &mut [u8]) -> std::io::Result<usize> {
    file.seek(SeekFrom::Start(u64::from(offset)))?;
    let mut filled = 0;
    while filled < buf.len() {
        match file.read(&mut buf[filled..])? {
            0 => break,
            n => filled += n,
        }
    }
    Ok(filled)
}

/// Writes what the sender still has queued (the cancel sequence, the closing "OO").
fn flush_wire(sender: &mut Sender, writer: &Writer) {
    while let Action::WriteWire(bytes) = sender.poll() {
        let n = bytes.len();
        if writer(bytes).is_err() {
            break;
        }
        sender.wire_written(n);
    }
}

fn notify(source: &Source, bytes: u64, emit: &Emit) {
    emit(Out::Notice(Notice::Progress {
        direction: Direction::Send,
        file: source.name.clone(),
        bytes,
        total: Some(u64::from(source.size)),
    }));
}
