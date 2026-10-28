//! Passwords and key passphrases read from a password manager's command line
//! (`op read …`, `bw get password …`, `pass show …`, `secret-tool lookup …`,
//! `keepassxc-cli show …`).
//!
//! A saved session keeps only the command. At every login it runs locally through the
//! platform shell (`sh -c` on Unix, `cmd /C` on Windows) with stdin closed, so a command that
//! would prompt gets end-of-file instead of waiting, and is killed after
//! [`SECRET_COMMAND_TIMEOUT`]. Its standard output, without one trailing line break, is the
//! secret: it is kept in a buffer wiped when dropped, and never logged nor put in an error.
//! A failure ([`SshError::PasswordCommand`]) carries the exit code and the first lines of the
//! command's standard error only.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use zeroize::Zeroizing;

use super::SshError;

/// Longest command line accepted (the frontend enforces the same bound).
pub const MAX_COMMAND_LEN: usize = 2000;
/// How long the command may run before it is killed and the login fails.
pub const SECRET_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest secret read; a longer output is not a password.
const MAX_SECRET_LEN: usize = 64 * 1024;
/// Most standard error read from the command, and what of it a failure reports.
const MAX_STDERR_LEN: usize = 16 * 1024;
const STDERR_LINES: usize = 5;
const STDERR_LINE_CHARS: usize = 300;

/// What the command's output is used as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SecretKind {
    Password,
    Passphrase,
}

/// Why a password command gave no usable secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandFailure {
    /// Blank, or longer than [`MAX_COMMAND_LEN`].
    Invalid,
    /// The shell could not be started.
    Start,
    /// It exited with a failure status (`code` is None when a signal ended it).
    Exit,
    /// It ran longer than [`SECRET_COMMAND_TIMEOUT`] and was killed.
    Timeout,
    /// It succeeded but printed nothing.
    Empty,
    /// It printed more than a password could be.
    TooLong,
    /// Its output is not UTF-8 text.
    NotText,
}

/// The English text of a [`SshError::PasswordCommand`]; never contains the command's output.
pub fn describe(
    secret: &SecretKind,
    failure: &CommandFailure,
    code: &Option<i32>,
    stderr: &str,
) -> String {
    let what = match secret {
        SecretKind::Password => "password",
        SecretKind::Passphrase => "passphrase",
    };
    let reason = match failure {
        CommandFailure::Invalid => "is empty or too long".to_string(),
        CommandFailure::Start => "could not be started".to_string(),
        CommandFailure::Exit => match code {
            Some(code) => format!("exited with code {code}"),
            None => "was ended by a signal".to_string(),
        },
        CommandFailure::Timeout => format!(
            "did not finish within {} seconds",
            SECRET_COMMAND_TIMEOUT.as_secs()
        ),
        CommandFailure::Empty => "printed nothing".to_string(),
        CommandFailure::TooLong => "printed too much to be a password".to_string(),
        CommandFailure::NotText => "printed something that is not text".to_string(),
    };
    if stderr.is_empty() {
        format!("the {what} command {reason}")
    } else {
        format!("the {what} command {reason}: {stderr}")
    }
}

fn failure(
    secret: SecretKind,
    failure: CommandFailure,
    code: Option<i32>,
    stderr: String,
) -> SshError {
    SshError::PasswordCommand {
        purpose: secret,
        failure,
        code,
        stderr,
    }
}

/// Runs `command` and returns its output as the secret (see the module docs).
pub async fn read_secret(
    command: &str,
    secret: SecretKind,
    timeout: Duration,
) -> Result<Zeroizing<String>, SshError> {
    let fail = |kind, code, stderr| failure(secret, kind, code, stderr);
    if command.trim().is_empty() || command.len() > MAX_COMMAND_LEN {
        return Err(fail(CommandFailure::Invalid, None, String::new()));
    }
    let mut child = shell_command(command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            fail(
                CommandFailure::Start,
                None,
                first_lines(err.to_string().as_bytes()),
            )
        })?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(fail(CommandFailure::Start, None, String::new()));
    };

    // Allocated once at its largest, so no copy of the secret is left behind by a reallocation.
    let mut out = Zeroizing::new(Vec::with_capacity(MAX_SECRET_LEN + 1));
    let mut err = Vec::new();
    let finished = tokio::time::timeout(timeout, async {
        let (read_out, _) = tokio::join!(
            read_at_most(stdout, MAX_SECRET_LEN + 1, &mut out),
            read_at_most(stderr, MAX_STDERR_LEN, &mut err),
        );
        if read_out.is_err() || out.len() > MAX_SECRET_LEN {
            // Stop it rather than wait for an output that is not a password anyway.
            let _ = child.start_kill();
        }
        (read_out, child.wait().await)
    })
    .await;
    // On timeout the child is dropped here, which kills it (`kill_on_drop`).
    let Ok((read_out, status)) = finished else {
        return Err(fail(CommandFailure::Timeout, None, String::new()));
    };
    let stderr = first_lines(&err);
    if out.len() > MAX_SECRET_LEN {
        return Err(fail(CommandFailure::TooLong, None, stderr));
    }
    let status = status.map_err(|_| fail(CommandFailure::Start, None, stderr.clone()))?;
    if !status.success() {
        return Err(fail(CommandFailure::Exit, status.code(), stderr));
    }
    if read_out.is_err() {
        return Err(fail(CommandFailure::NotText, None, stderr));
    }
    let Ok(text) = std::str::from_utf8(&out) else {
        return Err(fail(CommandFailure::NotText, None, stderr));
    };
    let text = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);
    if text.is_empty() {
        return Err(fail(CommandFailure::Empty, None, stderr));
    }
    Ok(Zeroizing::new(text.to_owned()))
}

/// `command` run by the platform shell, without a console window on Windows.
fn shell_command(command: &str) -> tokio::process::Command {
    #[cfg(unix)]
    {
        let mut shell = std::process::Command::new("sh");
        shell.arg("-c").arg(command);
        tokio::process::Command::from(shell)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut shell = std::process::Command::new("cmd.exe");
        // Passed as typed: `/S` makes cmd strip only the outer quotes added here.
        shell
            .raw_arg(format!("/D /S /C \"{command}\""))
            .creation_flags(CREATE_NO_WINDOW);
        tokio::process::Command::from(shell)
    }
}

/// Reads `source` until its end or `limit` bytes into `into`, which never grows past `limit`.
async fn read_at_most(
    source: impl AsyncRead + Unpin,
    limit: usize,
    into: &mut Vec<u8>,
) -> std::io::Result<usize> {
    let limit = u64::try_from(limit).unwrap_or(u64::MAX);
    source.take(limit).read_to_end(into).await
}

/// The first [`STDERR_LINES`] non-blank lines of `bytes`, each without control characters and
/// cut at [`STDERR_LINE_CHARS`] characters, joined by line breaks.
fn first_lines(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(|line| {
            line.chars()
                .filter(|c| !c.is_control())
                .take(STDERR_LINE_CHARS)
                .collect::<String>()
        })
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .take(STDERR_LINES)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT: Duration = Duration::from_secs(10);

    async fn run(command: &str) -> Result<Zeroizing<String>, SshError> {
        read_secret(command, SecretKind::Password, SHORT).await
    }

    fn failure_of(err: SshError) -> (CommandFailure, Option<i32>, String) {
        match err {
            SshError::PasswordCommand {
                failure,
                code,
                stderr,
                ..
            } => (failure, code, stderr),
            other => panic!("expected PasswordCommand, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_output_without_one_trailing_line_break_is_the_secret() {
        assert_eq!(
            run("printf 'hunter2\\n'").await.unwrap().as_str(),
            "hunter2"
        );
        assert_eq!(
            run("printf 'hunter2\\r\\n'").await.unwrap().as_str(),
            "hunter2"
        );
        assert_eq!(run("printf 'hunter2'").await.unwrap().as_str(), "hunter2");
        // Only one line break goes: the rest of the output is the secret as printed.
        assert_eq!(
            run("printf ' a b \\n\\n'").await.unwrap().as_str(),
            " a b \n"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stdin_is_closed_so_a_command_reading_it_gets_end_of_file() {
        assert_eq!(run("cat; printf ok").await.unwrap().as_str(), "ok");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_failing_command_reports_its_code_and_stderr_but_never_its_output() {
        let err = run("printf 'hunter2-out'; echo 'vault is locked' >&2; exit 3")
            .await
            .unwrap_err();
        let text = err.to_string();
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            text,
            "the password command exited with code 3: vault is locked"
        );
        assert_eq!(
            json,
            r#"{"kind":"passwordCommand","purpose":"password","failure":"exit","code":3,"stderr":"vault is locked"}"#
        );
        assert!(!format!("{err:?}").contains("hunter2-out"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_empty_output_fails() {
        let (failure, code, _) = failure_of(run("true").await.unwrap_err());
        assert_eq!((failure, code), (CommandFailure::Empty, None));
        let (failure, _, _) = failure_of(run("printf '\\n'").await.unwrap_err());
        assert_eq!(failure, CommandFailure::Empty);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn only_the_first_lines_of_stderr_are_reported_without_control_characters() {
        let err =
            run("for i in 1 2 3 4 5 6 7; do printf 'line %s\\033[31m\\n' $i >&2; done; exit 1")
                .await
                .unwrap_err();
        let (_, _, stderr) = failure_of(err);
        assert_eq!(
            stderr,
            "line 1[31m\nline 2[31m\nline 3[31m\nline 4[31m\nline 5[31m"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_running_too_long_is_killed() {
        let started = std::time::Instant::now();
        let err = read_secret(
            "sleep 20; printf late",
            SecretKind::Passphrase,
            Duration::from_millis(300),
        )
        .await
        .unwrap_err();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(
            err.to_string(),
            "the passphrase command did not finish within 30 seconds"
        );
        let (failure, _, _) = failure_of(err);
        assert_eq!(failure, CommandFailure::Timeout);
    }

    #[tokio::test]
    async fn a_blank_or_too_long_command_is_not_run() {
        let (failure, _, _) = failure_of(run("  ").await.unwrap_err());
        assert_eq!(failure, CommandFailure::Invalid);
        let long = format!("echo {}", "a".repeat(MAX_COMMAND_LEN));
        let (failure, _, _) = failure_of(run(&long).await.unwrap_err());
        assert_eq!(failure, CommandFailure::Invalid);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn an_output_that_is_not_text_fails() {
        let (failure, _, _) = failure_of(run("printf '\\377\\376'").await.unwrap_err());
        assert_eq!(failure, CommandFailure::NotText);
    }
}
