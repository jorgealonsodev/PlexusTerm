//! Diagnostic log, turned on in Settings > About: what PlexusTerm does (sessions opened and closed,
//! errors, panics) and when it stops responding, in `<folder>/plexusterm.log`. A watchdog thread
//! notes when the interface stops sending its heartbeat (the window froze) or the async runtime
//! stops ticking (the backend froze). Never terminal text, typed input or passwords.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const LOG_FILE: &str = "plexusterm.log";
/// Past this size the log moves to `plexusterm.log.1` (replacing the older one) and starts again.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// Longer than this without a heartbeat counts as frozen.
const STALL_AFTER: Duration = Duration::from_secs(5);
const WATCH_EVERY: Duration = Duration::from_secs(1);

/// The open log file, or None while the log is off.
struct Sink {
    path: PathBuf,
    file: std::fs::File,
}

fn sink() -> &'static Mutex<Option<Sink>> {
    static SINK: OnceLock<Mutex<Option<Sink>>> = OnceLock::new();
    SINK.get_or_init(|| Mutex::new(None))
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `2026-10-22 09:15:03.120` in UTC, without pulling in a date library.
fn timestamp(millis: u64) -> String {
    let secs = millis / 1000;
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem / 60 % 60,
        rem % 60,
        millis % 1000
    )
}

fn open(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
}

/// Starts writing to `<dir>/plexusterm.log`, or stops with None; returns the file's path.
pub fn configure(dir: Option<&Path>) -> std::io::Result<Option<PathBuf>> {
    let mut sink = sink().lock().unwrap_or_else(|e| e.into_inner());
    let Some(dir) = dir else {
        if sink.is_some() {
            write_line(&mut sink, "INFO", "diagnostic log off");
        }
        *sink = None;
        return Ok(None);
    };
    let path = dir.join(LOG_FILE);
    if sink.as_ref().is_some_and(|s| s.path == path) {
        return Ok(Some(path));
    }
    std::fs::create_dir_all(dir)?;
    let file = open(&path)?;
    *sink = Some(Sink {
        path: path.clone(),
        file,
    });
    write_line(
        &mut sink,
        "INFO",
        &format!(
            "diagnostic log on: PlexusTerm {} ({} {})",
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    );
    Ok(Some(path))
}

fn write_line(sink: &mut Option<Sink>, level: &str, message: &str) {
    let Some(s) = sink.as_mut() else { return };
    if s.file.metadata().map(|m| m.len()).unwrap_or(0) >= MAX_LOG_BYTES {
        let _ = std::fs::rename(&s.path, s.path.with_extension("log.1"));
        match open(&s.path) {
            Ok(file) => s.file = file,
            Err(_) => return,
        }
    }
    // One line per entry, so a message cannot fake another one.
    let message = message.replace(['\n', '\r'], " ");
    let _ = writeln!(s.file, "{} {level:<5} {message}", timestamp(now_millis()));
}

/// Appends one entry when the log is on.
pub fn log(level: &str, message: &str) {
    let mut sink = sink().lock().unwrap_or_else(|e| e.into_inner());
    write_line(&mut sink, level, message);
}

pub fn info(message: &str) {
    log("INFO", message);
}

pub fn warn(message: &str) {
    log("WARN", message);
}

/// Last heartbeat of the interface and the last tick of the async runtime, in ms since the epoch.
static UI_BEAT: AtomicU64 = AtomicU64::new(0);
static RUNTIME_TICK: AtomicU64 = AtomicU64::new(0);

/// What the watchdog has already reported, so a freeze is logged once when it starts and once when it ends.
#[derive(Default)]
struct Watch {
    ui_stalled_since: Option<u64>,
    runtime_stalled_since: Option<u64>,
}

/// One heartbeat source: the message to log, if its state changed at `now`.
fn check(
    name: &str,
    last: u64,
    now: u64,
    stalled_since: &mut Option<u64>,
) -> Option<(&'static str, String)> {
    if last == 0 {
        return None;
    }
    let quiet = now.saturating_sub(last);
    match *stalled_since {
        None if quiet >= STALL_AFTER.as_millis() as u64 => {
            *stalled_since = Some(last);
            Some((
                "WARN",
                format!("{name} not responding for {:.1} s", quiet as f64 / 1000.0),
            ))
        }
        Some(since) if quiet < STALL_AFTER.as_millis() as u64 => {
            *stalled_since = None;
            Some((
                "INFO",
                format!(
                    "{name} responding again after {:.1} s",
                    (last.saturating_sub(since)) as f64 / 1000.0
                ),
            ))
        }
        _ => None,
    }
}

impl Watch {
    fn step(&mut self, now: u64, ui: u64, runtime: u64) -> Vec<(&'static str, String)> {
        [
            check("interface (window)", ui, now, &mut self.ui_stalled_since),
            check(
                "backend async runtime",
                runtime,
                now,
                &mut self.runtime_stalled_since,
            ),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

/// Starts the runtime ticker and the watchdog thread (once), and logs panics.
pub fn start_watchdog() {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        log(
            "ERROR",
            &format!("panic in thread {}: {info}", thread.name().unwrap_or("?")),
        );
        previous(info);
    }));
    tauri::async_runtime::spawn(async {
        loop {
            RUNTIME_TICK.store(now_millis(), Ordering::Relaxed);
            tokio::time::sleep(WATCH_EVERY).await;
        }
    });
    let _ = std::thread::Builder::new()
        .name("diag-watchdog".into())
        .spawn(|| {
            let mut watch = Watch::default();
            loop {
                std::thread::sleep(WATCH_EVERY);
                let ui = UI_BEAT.load(Ordering::Relaxed);
                let runtime = RUNTIME_TICK.load(Ordering::Relaxed);
                for (level, message) in watch.step(now_millis(), ui, runtime) {
                    log(level, &message);
                }
            }
        });
}

/// Turns the log on in `dir` ("" = the app's log folder) or off; returns the file in use.
#[tauri::command]
pub fn diag_log_configure(
    app: tauri::AppHandle,
    enabled: bool,
    dir: String,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    if !enabled {
        UI_BEAT.store(0, Ordering::Relaxed);
        return configure(None).map(|_| None).map_err(|e| e.to_string());
    }
    let dir = match dir.trim() {
        "" => app.path().app_log_dir().map_err(|e| e.to_string())?,
        d => PathBuf::from(d),
    };
    let path = configure(Some(&dir)).map_err(|e| format!("{}: {e}", dir.display()))?;
    start_watchdog();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

/// The folder the log goes to when none is chosen.
#[tauri::command]
pub fn diag_log_default_dir(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    app.path()
        .app_log_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

/// The interface is alive; `late_ms` is how much later than due its timer fired (a blocked UI thread).
#[tauri::command]
pub fn diag_heartbeat(late_ms: u64) {
    UI_BEAT.store(now_millis(), Ordering::Relaxed);
    if late_ms >= 1000 {
        warn(&format!(
            "interface thread was blocked for about {:.1} s",
            late_ms as f64 / 1000.0
        ));
    }
}

/// An entry from the interface (errors, slow backend replies).
#[tauri::command]
pub fn diag_log(level: String, message: String) {
    let level = match level.as_str() {
        "error" => "ERROR",
        "warn" => "WARN",
        _ => "INFO",
    };
    log(
        level,
        &format!("[ui] {}", message.chars().take(2000).collect::<String>()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_timestamps() {
        assert_eq!(timestamp(0), "1970-01-01 00:00:00.000Z");
        assert_eq!(timestamp(1_792_660_503_120), "2026-10-22 09:15:03.120Z");
        assert_eq!(timestamp(951_782_400_000), "2000-02-29 00:00:00.000Z");
    }

    #[test]
    fn a_freeze_is_logged_once_when_it_starts_and_once_when_it_ends() {
        let mut watch = Watch::default();
        let t = 1_000_000;
        assert!(watch.step(t, t, t).is_empty());
        let start = watch.step(t + 6_000, t, t + 6_000);
        assert_eq!(start.len(), 1);
        assert_eq!(start[0].0, "WARN");
        assert!(
            start[0]
                .1
                .starts_with("interface (window) not responding for 6.0 s"),
            "{start:?}"
        );
        assert!(watch.step(t + 9_000, t, t + 9_000).is_empty());
        let end = watch.step(t + 12_000, t + 11_500, t + 12_000);
        assert_eq!(
            end,
            vec![(
                "INFO",
                "interface (window) responding again after 11.5 s".to_string()
            )]
        );
        assert!(watch.step(t + 13_000, t + 13_000, t + 13_000).is_empty());
    }

    #[test]
    fn a_source_that_never_beat_is_not_reported() {
        let mut watch = Watch::default();
        assert!(watch.step(10_000_000, 0, 0).is_empty());
    }

    #[test]
    fn writes_entries_only_while_on_and_rotates_when_full() {
        let dir = tempfile::tempdir().unwrap();
        let path = configure(Some(dir.path())).unwrap().unwrap();
        assert_eq!(path, dir.path().join(LOG_FILE));
        info("first\nline");
        configure(None).unwrap();
        info("while off");
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(
            text.contains("INFO  diagnostic log on: PlexusTerm"),
            "{text}"
        );
        assert!(text.contains("INFO  first line"), "{text}");
        assert!(text.contains("diagnostic log off"), "{text}");
        assert!(!text.contains("while off"), "{text}");

        std::fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        configure(Some(dir.path())).unwrap();
        warn("after rotation");
        configure(None).unwrap();
        assert_eq!(
            std::fs::metadata(path.with_extension("log.1"))
                .unwrap()
                .len(),
            MAX_LOG_BYTES
        );
        assert!(
            std::fs::read_to_string(&path)
                .unwrap()
                .contains("WARN  after rotation")
        );
    }
}
