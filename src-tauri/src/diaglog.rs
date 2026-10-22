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
    info(&graphics_environment(|name| std::env::var(name).ok()));
    let cards = graphics_cards(Path::new("/sys/class/drm"));
    if !cards.is_empty() {
        info(&format!("graphics cards: {}", cards.join(", ")));
    }
    start_watchdog();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

/// Variables that decide how WebKit draws (set by the user's session or by PlexusTerm at startup).
const GRAPHICS_VARS: &[&str] = &[
    "XDG_SESSION_TYPE",
    "WAYLAND_DISPLAY",
    "DISPLAY",
    "GDK_BACKEND",
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "__NV_DISABLE_EXPLICIT_SYNC",
    "LIBGL_ALWAYS_SOFTWARE",
];

/// The graphics cards Linux lists in `drm` (`/sys/class/drm/cardN`), as `AMD 0x73df (amdgpu)`:
/// WebKit hides the GPU's name from WebGL, so it is read here.
fn graphics_cards(drm: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(drm) else {
        return Vec::new();
    };
    let mut cards: Vec<_> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            name.starts_with("card")
                && name[4..].chars().all(|c| c.is_ascii_digit())
                && name.len() > 4
        })
        .map(|e| e.path().join("device"))
        .collect();
    cards.sort();
    cards
        .iter()
        .map(|device| {
            let read = |file: &str| {
                std::fs::read_to_string(device.join(file))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            };
            let vendor = match read("vendor").as_str() {
                "0x1002" => "AMD".to_string(),
                "0x10de" => "NVIDIA".to_string(),
                "0x8086" => "Intel".to_string(),
                other => other.to_string(),
            };
            let driver = std::fs::read_link(device.join("driver"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .unwrap_or_else(|| "no driver".into());
            format!("{vendor} {} ({driver})", read("device"))
        })
        .collect()
}

/// `graphics environment: XDG_SESSION_TYPE=wayland …, NVIDIA driver yes`, for the variables set.
fn graphics_environment(var: impl Fn(&str) -> Option<String>) -> String {
    let set: Vec<String> = GRAPHICS_VARS
        .iter()
        .filter_map(|name| var(name).map(|value| format!("{name}={value}")))
        .collect();
    let nvidia = if Path::new("/proc/driver/nvidia").exists() {
        "yes"
    } else {
        "no"
    };
    format!(
        "graphics environment: {}, NVIDIA driver {nvidia}",
        if set.is_empty() {
            "none set".into()
        } else {
            set.join(" ")
        }
    )
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

/// A timer this much late means the interface thread was blocked. The interface reports no lateness
/// while the window is hidden, whose timers WebKit fires once every two seconds on purpose.
const BLOCKED_AFTER_MS: u64 = 1000;

/// The interface is alive; `late_ms` is how much later than due its timer fired (a blocked UI thread).
// Both are async and write on the blocking pool: a sync command runs on the main thread, and the
// log file is on disk.
#[tauri::command]
pub async fn diag_heartbeat(late_ms: u64) {
    UI_BEAT.store(now_millis(), Ordering::Relaxed);
    if late_ms >= BLOCKED_AFTER_MS {
        let message = format!(
            "interface thread was blocked for about {:.1} s",
            late_ms as f64 / 1000.0
        );
        let _ = tauri::async_runtime::spawn_blocking(move || warn(&message)).await;
    }
}

/// An entry from the interface (errors, slow backend replies).
#[tauri::command]
pub async fn diag_log(level: String, message: String) {
    let level = match level.as_str() {
        "error" => "ERROR",
        "warn" => "WARN",
        _ => "INFO",
    };
    let message = format!("[ui] {}", message.chars().take(2000).collect::<String>());
    let _ = tauri::async_runtime::spawn_blocking(move || log(level, &message)).await;
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
    fn names_the_graphics_variables_that_are_set() {
        let line = graphics_environment(|name| match name {
            "XDG_SESSION_TYPE" => Some("wayland".into()),
            "WEBKIT_DMABUF_RENDERER_FORCE_SHM" => Some("1".into()),
            _ => None,
        });
        assert!(
            line.starts_with("graphics environment: XDG_SESSION_TYPE=wayland WEBKIT_DMABUF_RENDERER_FORCE_SHM=1, NVIDIA driver "),
            "{line}"
        );
        assert!(graphics_environment(|_| None).starts_with("graphics environment: none set,"));
    }

    #[test]
    fn names_the_graphics_cards_with_their_vendor_and_driver() {
        let drm = tempfile::tempdir().unwrap();
        let card = |name: &str, vendor: &str, device: &str, driver: Option<&str>| {
            let dev = drm.path().join(name).join("device");
            std::fs::create_dir_all(&dev).unwrap();
            std::fs::write(dev.join("vendor"), format!("{vendor}\n")).unwrap();
            std::fs::write(dev.join("device"), format!("{device}\n")).unwrap();
            if let Some(driver) = driver {
                let target = drm.path().join("drivers").join(driver);
                std::fs::create_dir_all(&target).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(&target, dev.join("driver")).unwrap();
            }
        };
        card("card1", "0x1002", "0x73df", Some("amdgpu"));
        card("card0", "0x10de", "0x2484", None);
        // Connectors are not cards.
        std::fs::create_dir_all(drm.path().join("card1-HDMI-A-1")).unwrap();
        let cards = graphics_cards(drm.path());
        assert_eq!(cards[0], "NVIDIA 0x2484 (no driver)");
        #[cfg(unix)]
        assert_eq!(cards[1], "AMD 0x73df (amdgpu)");
        assert_eq!(cards.len(), 2);
        assert!(graphics_cards(&drm.path().join("missing")).is_empty());
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
