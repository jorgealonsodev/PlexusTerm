//! Operating-system details behind small helpers, so the rest of the crate has no `cfg`s:
//! home directory, default shell, program lookup, SSH agent endpoint, private files and
//! serial ports.
//!
//! The decisions are pure functions taking an [`Os`] and an environment lookup, so the
//! Windows rules are unit-tested on Linux too; the public wrappers apply them to this machine.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// The platform families PlexusTerm distinguishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Unix,
    Windows,
}

/// The family this binary was built for.
pub const CURRENT: Os = if cfg!(windows) { Os::Windows } else { Os::Unix };

/// Reads one environment variable.
type EnvLookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;
/// Finds a program by name on the search path.
type ProgramLookup<'a> = &'a dyn Fn(&str) -> Option<PathBuf>;

/// Windows OpenSSH agent pipe, used when `SSH_AUTH_SOCK` is not set.
pub const WINDOWS_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// `"linux"`, `"windows"` or `"macos"` (the frontend adapts a few texts to it).
pub fn name() -> &'static str {
    std::env::consts::OS
}

fn env(name: &str) -> Option<OsString> {
    std::env::var_os(name)
}

/// WebKitGTK's variables for how a page's frames reach the window (Linux only, and its tests).
#[cfg(any(target_os = "linux", test))]
const WEBKIT_DMABUF_VARS: [&str; 3] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
];

/// The variables that pick which EGL driver (glvnd vendor) a program loads.
#[cfg(any(target_os = "linux", test))]
const EGL_VENDOR_VARS: [&str; 2] = [
    "__EGL_VENDOR_LIBRARY_FILENAMES",
    "__EGL_VENDOR_LIBRARY_DIRS",
];

/// Mesa's EGL vendor file, where the glvnd packages of the main distributions install it.
#[cfg(any(target_os = "linux", test))]
const MESA_EGL_VENDOR: &str = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";

/// The WebKitGTK variables to set on Linux. With NVIDIA's own driver, frames handed over as GPU
/// buffers (GBM) reach the window several frames late, so the terminal lags behind typing; through
/// shared memory they do not. Other drivers keep WebKitGTK's own, faster choice, and so does a
/// user who set any of these variables.
///
/// NVIDIA's EGL driver can also hang WebKit's compositor for good, spinning while it waits for a
/// frame (seen with driver 580 and GPU acceleration on). When another GPU runs a Mesa driver
/// (`mesa_gpu`), WebKit draws there instead: the frames reach the window through shared memory
/// whichever card shows it. An EGL vendor the user chose is kept.
#[cfg(any(target_os = "linux", test))]
pub fn webkit_env_in(
    nvidia_driver: bool,
    mesa_gpu: bool,
    env: EnvLookup,
) -> Vec<(&'static str, &'static str)> {
    let mut vars = Vec::new();
    if !nvidia_driver {
        return vars;
    }
    if !WEBKIT_DMABUF_VARS.iter().any(|name| env(name).is_some()) {
        vars.push(("WEBKIT_FORCE_DMABUF_RENDERER", "1"));
        vars.push(("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"));
    }
    if mesa_gpu && !EGL_VENDOR_VARS.iter().any(|name| env(name).is_some()) {
        vars.push(("__EGL_VENDOR_LIBRARY_FILENAMES", MESA_EGL_VENDOR));
    }
    vars
}

/// Whether `drm` (`/sys/class/drm`) lists a render node of a card that Mesa drives: Intel or AMD.
#[cfg(any(target_os = "linux", test))]
fn mesa_render_gpu(drm: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(drm) else {
        return false;
    };
    entries.flatten().any(|e| {
        e.file_name().to_string_lossy().starts_with("renderD")
            && std::fs::read_link(e.path().join("device").join("driver")).is_ok_and(|driver| {
                driver.file_name().is_some_and(|n| {
                    ["i915", "xe", "amdgpu", "radeon"].contains(&&*n.to_string_lossy())
                })
            })
    })
}

/// The variables [`tune_webkit`] set only for WebKit, which the shells must not inherit.
static WEBKIT_ONLY_VARS: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();

/// Sets [`webkit_env_in`]'s variables for this machine. Called first thing, before any thread
/// starts and before WebKitGTK reads them.
pub fn tune_webkit() {
    #[cfg(target_os = "linux")]
    {
        let nvidia = Path::new("/proc/driver/nvidia").exists();
        let mesa = nvidia
            && Path::new(MESA_EGL_VENDOR).exists()
            && mesa_render_gpu(Path::new("/sys/class/drm"));
        let mut webkit_only = Vec::new();
        for (name, value) in webkit_env_in(nvidia, mesa, &env) {
            // SAFETY: no other thread exists yet to read or write the environment.
            unsafe { std::env::set_var(name, value) };
            if EGL_VENDOR_VARS.contains(&name) {
                webkit_only.push(name);
            }
        }
        let _ = WEBKIT_ONLY_VARS.set(webkit_only);
    }
}

/// The variables to remove from a shell's environment: the EGL driver PlexusTerm picked for
/// WebKit, so programs started in a terminal still use the system's default (NVIDIA's).
pub fn webkit_only_vars() -> &'static [&'static str] {
    WEBKIT_ONLY_VARS.get().map_or(&[], Vec::as_slice)
}

/// The user's home directory: `$HOME` on Unix, `%USERPROFILE%` on Windows.
pub fn home_dir_in(os: Os, env: EnvLookup) -> Option<PathBuf> {
    let var = match os {
        Os::Unix => "HOME",
        Os::Windows => "USERPROFILE",
    };
    env(var).map(PathBuf::from)
}

pub fn home_dir() -> Option<PathBuf> {
    home_dir_in(CURRENT, &env)
}

/// Expands a leading `~/` (also `~\` on Windows) to `home`, as users type key paths like
/// `~/.ssh/id_ed25519`. Other paths, or any path without a home, are returned unchanged.
pub fn expand_home_in(os: Os, path: &str, home: Option<&Path>) -> PathBuf {
    let rest = path.strip_prefix("~/").or_else(|| match os {
        Os::Windows => path.strip_prefix("~\\"),
        Os::Unix => None,
    });
    match (rest, home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

pub fn expand_home(path: &str) -> PathBuf {
    expand_home_in(CURRENT, path, home_dir().as_deref())
}

/// The shell for local terminals. Unix: `$SHELL`, else `/bin/bash`. Windows: `pwsh.exe` when
/// on PATH, else `powershell.exe`, else `%COMSPEC%` (`cmd.exe` when even that is unset).
pub fn default_shell_in(os: Os, env: EnvLookup, find: ProgramLookup) -> String {
    match os {
        Os::Unix => env("SHELL")
            .and_then(|shell| shell.into_string().ok())
            .unwrap_or_else(|| "/bin/bash".into()),
        Os::Windows => find("pwsh.exe")
            .or_else(|| find("powershell.exe"))
            .map(|path| path.to_string_lossy().into_owned())
            .or_else(|| env("COMSPEC").and_then(|c| c.into_string().ok()))
            .unwrap_or_else(|| "cmd.exe".into()),
    }
}

pub fn default_shell() -> String {
    let path = env("PATH").unwrap_or_default();
    default_shell_in(CURRENT, &env, &|name| find_program(name, &path))
}

/// A command interpreter that local terminals can run.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Shell {
    /// File name without directory or `.exe`, e.g. `pwsh` or `zsh`.
    pub name: String,
    /// What to run: a full path, or a bare name when nothing better is known.
    pub program: String,
}

impl Shell {
    fn new(program: String) -> Self {
        Self {
            name: shell_name(&program).to_string(),
            program,
        }
    }
}

/// The shells found on this machine and the one local terminals run by default.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Shells {
    pub default: Shell,
    pub available: Vec<Shell>,
}

/// The file name of `program` without its directory (`/` or `\\`) or a `.exe` extension.
pub fn shell_name(program: &str) -> &str {
    let file = program.rsplit(['/', '\\']).next().unwrap_or(program);
    match file.len().checked_sub(4) {
        Some(stem) if file.is_char_boundary(stem) && file[stem..].eq_ignore_ascii_case(".exe") => {
            &file[..stem]
        }
        _ => file,
    }
}

/// Entries of `/etc/shells` that are never interactive shells.
const NOT_SHELLS: [&str; 2] = ["nologin", "false"];

/// The shells local terminals can run. Unix: `$SHELL`, then the installed entries of
/// `/etc/shells` (`etc_shells`). Windows: `pwsh.exe`, `powershell.exe`, `cmd.exe`
/// (`%COMSPEC%`), `wsl.exe` and Git Bash, when installed. One entry per name, first wins;
/// with nothing found the default shell is listed alone.
pub fn shells_in(
    os: Os,
    env: EnvLookup,
    find: ProgramLookup,
    installed: &dyn Fn(&Path) -> bool,
    etc_shells: Option<&str>,
) -> Shells {
    let default = Shell::new(default_shell_in(os, env, find));
    let mut programs: Vec<String> = Vec::new();
    match os {
        Os::Unix => {
            programs.extend(
                env("SHELL")
                    .and_then(|shell| shell.into_string().ok())
                    .filter(|shell| !NOT_SHELLS.contains(&shell_name(shell))),
            );
            programs.extend(
                etc_shells
                    .unwrap_or_default()
                    .lines()
                    .map(str::trim)
                    .filter(|line| line.starts_with('/'))
                    .filter(|line| !NOT_SHELLS.contains(&shell_name(line)))
                    .filter(|line| installed(Path::new(line)))
                    .map(String::from),
            );
        }
        Os::Windows => {
            let found = |name: &str| find(name).map(|path| path.to_string_lossy().into_owned());
            programs.extend(found("pwsh.exe"));
            programs.extend(found("powershell.exe"));
            programs.push(
                env("COMSPEC")
                    .and_then(|c| c.into_string().ok())
                    .or_else(|| found("cmd.exe"))
                    .unwrap_or_else(|| "cmd.exe".into()),
            );
            programs.extend(found("wsl.exe"));
            programs.extend(
                env("ProgramFiles")
                    .and_then(|dir| dir.into_string().ok())
                    .map(|dir| format!(r"{dir}\Git\bin\bash.exe"))
                    .filter(|bash| installed(Path::new(bash))),
            );
        }
    }
    let mut available: Vec<Shell> = Vec::new();
    for shell in programs.into_iter().map(Shell::new) {
        if !available.iter().any(|known| known.name == shell.name) {
            available.push(shell);
        }
    }
    if available.is_empty() {
        available.push(default.clone());
    }
    Shells { default, available }
}

pub fn shells() -> Shells {
    let path = env("PATH").unwrap_or_default();
    let etc_shells = match CURRENT {
        Os::Unix => std::fs::read_to_string("/etc/shells").ok(),
        Os::Windows => None,
    };
    shells_in(
        CURRENT,
        &env,
        &|name| find_program(name, &path),
        &|candidate| candidate.metadata().is_ok_and(|m| is_executable(&m)),
        etc_shells.as_deref(),
    )
}

/// The current user's OpenSSH `known_hosts` file (`~/.ssh/known_hosts`).
pub fn known_hosts_path() -> PathBuf {
    home_dir()
        .unwrap_or_default()
        .join(".ssh")
        .join("known_hosts")
}

/// The SSH agent to use: `SSH_AUTH_SOCK` when set; on Windows the OpenSSH agent pipe otherwise.
pub fn agent_endpoint_in(os: Os, env: EnvLookup) -> Option<PathBuf> {
    env("SSH_AUTH_SOCK").map(PathBuf::from).or(match os {
        Os::Windows => Some(PathBuf::from(WINDOWS_AGENT_PIPE)),
        Os::Unix => None,
    })
}

/// The name of executable `program` on this platform (`.exe` appended on Windows).
pub fn program_name_in(os: Os, program: &str) -> String {
    match os {
        Os::Unix => program.to_string(),
        Os::Windows => format!("{program}.exe"),
    }
}

pub fn program_name(program: &str) -> String {
    program_name_in(CURRENT, program)
}

/// Finds an executable `name` in the directories of `path` (like a shell's PATH lookup).
pub fn find_program(name: &str, path: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.metadata().is_ok_and(|m| is_executable(&m)))
}

#[cfg(unix)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

#[cfg(windows)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    meta.is_file()
}

/// Creates (or truncates) `path` with `contents`, readable only by the user: mode 0600 on
/// Unix; on Windows the file inherits the ACLs of the user profile it lives in.
/// Atomically replaces `to` with `from`. On Windows a rename onto a file that another
/// process (an antivirus scanner, an indexer) holds open briefly fails with "access
/// denied", so it is retried a few times before giving up.
pub fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match std::fs::rename(from, to) {
            Err(err)
                if cfg!(windows)
                    && err.kind() == std::io::ErrorKind::PermissionDenied
                    && attempt < 10 =>
            {
                attempt += 1;
                std::thread::sleep(std::time::Duration::from_millis(20 * attempt));
            }
            result => return result,
        }
    }
}

pub fn write_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

/// Connects to the SSH agent at `endpoint` (see [`agent_endpoint_in`]); `None` uses this
/// machine's default.
pub async fn connect_agent(
    endpoint: Option<&Path>,
) -> Result<
    russh::keys::agent::client::AgentClient<
        Box<dyn russh::keys::agent::client::AgentStream + Send + Unpin>,
    >,
    russh::keys::Error,
> {
    use russh::keys::agent::client::AgentClient;
    let endpoint = endpoint
        .map(Path::to_path_buf)
        .or_else(|| agent_endpoint_in(CURRENT, &env));
    #[cfg(unix)]
    let agent = match endpoint {
        Some(socket) => AgentClient::connect_uds(socket).await?.dynamic(),
        // Reports the same "SSH_AUTH_SOCK not set" error as OpenSSH-style clients.
        None => AgentClient::connect_env().await?.dynamic(),
    };
    #[cfg(windows)]
    let agent =
        AgentClient::connect_named_pipe(endpoint.unwrap_or_else(|| WINDOWS_AGENT_PIPE.into()))
            .await?
            .dynamic();
    Ok(agent)
}

/// An open serial device: the native type on Unix (exclusive access), the cross-platform
/// trait object elsewhere.
#[cfg(unix)]
pub type SerialPort = serialport::TTYPort;
#[cfg(windows)]
pub type SerialPort = Box<dyn serialport::SerialPort>;

/// Opens a serial device.
pub fn open_serial(builder: serialport::SerialPortBuilder) -> serialport::Result<SerialPort> {
    #[cfg(unix)]
    return builder.open_native();
    #[cfg(windows)]
    return builder.open();
}

/// A second handle to `port`, for a reader thread.
pub fn clone_serial(port: &SerialPort) -> serialport::Result<SerialPort> {
    #[cfg(unix)]
    return port.try_clone_native();
    #[cfg(windows)]
    return port.try_clone();
}

/// Serial devices present on this machine: sysfs on Linux (no libudev needed), the COM ports
/// reported by the system on Windows.
pub fn serial_ports() -> Vec<String> {
    #[cfg(unix)]
    let ports = crate::serial::ports::sysfs_ports();
    #[cfg(windows)]
    let ports = serialport::available_ports()
        .map(|ports| ports.into_iter().map(|p| p.port_name).collect())
        .unwrap_or_default();
    ports
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webkit_frames_go_through_shared_memory_only_with_nvidias_driver() {
        let none = vars(&[]);
        assert_eq!(
            webkit_env_in(true, false, &none),
            vec![
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"),
            ]
        );
        // Intel, AMD and the open drivers keep WebKitGTK's own choice.
        assert_eq!(webkit_env_in(false, false, &none), vec![]);
        assert_eq!(webkit_env_in(false, true, &none), vec![]);
        // A choice the user made is kept.
        for name in [
            "WEBKIT_DISABLE_DMABUF_RENDERER",
            "WEBKIT_FORCE_DMABUF_RENDERER",
            "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
        ] {
            assert_eq!(
                webkit_env_in(true, false, &vars(&[(name, "0")])),
                vec![],
                "{name}"
            );
        }
    }

    #[test]
    fn with_nvidias_driver_webkit_draws_on_another_gpu_through_mesa() {
        let none = vars(&[]);
        assert_eq!(
            webkit_env_in(true, true, &none),
            vec![
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"),
                ("__EGL_VENDOR_LIBRARY_FILENAMES", MESA_EGL_VENDOR),
            ]
        );
        // The EGL choice is its own: a DMA-BUF variable set by the user does not stop it.
        assert_eq!(
            webkit_env_in(
                true,
                true,
                &vars(&[("WEBKIT_DISABLE_DMABUF_RENDERER", "1")])
            ),
            vec![("__EGL_VENDOR_LIBRARY_FILENAMES", MESA_EGL_VENDOR)]
        );
        // An EGL vendor the user chose is kept.
        for name in [
            "__EGL_VENDOR_LIBRARY_FILENAMES",
            "__EGL_VENDOR_LIBRARY_DIRS",
        ] {
            assert_eq!(
                webkit_env_in(true, true, &vars(&[(name, "/x")])),
                vec![
                    ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                    ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"),
                ],
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_mesa_gpu_is_a_render_node_of_an_intel_or_amd_driver() {
        fn node(drm: &Path, name: &str, driver: &str) {
            let device = drm.join(name).join("device");
            std::fs::create_dir_all(&device).unwrap();
            let target = format!("../../bus/pci/drivers/{driver}");
            std::os::unix::fs::symlink(target, device.join("driver")).unwrap();
        }
        let drm = tempfile::tempdir().unwrap();
        assert!(!mesa_render_gpu(drm.path()));
        node(drm.path(), "renderD129", "nvidia");
        // A display connector of an Intel card is not a render node.
        node(drm.path(), "card1", "i915");
        assert!(!mesa_render_gpu(drm.path()));
        for driver in ["i915", "xe", "amdgpu", "radeon"] {
            let drm = tempfile::tempdir().unwrap();
            node(drm.path(), "renderD128", driver);
            assert!(mesa_render_gpu(drm.path()), "{driver}");
        }
        assert!(!mesa_render_gpu(Path::new("/no/such/drm")));
    }

    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| OsString::from(v))
        }
    }

    fn programs(found: &[&str]) -> impl Fn(&str) -> Option<PathBuf> {
        let found: Vec<String> = found.iter().map(|s| s.to_string()).collect();
        move |name| {
            found
                .iter()
                .any(|f| f == name)
                .then(|| PathBuf::from(format!(r"C:\bin\{name}")))
        }
    }

    #[test]
    fn home_dir_comes_from_home_on_unix_and_userprofile_on_windows() {
        let env = vars(&[("HOME", "/home/me"), ("USERPROFILE", r"C:\Users\me")]);
        assert_eq!(home_dir_in(Os::Unix, &env), Some(PathBuf::from("/home/me")));
        assert_eq!(
            home_dir_in(Os::Windows, &env),
            Some(PathBuf::from(r"C:\Users\me"))
        );
        assert_eq!(home_dir_in(Os::Windows, &vars(&[("HOME", "/h")])), None);
    }

    #[test]
    fn expands_tilde_slash_on_both_and_tilde_backslash_only_on_windows() {
        let unix_home = Path::new("/home/me");
        assert_eq!(
            expand_home_in(Os::Unix, "~/.ssh/id", Some(unix_home)),
            unix_home.join(".ssh/id")
        );
        assert_eq!(
            expand_home_in(Os::Unix, r"~\.ssh\id", Some(unix_home)),
            PathBuf::from(r"~\.ssh\id")
        );
        assert_eq!(
            expand_home_in(Os::Unix, "/abs/id", Some(unix_home)),
            PathBuf::from("/abs/id")
        );
        assert_eq!(
            expand_home_in(Os::Unix, "rel~/id", Some(unix_home)),
            PathBuf::from("rel~/id")
        );
        assert_eq!(
            expand_home_in(Os::Unix, "~/id", None),
            PathBuf::from("~/id")
        );

        let win_home = Path::new(r"C:\Users\me");
        assert_eq!(
            expand_home_in(Os::Windows, r"~\.ssh\id", Some(win_home)),
            win_home.join(r".ssh\id")
        );
        assert_eq!(
            expand_home_in(Os::Windows, "~/.ssh/id", Some(win_home)),
            win_home.join(".ssh/id")
        );
        assert_eq!(
            expand_home_in(Os::Windows, r"D:\keys\id", Some(win_home)),
            PathBuf::from(r"D:\keys\id")
        );
    }

    fn names(shells: &Shells) -> Vec<(&str, &str)> {
        shells
            .available
            .iter()
            .map(|s| (s.name.as_str(), s.program.as_str()))
            .collect()
    }

    #[test]
    fn unix_shells_are_dollar_shell_then_the_executable_entries_of_etc_shells() {
        let etc_shells = "# /etc/shells: valid login shells\n/bin/sh\n/bin/bash\n/usr/bin/bash\n\n\
                          /usr/bin/zsh\n/usr/bin/fish\n/usr/sbin/nologin\nrelative/sh\n";
        let installed = |path: &Path| path != Path::new("/usr/bin/fish");
        let shells = shells_in(
            Os::Unix,
            &vars(&[("SHELL", "/usr/bin/zsh")]),
            &programs(&[]),
            &installed,
            Some(etc_shells),
        );
        assert_eq!(
            names(&shells),
            [
                ("zsh", "/usr/bin/zsh"),
                ("sh", "/bin/sh"),
                ("bash", "/bin/bash")
            ]
        );
        assert_eq!(shells.default.name, "zsh");
        assert_eq!(shells.default.program, "/usr/bin/zsh");
    }

    #[test]
    fn unix_shells_skip_duplicates_nologin_false_and_comments() {
        let etc = "#c\n /bin/bash \n/usr/bin/bash\n/bin/false\n/usr/sbin/nologin\n/bin/zsh\n/usr/bin/zsh\n/usr/bin/tmux\n";
        let s = shells_in(
            Os::Unix,
            &vars(&[("SHELL", "/bin/zsh")]),
            &programs(&[]),
            &|_| true,
            Some(etc),
        );
        assert_eq!(
            names(&s),
            [
                ("zsh", "/bin/zsh"),
                ("bash", "/bin/bash"),
                ("tmux", "/usr/bin/tmux")
            ]
        );
        // A $SHELL that is not a shell (service accounts) is not offered either.
        let s = shells_in(
            Os::Unix,
            &vars(&[("SHELL", "/usr/sbin/nologin")]),
            &programs(&[]),
            &|_| true,
            Some("/bin/sh\n"),
        );
        assert_eq!(names(&s), [("sh", "/bin/sh")]);
    }

    #[test]
    fn windows_without_comspec_uses_cmd_on_path_and_skips_missing_git_bash() {
        let s = shells_in(
            Os::Windows,
            &vars(&[("ProgramFiles", r"C:\Program Files")]),
            &programs(&["powershell.exe", "cmd.exe"]),
            &|_| false,
            None,
        );
        assert_eq!(
            names(&s),
            [
                ("powershell", r"C:\bin\powershell.exe"),
                ("cmd", r"C:\bin\cmd.exe")
            ]
        );
        assert_eq!(s.default.name, "powershell");
    }

    #[test]
    fn unix_shells_without_etc_shells_or_dollar_shell_fall_back_to_bash() {
        let shells = shells_in(Os::Unix, &vars(&[]), &programs(&[]), &|_| true, None);
        assert_eq!(names(&shells), [("bash", "/bin/bash")]);
        assert_eq!(shells.default.program, "/bin/bash");
    }

    #[test]
    fn windows_shells_are_powershell_cmd_wsl_and_git_bash_when_installed() {
        let env = vars(&[
            ("COMSPEC", r"C:\Windows\system32\cmd.exe"),
            ("ProgramFiles", r"C:\Program Files"),
        ]);
        let git_bash = r"C:\Program Files\Git\bin\bash.exe";
        let shells = shells_in(
            Os::Windows,
            &env,
            &programs(&["pwsh.exe", "powershell.exe", "wsl.exe"]),
            &|path: &Path| path == Path::new(git_bash),
            Some("/bin/bash\n"),
        );
        assert_eq!(
            names(&shells),
            [
                ("pwsh", r"C:\bin\pwsh.exe"),
                ("powershell", r"C:\bin\powershell.exe"),
                ("cmd", r"C:\Windows\system32\cmd.exe"),
                ("wsl", r"C:\bin\wsl.exe"),
                ("bash", git_bash),
            ]
        );
        assert_eq!(shells.default.name, "pwsh");

        let bare = shells_in(Os::Windows, &vars(&[]), &programs(&[]), &|_| false, None);
        assert_eq!(names(&bare), [("cmd", "cmd.exe")]);
        assert_eq!(bare.default.program, "cmd.exe");
    }

    #[test]
    fn shell_names_drop_the_directory_and_the_exe_extension() {
        assert_eq!(
            shell_name(r"C:\Program Files\PowerShell\7\pwsh.exe"),
            "pwsh"
        );
        assert_eq!(shell_name("CMD.EXE"), "CMD");
        assert_eq!(shell_name("/usr/bin/zsh"), "zsh");
        assert_eq!(shell_name("fish"), "fish");
    }

    #[test]
    fn unix_shell_is_dollar_shell_or_bash() {
        let none = programs(&[]);
        assert_eq!(
            default_shell_in(Os::Unix, &vars(&[("SHELL", "/bin/zsh")]), &none),
            "/bin/zsh"
        );
        assert_eq!(default_shell_in(Os::Unix, &vars(&[]), &none), "/bin/bash");
    }

    #[test]
    fn windows_shell_prefers_pwsh_then_powershell_then_comspec() {
        let env = vars(&[
            ("COMSPEC", r"C:\Windows\system32\cmd.exe"),
            ("SHELL", "/bin/zsh"),
        ]);
        assert_eq!(
            default_shell_in(
                Os::Windows,
                &env,
                &programs(&["pwsh.exe", "powershell.exe"])
            ),
            r"C:\bin\pwsh.exe"
        );
        assert_eq!(
            default_shell_in(Os::Windows, &env, &programs(&["powershell.exe"])),
            r"C:\bin\powershell.exe"
        );
        assert_eq!(
            default_shell_in(Os::Windows, &env, &programs(&[])),
            r"C:\Windows\system32\cmd.exe"
        );
        assert_eq!(
            default_shell_in(Os::Windows, &vars(&[]), &programs(&[])),
            "cmd.exe"
        );
    }

    #[test]
    fn agent_endpoint_uses_ssh_auth_sock_then_the_windows_pipe() {
        let sock = vars(&[("SSH_AUTH_SOCK", "/run/agent.sock")]);
        assert_eq!(
            agent_endpoint_in(Os::Unix, &sock),
            Some(PathBuf::from("/run/agent.sock"))
        );
        assert_eq!(agent_endpoint_in(Os::Unix, &vars(&[])), None);
        assert_eq!(
            agent_endpoint_in(Os::Windows, &sock),
            Some(PathBuf::from("/run/agent.sock"))
        );
        assert_eq!(
            agent_endpoint_in(Os::Windows, &vars(&[])),
            Some(PathBuf::from(r"\\.\pipe\openssh-ssh-agent"))
        );
    }

    #[test]
    fn program_names_get_exe_on_windows() {
        assert_eq!(program_name_in(Os::Unix, "mosh-client"), "mosh-client");
        assert_eq!(
            program_name_in(Os::Windows, "mosh-client"),
            "mosh-client.exe"
        );
    }

    #[test]
    fn expand_home_uses_this_machines_home() {
        let home = home_dir().expect("home directory");
        assert_eq!(expand_home("~/.ssh/id"), home.join(".ssh/id"));
        assert_eq!(expand_home("rel~/id"), PathBuf::from("rel~/id"));
    }

    #[test]
    fn current_matches_the_build_target() {
        assert_eq!(CURRENT == Os::Windows, cfg!(windows));
        assert_eq!(name(), std::env::consts::OS);
    }

    #[cfg(unix)]
    #[test]
    fn private_files_are_0600_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f");
        write_private(&path, b"x").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"x");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
