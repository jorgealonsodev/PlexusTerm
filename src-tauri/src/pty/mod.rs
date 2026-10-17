//! Local pseudo-terminal sessions, independent of Tauri so they can be tested directly.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};

use crate::platform;
use crate::terminal::{TerminalSink, Utf8Stream};

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    /// Program to run; missing or blank runs the user's shell (see [`platform::default_shell`]).
    pub program: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    /// Starting directory (`~/` expanded); missing or blank starts in the home directory.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Extra environment for the child, set only by Rust (e.g. `MOSH_KEY`): the frontend
    /// cannot send it.
    #[serde(skip)]
    pub env: ChildEnv,
}

/// Environment variables passed to a child process. `Debug` shows only their names,
/// so values such as `MOSH_KEY` never reach logs or panic messages.
#[derive(Clone, Default)]
pub struct ChildEnv(Vec<(String, String)>);

impl ChildEnv {
    pub fn new(vars: impl IntoIterator<Item = (String, String)>) -> Self {
        Self(vars.into_iter().collect())
    }

    #[cfg(all(test, unix))]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for ChildEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list()
            .entries(self.0.iter().map(|(name, _)| name))
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("unknown terminal session {0}")]
    UnknownSession(u32),
    #[error("{0}")]
    Io(String),
}

impl serde::Serialize for PtyError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

fn io_err(err: impl std::fmt::Display) -> PtyError {
    PtyError::Io(err.to_string())
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// The program to run: the requested one, or the user's shell when it is missing or blank.
fn program_of(req: &SpawnRequest) -> String {
    match req.program.as_deref().map(str::trim) {
        Some(program) if !program.is_empty() => program.to_string(),
        _ => platform::default_shell(),
    }
}

/// The starting directory: the requested one with a leading `~` expanded, or the home
/// directory when it is missing or blank.
fn cwd_of(req: &SpawnRequest) -> Option<PathBuf> {
    match req.cwd.as_deref().map(str::trim) {
        Some("~") | None => platform::home_dir(),
        Some("") => platform::home_dir(),
        Some(dir) => Some(platform::expand_home(dir)),
    }
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl PtyManager {
    pub fn spawn(&self, req: SpawnRequest, sink: impl TerminalSink) -> Result<u32, PtyError> {
        let pair = native_pty_system()
            .openpty(size(req.cols, req.rows))
            .map_err(io_err)?;

        let mut cmd = CommandBuilder::new(program_of(&req));
        cmd.args(&req.args);
        if let Some(dir) = cwd_of(&req) {
            cmd.cwd(dir);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (name, value) in &req.env.0 {
            cmd.env(name, value);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(io_err)?;
        // Drop our copy of the slave so the reader sees EOF when the child exits.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(io_err)?;
        let writer = pair.master.take_writer().map_err(io_err)?;
        let killer = child.clone_killer();

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer,
            },
        );

        std::thread::spawn(move || {
            let mut decoder = Utf8Stream::default();
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = decoder.push(&buf[..n]);
                        if !text.is_empty() {
                            sink.data(text);
                        }
                    }
                }
            }
            let code = child.wait().ok().map(|status| status.exit_code());
            sink.exit(code);
        });

        Ok(id)
    }

    fn with_session<T>(
        &self,
        id: u32,
        f: impl FnOnce(&mut Session) -> Result<T, PtyError>,
    ) -> Result<T, PtyError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.get_mut(&id).ok_or(PtyError::UnknownSession(id))?;
        f(session)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), PtyError> {
        self.with_session(id, |s| {
            s.writer.write_all(data).map_err(io_err)?;
            s.writer.flush().map_err(io_err)
        })
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), PtyError> {
        self.with_session(id, |s| s.master.resize(size(cols, rows)).map_err(io_err))
    }

    pub fn close(&self, id: u32) -> Result<(), PtyError> {
        let mut session = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(PtyError::UnknownSession(id))?;
        // The process may already be gone; dropping the session closes the PTY either way.
        let _ = session.killer.kill();
        Ok(())
    }
}

// The tests run /bin/sh and other Unix programs.
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::time::{Duration, Instant};

    enum Event {
        Data(String),
        Exit(Option<u32>),
    }

    struct TestSink(Sender<Event>);

    impl TerminalSink for TestSink {
        fn data(&self, text: String) {
            let _ = self.0.send(Event::Data(text));
        }
        fn exit(&self, code: Option<u32>) {
            let _ = self.0.send(Event::Exit(code));
        }
    }

    fn sink() -> (TestSink, Receiver<Event>) {
        let (tx, rx) = channel();
        (TestSink(tx), rx)
    }

    fn req(program: &str, args: &[&str]) -> SpawnRequest {
        SpawnRequest {
            program: Some(program.into()),
            args: args.iter().map(|a| a.to_string()).collect(),
            cwd: None,
            cols: 80,
            rows: 24,
            env: ChildEnv::default(),
        }
    }

    #[test]
    fn extra_environment_reaches_the_process() {
        let mgr = PtyManager::default();
        let (s, rx) = sink();
        let mut request = req("/bin/sh", &["-c", "echo \"value=$PLEXUS_TEST_VAR\""]);
        request.env = ChildEnv::new([("PLEXUS_TEST_VAR".into(), "abc123".into())]);
        mgr.spawn(request, s).unwrap();
        let (out, _) = wait_for(&rx, "value=abc123");
        assert!(out.contains("value=abc123"), "output was {out:?}");
    }

    #[test]
    fn extra_environment_is_never_read_from_the_frontend_nor_shown_in_debug() {
        let request: SpawnRequest =
            serde_json::from_str(r#"{ "cols": 80, "rows": 24, "env": { "MOSH_KEY": "x" } }"#)
                .unwrap();
        assert!(request.env.is_empty());
        let mut request = req("/bin/true", &[]);
        request.env = ChildEnv::new([("MOSH_KEY".into(), "s3cr3t-value".into())]);
        let debug = format!("{request:?}");
        assert!(debug.contains("MOSH_KEY"), "{debug}");
        assert!(!debug.contains("s3cr3t-value"), "{debug}");
    }

    fn home() -> String {
        std::env::var("HOME").unwrap()
    }

    #[test]
    fn a_starting_directory_with_a_tilde_starts_in_the_home_directory() {
        for cwd in ["~", "~/"] {
            let mgr = PtyManager::default();
            let (s, rx) = sink();
            let mut request = req("/bin/sh", &["-c", "echo \"cwd=$(pwd -P)\""]);
            request.cwd = Some(cwd.into());
            mgr.spawn(request, s).unwrap();
            let expected = format!("cwd={}", std::fs::canonicalize(home()).unwrap().display());
            let (out, _) = wait_for(&rx, &expected);
            assert!(out.contains(&expected), "{cwd}: output was {out:?}");
        }
    }

    #[test]
    fn a_blank_program_or_directory_keeps_the_defaults() {
        let request: SpawnRequest = serde_json::from_str(
            r#"{ "program": "  ", "args": [], "cwd": " ", "cols": 80, "rows": 24 }"#,
        )
        .unwrap();
        assert_eq!(program_of(&request), platform::default_shell());
        assert_eq!(cwd_of(&request), platform::home_dir());
    }

    #[test]
    fn a_program_that_does_not_exist_is_an_error() {
        let mgr = PtyManager::default();
        let (s, _rx) = sink();
        let err = mgr
            .spawn(req("/nonexistent/plexus-shell", &[]), s)
            .unwrap_err();
        assert!(matches!(err, PtyError::Io(_)), "{err:?}");
    }

    /// Collects output until `needle` appears or the process exits.
    fn wait_for(rx: &Receiver<Event>, needle: &str) -> (String, Option<Option<u32>>) {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut out = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Event::Data(t)) => {
                    out.push_str(&t);
                    if !needle.is_empty() && out.contains(needle) {
                        return (out, None);
                    }
                }
                Ok(Event::Exit(code)) => return (out, Some(code)),
                Err(_) => {}
            }
        }
        (out, None)
    }

    #[test]
    fn streams_output_and_reports_exit_code() {
        let mgr = PtyManager::default();
        let (s, rx) = sink();
        mgr.spawn(req("/bin/sh", &["-c", "echo hello; exit 3"]), s)
            .unwrap();
        let (out, exit) = wait_for(&rx, "");
        assert!(out.contains("hello"), "output was {out:?}");
        assert_eq!(exit, Some(Some(3)));
    }

    #[test]
    fn writes_input_to_the_process() {
        let mgr = PtyManager::default();
        let (s, rx) = sink();
        let id = mgr.spawn(req("/bin/cat", &[]), s).unwrap();
        mgr.write(id, b"ping\n").unwrap();
        let (out, _) = wait_for(&rx, "ping");
        assert!(out.contains("ping"), "output was {out:?}");
        mgr.close(id).unwrap();
    }

    #[test]
    fn resize_changes_the_terminal_size() {
        let mgr = PtyManager::default();
        let (s, rx) = sink();
        let id = mgr
            .spawn(req("/bin/sh", &["-c", "read _; stty size"]), s)
            .unwrap();
        mgr.resize(id, 100, 40).unwrap();
        mgr.write(id, b"\n").unwrap();
        let (out, _) = wait_for(&rx, "40 100");
        assert!(out.contains("40 100"), "output was {out:?}");
    }

    #[test]
    fn close_kills_the_process_and_forgets_the_session() {
        let mgr = PtyManager::default();
        let (s, rx) = sink();
        let id = mgr.spawn(req("/bin/sleep", &["30"]), s).unwrap();
        mgr.close(id).unwrap();
        let (_, exit) = wait_for(&rx, "");
        assert!(exit.is_some(), "process did not exit after close");
        assert!(matches!(
            mgr.write(id, b"x"),
            Err(PtyError::UnknownSession(_))
        ));
    }

    #[test]
    fn unknown_session_is_an_error() {
        let mgr = PtyManager::default();
        assert!(matches!(
            mgr.resize(99, 1, 1),
            Err(PtyError::UnknownSession(99))
        ));
        assert!(matches!(mgr.close(99), Err(PtyError::UnknownSession(99))));
    }
}
