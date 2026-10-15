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
