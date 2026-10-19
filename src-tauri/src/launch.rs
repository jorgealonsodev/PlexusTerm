//! A VS Code workspace file opened with PlexusTerm (`plexusterm project.code-workspace`, or "Open
//! with" in the file manager) opens as a DEV mode tab with its folders. The file given at start is
//! kept until the frontend asks for it. On Unix, the first PlexusTerm listens on a socket in the
//! user's runtime folder: a later launch with a workspace file hands the file to it and ends, so
//! the workspace opens as a tab of the open window. A launch without one is a PlexusTerm of its
//! own, as always.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, State};

/// Event with the path of a workspace file a later launch was given.
pub const OPEN_WORKSPACE_EVENT: &str = "open-workspace";

const WORKSPACE_EXTENSION: &str = "code-workspace";

/// The first `.code-workspace` file among the arguments (the program's own name excluded),
/// absolute: a relative one is taken from `cwd`, the folder the launch ran in.
pub fn workspace_file_in<I, S>(args: I, cwd: &Path) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().skip(1).find_map(|arg| {
        let arg = arg.as_ref();
        let path = Path::new(arg.strip_prefix("file://").unwrap_or(arg));
        let is_workspace = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(WORKSPACE_EXTENSION));
        is_workspace.then(|| if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) })
    })
}

/// The workspace file this launch was given, until the frontend takes it.
#[derive(Default)]
pub struct LaunchWorkspace(Mutex<Option<PathBuf>>);

impl LaunchWorkspace {
    pub fn from_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        Self(Mutex::new(workspace_file_in(std::env::args(), &cwd)))
    }

    /// Whether this launch's workspace file went to an open PlexusTerm (false without one).
    pub fn forwarded(&self) -> bool {
        let file = self.0.lock().ok().and_then(|file| file.clone());
        match (file, socket_path()) {
            (Some(file), Some(socket)) => forward::send(&socket, &file),
            _ => false,
        }
    }
}

/// The workspace file given at start, once: later calls return None.
#[tauri::command]
pub fn launch_workspace_take(launch: State<'_, LaunchWorkspace>) -> Option<String> {
    let mut file = launch.0.lock().ok()?;
    file.take().map(|path| path.to_string_lossy().into_owned())
}

/// The socket in the user's private runtime folder; None without one (no hand-over then).
fn socket_path() -> Option<PathBuf> {
    let dir = std::env::var_os("XDG_RUNTIME_DIR").filter(|dir| !dir.is_empty())?;
    Some(PathBuf::from(dir).join("plexusterm-workspace.sock"))
}

/// Takes the workspace files of later launches, unless another PlexusTerm already does.
pub fn listen(app: AppHandle) {
    if let Some(socket) = socket_path() {
        forward::listen(&socket, move |file| on_forwarded(&app, file));
    }
}

/// A later launch's workspace file: a new DEV tab, in the window brought to the front.
fn on_forwarded(app: &AppHandle, file: PathBuf) {
    use tauri::{Emitter, Manager};
    let _ = app.emit(OPEN_WORKSPACE_EVENT, file.to_string_lossy().into_owned());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(unix)]
mod forward {
    use std::io::{Read, Write};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::{Path, PathBuf};

    /// A path longer than this is not a path a launch sends.
    const MAX_BYTES: u64 = 64 * 1024;

    /// Sends `file` to the PlexusTerm listening on `socket`; false when none does.
    pub fn send(socket: &Path, file: &Path) -> bool {
        UnixStream::connect(socket)
            .and_then(|mut stream| stream.write_all(file.as_os_str().as_encoded_bytes()))
            .is_ok()
    }

    /// Listens on `socket` in the background, unless another PlexusTerm answers there. A socket
    /// left by a PlexusTerm that ended without removing it is replaced.
    pub fn listen(socket: &Path, on_file: impl Fn(PathBuf) + Send + 'static) {
        if UnixStream::connect(socket).is_ok() {
            return;
        }
        let _ = std::fs::remove_file(socket);
        let Ok(listener) = UnixListener::bind(socket) else {
            return;
        };
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut bytes = Vec::new();
                if stream.take(MAX_BYTES).read_to_end(&mut bytes).is_ok() && !bytes.is_empty() {
                    on_file(PathBuf::from(String::from_utf8_lossy(&bytes).into_owned()));
                }
            }
        });
    }
}

#[cfg(not(unix))]
mod forward {
    use std::path::{Path, PathBuf};

    /// No hand-over outside Unix: the launch opens the workspace in a PlexusTerm of its own.
    pub fn send(_socket: &Path, _file: &Path) -> bool {
        false
    }

    pub fn listen(_socket: &Path, _on_file: impl Fn(PathBuf) + Send + 'static) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    const CWD: &str = "/home/me/work";

    fn found(args: &[&str]) -> Option<PathBuf> {
        workspace_file_in(args, Path::new(CWD))
    }

    #[test]
    fn finds_an_absolute_workspace_file() {
        assert_eq!(
            found(&["plexusterm", "/home/me/app.code-workspace"]),
            Some(PathBuf::from("/home/me/app.code-workspace"))
        );
    }

    #[test]
    fn takes_a_relative_workspace_file_from_the_launch_folder() {
        assert_eq!(
            found(&["plexusterm", "app.code-workspace"]),
            Some(PathBuf::from("/home/me/work/app.code-workspace"))
        );
    }

    #[test]
    fn accepts_a_file_uri_and_any_case_of_the_extension() {
        assert_eq!(
            found(&["plexusterm", "file:///home/me/App.CODE-WORKSPACE"]),
            Some(PathBuf::from("/home/me/App.CODE-WORKSPACE"))
        );
    }

    #[test]
    fn ignores_the_program_name_and_other_arguments() {
        assert_eq!(found(&["/opt/x.code-workspace"]), None);
        assert_eq!(found(&["plexusterm", "--verbose", "notes.txt"]), None);
        assert_eq!(found(&[]), None);
        assert_eq!(
            found(&["plexusterm", "notes.txt", "/a/b.code-workspace", "/a/c.code-workspace"]),
            Some(PathBuf::from("/a/b.code-workspace"))
        );
    }

    #[test]
    fn hands_the_start_file_out_once() {
        let launch = LaunchWorkspace(Mutex::new(Some(PathBuf::from("/a/b.code-workspace"))));
        let first = launch.0.lock().unwrap().take();
        assert_eq!(first, Some(PathBuf::from("/a/b.code-workspace")));
        assert_eq!(launch.0.lock().unwrap().take(), None);
    }

    #[cfg(unix)]
    #[test]
    fn hands_a_workspace_file_to_the_listening_plexusterm_only() {
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("plexusterm-workspace.sock");
        // Nobody listens yet: the launch keeps its file.
        assert!(!forward::send(&socket, Path::new("/a/b.code-workspace")));

        // A socket left by an ended PlexusTerm is replaced.
        std::fs::write(&socket, b"").unwrap();
        let (tx, rx) = mpsc::channel();
        forward::listen(&socket, move |file| tx.send(file).unwrap());
        assert!(forward::send(&socket, Path::new("/a/b.code-workspace")));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), PathBuf::from("/a/b.code-workspace"));

        // A second PlexusTerm does not take the socket over.
        let (other_tx, other_rx) = mpsc::channel();
        forward::listen(&socket, move |file| other_tx.send(file).unwrap());
        assert!(forward::send(&socket, Path::new("/a/c.code-workspace")));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), PathBuf::from("/a/c.code-workspace"));
        assert!(other_rx.recv_timeout(Duration::from_millis(200)).is_err());
    }
}
