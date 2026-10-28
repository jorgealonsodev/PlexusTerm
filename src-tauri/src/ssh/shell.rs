//! The platform shell that runs the user's local commands (proxy commands and password
//! commands), and the kill that ends such a command together with everything it started.
//!
//! - Unix: `sh -c COMMAND`, in a process group of its own, so the group can be killed at once
//!   (the shell's children, e.g. `cloudflared` or a background `sleep`, are in it too).
//! - Windows: `cmd.exe /D /S /C "COMMAND"` without a console window; the command is passed as
//!   typed (`/S` strips only the outer quotes added here, `/D` skips cmd's AutoRun), and the
//!   tree is killed with `taskkill /T /F`.

use tokio::process::{Child, Command};

/// `command` run by the platform shell (see the module docs), killed when its [`Child`] is
/// dropped. Callers set its standard streams.
pub(crate) fn command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut shell = Command::new("cmd.exe");
        shell
            .raw_arg(format!("/D /S /C \"{command}\""))
            .creation_flags(CREATE_NO_WINDOW);
        shell.kill_on_drop(true);
        shell
    }
    #[cfg(not(windows))]
    {
        let mut shell = Command::new("sh");
        shell.arg("-c").arg(command);
        #[cfg(unix)]
        shell.process_group(0);
        shell.kill_on_drop(true);
        shell
    }
}

/// No console window flashes up for the command (or for `taskkill`).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Kills `child` and every process it started, without waiting (it is reaped in the
/// background by `kill_on_drop`, or by a later `wait`). Nothing is done once `child` was
/// reaped, when its pid may belong to someone else.
pub(crate) fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(unix)]
        if let Ok(pid) = i32::try_from(pid) {
            // SAFETY: kill(2) only takes integers; `-pid` names the process group the command
            // leads (it was started with `process_group(0)` by [`command`]), which exists until
            // the command is reaped, and `child.id()` is Some only before that.
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
        }
        #[cfg(windows)]
        taskkill(pid);
    }
    // The shell itself on every system (also when the tree kill could not run).
    let _ = child.start_kill();
}

/// `taskkill /T /F /PID pid`: the process and its descendants, while it still runs (the
/// descendants are found through it). Not waited for.
#[cfg(windows)]
fn taskkill(pid: u32) {
    use std::process::{Command, Stdio};
    let system = std::env::var_os("SystemRoot")
        .map(|root| {
            std::path::PathBuf::from(root)
                .join("System32")
                .join("taskkill.exe")
        })
        .unwrap_or_else(|| "taskkill.exe".into());
    let mut taskkill = Command::new(system);
    std::os::windows::process::CommandExt::creation_flags(&mut taskkill, CREATE_NO_WINDOW);
    let _ = taskkill
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Whether process `pid` still runs (a zombie does not count).
#[cfg(all(test, target_os = "linux"))]
pub(crate) fn running(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| {
        stat.rsplit_once(')')
            .and_then(|(_, rest)| rest.split_whitespace().next())
            .is_some_and(|state| state != "Z")
    })
}

/// Whether process `pid` still runs (a zombie does not count), asked to `ps`.
#[cfg(all(test, unix, not(target_os = "linux")))]
pub(crate) fn running(pid: i32) -> bool {
    std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .is_ok_and(|out| {
            let state = String::from_utf8_lossy(&out.stdout);
            let state = state.trim();
            !state.is_empty() && !state.starts_with('Z')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;
    use std::time::Duration;
    #[cfg(unix)]
    use std::time::Instant;

    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_ends_the_command_and_what_it_started() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("sleep.pid");
        let line = format!("sleep 600 & echo $! > {}; wait", pid_file.display());
        let mut child = command(&line)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let background: i32 = loop {
            if let Some(pid) = std::fs::read_to_string(&pid_file)
                .ok()
                .and_then(|text| text.trim().parse().ok())
            {
                break pid;
            }
            assert!(Instant::now() < deadline, "the command did not start");
            tokio::time::sleep(Duration::from_millis(20)).await;
        };
        assert!(running(background));

        kill_tree(&mut child);
        let _ = child.wait().await;
        let deadline = Instant::now() + Duration::from_secs(5);
        while running(background) && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(!running(background), "what the command started outlived it");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn kill_tree_after_the_command_was_reaped_does_nothing() {
        let mut child = command("true").spawn().unwrap();
        assert!(child.wait().await.unwrap().success());
        kill_tree(&mut child);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn kill_tree_ends_the_command_and_what_it_started() {
        // `ping -n 600` is a long-running child of cmd; killing the tree ends both.
        let mut child = command("ping -n 600 127.0.0.1 > NUL")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        kill_tree(&mut child);
        let status = tokio::time::timeout(Duration::from_secs(10), child.wait())
            .await
            .expect("the command was not killed");
        assert!(!status.unwrap().success());
    }
}
