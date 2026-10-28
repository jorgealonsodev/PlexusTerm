//! Proxy commands: a local command whose stdin and stdout carry the SSH connection to the
//! target instead of a TCP socket, like OpenSSH's `ProxyCommand` (e.g. `cloudflared access ssh
//! --hostname %h` or `aws ssm start-session ...`).
//!
//! - The command is the user's own (typed in the session or imported, and shown before the
//!   import), run through the platform shell (see [`super::shell`]): `sh -c` on Unix, `cmd /C`
//!   on Windows.
//! - `%h`, `%p` and `%r` become the target's host, port and user, `%%` a literal `%`; any other
//!   `%x` stays as typed. A host or user name with characters a shell would interpret is
//!   refused rather than substituted (OpenSSH refuses them too).
//! - The command's stderr is read line by line (see [`spawn`]) so the terminal can show it.
//! - The command lives as long as the connection: dropping the [`ProxyStream`] (the connection
//!   ended or never started) kills it and every process it started.

use std::io;
use std::pin::Pin;
use std::process::Stdio;
use std::task::{Context, Poll};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, BufReader, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::mpsc;

use super::shell;

/// Longest proxy command accepted, in bytes.
pub const MAX_PROXY_COMMAND: usize = 2000;

/// Longest stderr line passed on; the rest of a longer line follows as further lines.
const MAX_STDERR_LINE: usize = 1000;

/// Stderr lines kept for the terminal while it is not reading them; later ones are dropped.
pub(crate) const STDERR_BACKLOG: usize = 256;

/// Why a proxy command cannot be used, before anything runs.
pub(crate) fn check(command: &str) -> Result<(), String> {
    if command.len() > MAX_PROXY_COMMAND {
        return Err(format!(
            "the proxy command is longer than {MAX_PROXY_COMMAND} characters"
        ));
    }
    if command.chars().any(char::is_control) {
        return Err("the proxy command must be a single line without control characters".into());
    }
    Ok(())
}

/// Whether `value` may replace `%h` or `%r`: nothing a shell would interpret (letters, digits,
/// `.`, `-`, `_`, `:`, `[`, `]` and `@`), and not starting with `-`.
fn substitutable(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']' | '@')
        })
}

/// `template` with `%h`, `%p`, `%r` and `%%` replaced; any other `%x` (and a trailing `%`) stays.
pub(crate) fn expand(template: &str, host: &str, port: u16, user: &str) -> Result<String, String> {
    let mut out = String::with_capacity(template.len());
    let mut chars = template.chars();
    while let Some(c) = chars.next() {
        if c != '%' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('h') => {
                if !substitutable(host) {
                    return Err(format!(
                        "the host name {host:?} cannot be used in a proxy command"
                    ));
                }
                out.push_str(host);
            }
            Some('r') => {
                if !substitutable(user) {
                    return Err(format!(
                        "the user name {user:?} cannot be used in a proxy command"
                    ));
                }
                out.push_str(user);
            }
            Some('p') => out.push_str(&port.to_string()),
            Some('%') => out.push('%'),
            Some(other) => {
                out.push('%');
                out.push(other);
            }
            None => out.push('%'),
        }
    }
    Ok(out)
}

/// The SSH transport of a proxied connection: the command's stdout to read, its stdin to write.
/// Dropping it kills the command.
pub(crate) struct ProxyStream {
    stdout: ChildStdout,
    stdin: ChildStdin,
    child: Child,
}

impl AsyncRead for ProxyStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}

impl AsyncWrite for ProxyStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}

impl Drop for ProxyStream {
    fn drop(&mut self) {
        // The command and everything it started (`kill_on_drop` also reaps it in the background).
        shell::kill_tree(&mut self.child);
    }
}

/// Starts `command` (already expanded) and returns its stdio as an SSH transport. Every stderr
/// line, without control characters, is offered to `stderr` while it has room; the lines are
/// read (and dropped) even when nobody listens, so the command never blocks on a full pipe.
pub(crate) fn spawn(command: &str, stderr: mpsc::Sender<String>) -> io::Result<ProxyStream> {
    let mut child = shell::command(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let missing = || io::Error::other("the proxy command's standard streams are not available");
    let stdin = child.stdin.take().ok_or_else(missing)?;
    let stdout = child.stdout.take().ok_or_else(missing)?;
    let errors = child.stderr.take().ok_or_else(missing)?;
    tokio::spawn(forward_stderr(errors, stderr));
    Ok(ProxyStream {
        stdout,
        stdin,
        child,
    })
}

async fn forward_stderr(errors: impl AsyncRead + Unpin, lines: mpsc::Sender<String>) {
    let mut reader = BufReader::new(errors);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match (&mut reader)
            .take(MAX_STDERR_LINE as u64)
            .read_until(b'\n', &mut buf)
            .await
        {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line: String = String::from_utf8_lossy(&buf)
                    .chars()
                    .filter(|c| !c.is_control() || *c == '\t')
                    .collect();
                let line = line.trim_end();
                if !line.is_empty() {
                    let _ = lines.try_send(line.to_string());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_host_port_user_and_percent() {
        assert_eq!(
            expand("nc %h %p -u %r 100%%", "db.example", 2222, "ana").unwrap(),
            "nc db.example 2222 -u ana 100%"
        );
    }

    #[test]
    fn unknown_tokens_and_a_trailing_percent_stay_as_typed() {
        assert_eq!(expand("x %n %C %", "h", 22, "u").unwrap(), "x %n %C %");
    }

    #[test]
    fn a_host_or_user_a_shell_would_interpret_is_refused() {
        for host in [
            "a;rm -rf ~",
            "$(id)",
            "a b",
            "`x`",
            "-oProxyCommand=x",
            "a|b",
            "a'b",
        ] {
            let err = expand("nc %h %p", host, 22, "u").unwrap_err();
            assert!(err.contains("host name"), "{host}: {err}");
        }
        let err = expand("x %r", "h", 22, "u;id").unwrap_err();
        assert!(err.contains("user name"), "{err}");
        // Not used, not checked.
        assert_eq!(expand("nc gw 22", "a;b", 22, "u;id").unwrap(), "nc gw 22");
        // IPv6 addresses and user@host forms are fine.
        assert_eq!(expand("%h", "[::1]", 22, "u").unwrap(), "[::1]");
        assert_eq!(expand("%h", "fe80::1", 22, "u").unwrap(), "fe80::1");
    }

    #[test]
    fn checks_length_and_control_characters() {
        assert!(check("cloudflared access ssh --hostname %h").is_ok());
        assert!(check(&"x".repeat(MAX_PROXY_COMMAND)).is_ok());
        assert!(check(&"x".repeat(MAX_PROXY_COMMAND + 1)).is_err());
        assert!(check("nc a 22\nrm -rf ~").is_err());
        assert!(check("nc a\0").is_err());
    }
}
