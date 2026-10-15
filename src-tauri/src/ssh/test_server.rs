//! Minimal in-process SSH server used by the SSH client tests.
//!
//! Behaviour: accepts password `secret` or the configured public key, opens a
//! shell channel and echoes data back. `size?` replies with the last window
//! size, and `exit` ends the channel with exit status 7.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{PrivateKey, PublicKey};
use russh::server::{Auth, Msg, Server as _, Session};
use russh::{Channel, ChannelId, Pty};
use tokio::net::TcpListener;

pub const PASSWORD: &str = "secret";

pub fn key_from_seed(seed: u8) -> PrivateKey {
    PrivateKey::from(Ed25519Keypair::from_seed(&[seed; 32]))
}

pub struct TestServer {
    pub addr: SocketAddr,
    pub host_key: PublicKey,
}

#[derive(Clone)]
struct Handler {
    allowed_key: Option<PublicKey>,
    size: Arc<Mutex<(u32, u32)>>,
}

/// Starts a server with the given host key seed; `allowed_key` enables public-key auth.
pub async fn start(host_seed: u8, allowed_key: Option<PublicKey>) -> TestServer {
    let host = key_from_seed(host_seed);
    let host_key = host.public_key().clone();
    let config = Arc::new(russh::server::Config {
        keys: vec![host],
        auth_rejection_time: std::time::Duration::from_millis(0),
        auth_rejection_time_initial: Some(std::time::Duration::from_millis(0)),
        ..Default::default()
    });
    let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = socket.local_addr().unwrap();
    let mut server = Handler {
        allowed_key,
        size: Arc::new(Mutex::new((0, 0))),
    };
    tokio::spawn(async move {
        let _ = server.run_on_socket(config, &socket).await;
    });
    TestServer { addr, host_key }
}

impl russh::server::Server for Handler {
    type Handler = Self;
    fn new_client(&mut self, _: Option<SocketAddr>) -> Self {
        self.clone()
    }
}

impl russh::server::Handler for Handler {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if password == PASSWORD {
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_publickey(&mut self, _user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(match &self.allowed_key {
            Some(allowed) if allowed.key_data() == key.key_data() => Auth::Accept,
            _ => Auth::reject(),
        })
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: russh::server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        _term: &str,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        *self.size.lock().unwrap() = (cols, rows);
        session.channel_success(channel)
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, b"welcome\r\n".to_vec())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        cols: u32,
        rows: u32,
        _pw: u32,
        _ph: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        *self.size.lock().unwrap() = (cols, rows);
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        match data {
            b"exit" => {
                session.exit_status_request(channel, 7)?;
                session.eof(channel)?;
                session.close(channel)
            }
            b"size?" => {
                let (cols, rows) = *self.size.lock().unwrap();
                session.data(channel, format!("size={cols}x{rows}\r\n").into_bytes())
            }
            other => session.data(channel, other.to_vec()),
        }
    }
}
