//! Interoperability tests against a real OpenSSH server.
//!
//! Ignored by default (shell, SFTP and local tunnels); `scripts/openssh-interop.sh` starts a disposable
//! OpenSSH container and runs them with:
//! - `NEXUSTERM_INTEROP_PORT`: sshd port on 127.0.0.1
//! - `NEXUSTERM_INTEROP_USER`: login user
//! - `NEXUSTERM_INTEROP_KEY`: private key accepted by that user

use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

use super::{ConnectRequest, SshAuth, SshError, SshManager};
use crate::sftp;
use crate::terminal::TerminalSink;

struct Target {
    port: u16,
    user: String,
    key: String,
}

fn target() -> Target {
    let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set"));
    Target {
        port: var("NEXUSTERM_INTEROP_PORT").parse().unwrap(),
        user: var("NEXUSTERM_INTEROP_USER"),
        key: var("NEXUSTERM_INTEROP_KEY"),
    }
}

struct TestSink(Sender<String>);

impl TerminalSink for TestSink {
    fn data(&self, text: String) {
        let _ = self.0.send(text);
    }
    fn exit(&self, _code: Option<u32>) {}
}

fn request(t: &Target, trusted_fingerprint: Option<String>) -> ConnectRequest {
    ConnectRequest {
        host: "127.0.0.1".into(),
        port: t.port,
        username: t.user.clone(),
        auth: SshAuth::Key {
            path: t.key.clone(),
            passphrase: None,
        },
        cols: 80,
        rows: 24,
        trusted_fingerprint,
    }
}

fn wait_for(rx: &Receiver<String>, needle: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut out = String::new();
    while Instant::now() < deadline && !out.contains(needle) {
        if let Ok(text) = rx.recv_timeout(Duration::from_millis(100)) {
            out.push_str(&text);
        }
    }
    out
}

/// Trusts the server through the real unknown-host flow and returns a connected session.
async fn connect(t: &Target, mgr: &SshManager) -> (u32, Receiver<String>) {
    let (tx, _rx) = channel();
    let fingerprint = match mgr.connect(request(t, None), TestSink(tx)).await {
        Err(SshError::UnknownHost { fingerprint, .. }) => fingerprint,
        other => panic!(
            "expected UnknownHost on first contact, got {:?}",
            other.map(|_| ())
        ),
    };
    let (tx, rx) = channel();
    let id = mgr
        .connect(request(t, Some(fingerprint)), TestSink(tx))
        .await
        .expect("connect after trusting the host key");
    (id, rx)
}

// Multi-threaded: `wait_for` blocks while the session tasks keep running.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs scripts/openssh-interop.sh"]
async fn openssh_shell_resize_and_known_hosts() {
    let t = target();
    let dir = tempfile::tempdir().unwrap();
    let mgr = SshManager::new(dir.path().join("known_hosts"));
    let (id, rx) = connect(&t, &mgr).await;

    mgr.write(id, b"echo nexus-$((40+2))\n").unwrap();
    let out = wait_for(&rx, "nexus-42");
    assert!(out.contains("nexus-42"), "shell output: {out:?}");

    mgr.resize(id, 132, 43).unwrap();
    mgr.write(id, b"stty size\n").unwrap();
    let out = wait_for(&rx, "43 132");
    assert!(out.contains("43 132"), "shell output: {out:?}");
    mgr.close(id).unwrap();

    // The key is now recorded: a second connection needs no confirmation.
    let (tx, _rx) = channel();
    let id = mgr.connect(request(&t, None), TestSink(tx)).await.unwrap();
    mgr.close(id).unwrap();
}

// Multi-threaded: `wait_for` blocks while the session tasks keep running.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs scripts/openssh-interop.sh"]
async fn openssh_sftp_round_trip() {
    let t = target();
    let dir = tempfile::tempdir().unwrap();
    let mgr = SshManager::new(dir.path().join("known_hosts"));
    let (id, _rx) = connect(&t, &mgr).await;
    let session = mgr.sftp(id).await.unwrap();

    let home = sftp::home(&session).await.unwrap();
    let work = format!("{}/nexusterm-interop", home.trim_end_matches('/'));
    let _ = sftp::remove(&session, &format!("{work}/payload.bin"), false).await;
    let _ = sftp::remove(&session, &work, true).await;
    sftp::mkdir(&session, &work).await.unwrap();

    let payload: Vec<u8> = (0..3 * 1024 * 1024 + 17)
        .map(|i| (i * 31 % 251) as u8)
        .collect();
    let local = dir.path().join("payload.bin");
    std::fs::write(&local, &payload).unwrap();
    let remote = sftp::upload(&session, &local, &work).await.unwrap();

    let names: Vec<_> = sftp::list(&session, &work)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(names, vec!["payload.bin"]);

    let back = dir.path().join("back.bin");
    sftp::download(&session, &remote, &back).await.unwrap();
    assert!(
        std::fs::read(&back).unwrap() == payload,
        "downloaded bytes differ"
    );

    sftp::remove(&session, &remote, false).await.unwrap();
    sftp::remove(&session, &work, true).await.unwrap();
    mgr.close(id).unwrap();
}

// Multi-threaded: the tunnel tasks run while the test awaits the TCP client.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs scripts/openssh-interop.sh"]
async fn openssh_local_tunnel_reaches_a_service_behind_the_server() {
    use crate::tunnels::{TunnelDefinition, TunnelKind, TunnelManager};
    use tokio::io::AsyncReadExt;

    let t = target();
    let dir = tempfile::tempdir().unwrap();
    let known_hosts = dir.path().join("known_hosts");
    // Record the host key through the regular trust flow first.
    let ssh = SshManager::new(known_hosts.clone());
    let (id, _rx) = connect(&t, &ssh).await;
    ssh.close(id).unwrap();

    let listen_port = {
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        probe.local_addr().unwrap().port()
    };
    let tunnels = TunnelManager::new(known_hosts, |_| {});
    let tunnel = TunnelDefinition {
        id: "interop".into(),
        name: "interop".into(),
        kind: TunnelKind::Local,
        session_id: "interop".into(),
        listen_host: "127.0.0.1".into(),
        listen_port,
        // The container's own sshd, reachable only from inside the server.
        dest_host: "localhost".into(),
        dest_port: 22,
    };
    let session = super::SshTarget {
        host: "127.0.0.1".into(),
        port: t.port,
        username: t.user.clone(),
        auth: SshAuth::Key {
            path: t.key.clone(),
            passphrase: None,
        },
    };
    tunnels
        .start(tunnel, session, None)
        .await
        .expect("tunnel starts");

    let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", listen_port))
        .await
        .unwrap();
    let mut banner = vec![0u8; 64];
    let n = tokio::time::timeout(Duration::from_secs(10), tcp.read(&mut banner))
        .await
        .expect("banner within 10s")
        .unwrap();
    let banner = String::from_utf8_lossy(&banner[..n]);
    assert!(banner.starts_with("SSH-2.0-OpenSSH"), "got {banner:?}");

    tunnels.stop("interop").await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", listen_port))
            .await
            .is_err()
    );
}
