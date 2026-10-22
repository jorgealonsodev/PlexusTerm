//! A VS Code workspace file opened with PlexusTerm (`plexusterm project.code-workspace`, or "Open
//! with" in the file manager) opens as a DEV mode tab with its folders. The file given at start is
//! kept until the frontend asks for it. On Unix, the first PlexusTerm listens on a socket in the
//! user's runtime folder: a later launch with a workspace file hands the file to it and ends, so
//! the workspace opens as a tab of the open window. A launch without one is a PlexusTerm of its
//! own, as always.
//!
//! A folder given the same way (`plexusterm ~/src`, `plexusterm --working-directory ~/src`, or
//! `PLEXUSTERM_START_DIR` set by a launcher) opens a local terminal there, handed over the same
//! way. The variable is removed from PlexusTerm's environment, so its terminals do not inherit it.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, State};

/// Event with the path of a workspace file a later launch was given.
pub const OPEN_WORKSPACE_EVENT: &str = "open-workspace";
/// Event with the folder a later launch was given.
pub const OPEN_FOLDER_EVENT: &str = "open-folder";
/// The variable a launcher may set to the folder to start in.
const START_DIR_VAR: &str = "PLEXUSTERM_START_DIR";
/// The option that names the folder to start in, as in other terminals.
const WORKING_DIRECTORY: &str = "--working-directory";

const WORKSPACE_EXTENSION: &str = "code-workspace";

/// `arg` as an absolute path: a `file://` URI is unwrapped, a relative path is taken from `cwd`.
fn absolute(arg: &str, cwd: &Path) -> PathBuf {
    let path = Path::new(arg.strip_prefix("file://").unwrap_or(arg));
    if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) }
}

/// What a launch opens, from its arguments (the program's own name excluded): the first
/// `.code-workspace` file, the folder of `--working-directory DIR` (or `=DIR`), or a folder given
/// as is (`is_dir` tells); absolute, a relative one taken from `cwd`, the folder the launch ran in.
pub fn launch_path_in<I, S>(args: I, cwd: &Path, is_dir: impl Fn(&Path) -> bool) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut args = args.into_iter().skip(1);
    while let Some(arg) = args.next() {
        let arg = arg.as_ref();
        let dir = if arg == WORKING_DIRECTORY {
            args.next().map(|dir| dir.as_ref().to_string())
        } else {
            arg.strip_prefix(WORKING_DIRECTORY)
                .and_then(|rest| rest.strip_prefix('='))
                .map(str::to_string)
        };
        if let Some(dir) = dir {
            let dir = absolute(&dir, cwd);
            if is_dir(&dir) {
                return Some(dir);
            }
            continue;
        }
        let path = absolute(arg, cwd);
        let is_workspace = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(WORKSPACE_EXTENSION));
        if is_workspace || is_dir(&path) {
            return Some(path);
        }
    }
    None
}

/// The workspace file or folder this launch was given, until the frontend takes it.
#[derive(Default)]
pub struct LaunchWorkspace(Mutex<Option<PathBuf>>);

impl LaunchWorkspace {
    /// Reads the arguments, else `PLEXUSTERM_START_DIR`, and removes that variable from the
    /// environment. Called before any thread starts.
    pub fn from_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        let start_dir = std::env::var_os(START_DIR_VAR)
            .filter(|dir| !dir.is_empty())
            .map(|dir| absolute(&dir.to_string_lossy(), &cwd))
            .filter(|dir| dir.is_dir());
        // SAFETY: no other thread exists yet to read or write the environment.
        unsafe { std::env::remove_var(START_DIR_VAR) };
        let path = launch_path_in(std::env::args(), &cwd, Path::is_dir).or(start_dir);
        Self(Mutex::new(path))
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

/// The path given at start when `wanted` accepts it, once: later calls return None.
fn take_if(launch: &LaunchWorkspace, wanted: impl Fn(&Path) -> bool) -> Option<String> {
    let mut path = launch.0.lock().ok()?;
    if !path.as_deref().is_some_and(wanted) {
        return None;
    }
    path.take().map(|path| path.to_string_lossy().into_owned())
}

/// The workspace file given at start, once: later calls return None.
#[tauri::command]
pub fn launch_workspace_take(launch: State<'_, LaunchWorkspace>) -> Option<String> {
    take_if(&launch, |path| !path.is_dir())
}

/// The folder given at start, once: later calls return None.
#[tauri::command]
pub fn launch_folder_take(launch: State<'_, LaunchWorkspace>) -> Option<String> {
    take_if(&launch, Path::is_dir)
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

/// A later launch's workspace file (a new DEV tab) or folder (a new terminal there), in the
/// window brought to the front.
fn on_forwarded(app: &AppHandle, file: PathBuf) {
    use tauri::{Emitter, Manager};
    let event = if file.is_dir() { OPEN_FOLDER_EVENT } else { OPEN_WORKSPACE_EVENT };
    let _ = app.emit(event, file.to_string_lossy().into_owned());
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
        launch_path_in(args, Path::new(CWD), |_| false)
    }

    /// With `/home/me/src` and `/home/me/work/docs` as the only folders.
    fn found_with_folders(args: &[&str]) -> Option<PathBuf> {
        launch_path_in(args, Path::new(CWD), |path| {
            path == Path::new("/home/me/src") || path == Path::new("/home/me/work/docs")
        })
    }

    #[test]
    fn finds_a_folder_given_as_is_or_with_working_directory() {
        let src = Some(PathBuf::from("/home/me/src"));
        assert_eq!(found_with_folders(&["plexusterm", "/home/me/src"]), src);
        assert_eq!(found_with_folders(&["plexusterm", "file:///home/me/src"]), src);
        assert_eq!(found_with_folders(&["plexusterm", "--working-directory", "/home/me/src"]), src);
        assert_eq!(found_with_folders(&["plexusterm", "--working-directory=/home/me/src"]), src);
        assert_eq!(
            found_with_folders(&["plexusterm", "docs"]),
            Some(PathBuf::from("/home/me/work/docs"))
        );
    }

    #[test]
    fn ignores_a_missing_folder_and_files_that_are_not_workspaces() {
        assert_eq!(found_with_folders(&["plexusterm", "/home/me/gone"]), None);
        assert_eq!(found_with_folders(&["plexusterm", "--working-directory", "/home/me/gone"]), None);
        assert_eq!(found_with_folders(&["plexusterm", "--working-directory"]), None);
        assert_eq!(found_with_folders(&["plexusterm", "notes.txt"]), None);
        // The first thing a launch can open wins.
        assert_eq!(
            found_with_folders(&["plexusterm", "/home/me/gone", "/home/me/src", "/a/b.code-workspace"]),
            Some(PathBuf::from("/home/me/src"))
        );
    }

    #[test]
    fn hands_a_folder_or_a_workspace_file_out_to_its_own_command_only() {
        let dir = tempfile::tempdir().unwrap();
        let folder = LaunchWorkspace(Mutex::new(Some(dir.path().to_path_buf())));
        assert_eq!(take_if(&folder, |path| !path.is_dir()), None);
        assert_eq!(take_if(&folder, Path::is_dir), Some(dir.path().to_string_lossy().into_owned()));
        assert_eq!(take_if(&folder, Path::is_dir), None);
        let file = LaunchWorkspace(Mutex::new(Some(dir.path().join("app.code-workspace"))));
        assert_eq!(take_if(&file, Path::is_dir), None);
        assert!(take_if(&file, |path| !path.is_dir()).is_some());
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
