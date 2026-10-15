//! Telnet client tests against an in-process TCP server that negotiates like a telnetd.

use super::protocol::{DO, DONT, ECHO, IAC, NAWS, SB, SE, SGA, TTYPE, WILL};
use super::*;
use tokio::net::TcpListener;
use tokio::sync::mpsc::UnboundedReceiver;

enum Event {
    Data(String),
    Exit,
}

struct TestSink(UnboundedSender<Event>);

impl TerminalSink for TestSink {
    fn data(&self, text: String) {
        let _ = self.0.send(Event::Data(text));
    }
    fn exit(&self, _code: Option<u32>) {
        let _ = self.0.send(Event::Exit);
    }
}

fn sink() -> (TestSink, UnboundedReceiver<Event>) {
    let (tx, rx) = unbounded_channel();
    (TestSink(tx), rx)
}

/// Collects output until `needle` appears; `exited` tells whether the session ended.
async fn wait_for(rx: &mut UnboundedReceiver<Event>, needle: &str) -> (String, bool) {
    let mut out = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while let Ok(Some(event)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        match event {
            Event::Data(t) => {
                out.push_str(&t);
                if !needle.is_empty() && out.contains(needle) {
                    return (out, false);
                }
            }
            Event::Exit => return (out, true),
        }
    }
    (out, false)
}

fn request(port: u16) -> TelnetRequest {
    TelnetRequest {
        host: "127.0.0.1".into(),
        port,
        cols: 80,
        rows: 24,
    }
}

/// Server side of one accepted connection.
struct Peer {
    stream: TcpStream,
    received: Vec<u8>,
}

impl Peer {
    /// Reads until the bytes received so far contain `needle` (5 s at most).
    async fn expect(&mut self, needle: &[u8]) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        let mut buf = [0u8; 1024];
        while !contains(&self.received, needle) {
            match tokio::time::timeout_at(deadline, self.stream.read(&mut buf)).await {
                Ok(Ok(n)) if n > 0 => self.received.extend_from_slice(&buf[..n]),
                _ => panic!("server never received {needle:?}; got {:?}", self.received),
            }
        }
    }

    async fn send(&mut self, bytes: &[u8]) {
        self.stream.write_all(bytes).await.unwrap();
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

async fn listen() -> (TcpListener, u16) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    (listener, port)
}

async fn accept(listener: &TcpListener) -> Peer {
    let (stream, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
        .await
        .expect("client never connected")
        .unwrap();
    Peer {
        stream,
        received: Vec::new(),
    }
}

/// Connects a client and walks the server through the usual telnetd negotiation.
async fn negotiated() -> (TelnetManager, u32, Peer, UnboundedReceiver<Event>) {
    let (listener, port) = listen().await;
    let mgr = TelnetManager::default();
    let (s, rx) = sink();
    let id = mgr.connect(request(port), s).await.unwrap();
    let mut peer = accept(&listener).await;
    peer.expect(&[IAC, WILL, TTYPE, IAC, WILL, NAWS]).await;
    peer.send(&[IAC, DO, TTYPE, IAC, DO, NAWS]).await;
    peer.expect(&[IAC, SB, NAWS, 0, 80, 0, 24, IAC, SE]).await;
    (mgr, id, peer, rx)
}

#[tokio::test]
async fn naws_is_sent_with_the_initial_size_and_again_on_resize() {
    let (mgr, id, mut peer, _rx) = negotiated().await;
    mgr.resize(id, 132, 50).unwrap();
    peer.expect(&[IAC, SB, NAWS, 0, 132, 0, 50, IAC, SE]).await;
}

#[tokio::test]
async fn terminal_type_is_answered() {
    let (_mgr, _id, mut peer, _rx) = negotiated().await;
    peer.send(&[IAC, SB, TTYPE, 1, IAC, SE]).await;
    let mut expected = vec![IAC, SB, TTYPE, 0];
    expected.extend_from_slice(b"xterm-256color");
    expected.extend_from_slice(&[IAC, SE]);
    peer.expect(&expected).await;
}

#[tokio::test]
async fn server_echo_and_sga_are_accepted_and_other_options_refused() {
    let (_mgr, _id, mut peer, _rx) = negotiated().await;
    peer.send(&[IAC, WILL, ECHO, IAC, WILL, SGA, IAC, WILL, 42])
        .await;
    peer.expect(&[IAC, DO, ECHO, IAC, DO, SGA, IAC, DONT, 42])
        .await;
}

#[tokio::test]
async fn input_iac_is_escaped_and_enter_is_sent_as_cr_nul() {
    let (mgr, id, mut peer, _rx) = negotiated().await;
    mgr.write(id, &[b'a', IAC, b'b', b'\r']).unwrap();
    peer.expect(&[b'a', IAC, IAC, b'b', b'\r', 0]).await;
}

#[tokio::test]
async fn output_is_decoded_with_iac_unescaped_and_commands_stripped() {
    let (_mgr, _id, mut peer, mut rx) = negotiated().await;
    // "é" is C3 A9; an escaped IAC is a lone 0xFF byte, which is not valid UTF-8.
    peer.send(&[
        b'h', IAC, 241, b'i', 0xC3, 0xA9, IAC, IAC, b'!', b'\r', 0, b'\n',
    ])
    .await;
    let (out, _) = wait_for(&mut rx, "!\r\n").await;
    assert_eq!(out, "hié\u{FFFD}!\r\n");
}

#[tokio::test]
async fn server_closing_ends_the_session() {
    let (_mgr, _id, mut peer, mut rx) = negotiated().await;
    peer.send(b"bye\r\n").await;
    drop(peer);
    let (out, exited) = wait_for(&mut rx, "").await;
    assert!(out.contains("bye"), "output was {out:?}");
    assert!(exited, "the session did not end");
}

#[tokio::test]
async fn close_disconnects_and_forgets_the_session() {
    let (mgr, id, mut peer, mut rx) = negotiated().await;
    mgr.close(id).unwrap();
    let mut buf = [0u8; 64];
    let read = tokio::time::timeout(Duration::from_secs(5), peer.stream.read(&mut buf))
        .await
        .expect("the client did not disconnect");
    assert!(matches!(read, Ok(0)), "unexpected read {read:?}");
    assert!(wait_for(&mut rx, "").await.1);
    assert!(matches!(
        mgr.write(id, b"x"),
        Err(TelnetError::UnknownSession(_))
    ));
}

#[tokio::test]
async fn refused_connection_is_a_clear_error() {
    let (listener, port) = listen().await;
    drop(listener);
    let (s, _rx) = sink();
    let err = TelnetManager::default()
        .connect(request(port), s)
        .await
        .unwrap_err();
    assert!(
        err.to_string()
            .starts_with(&format!("cannot connect to 127.0.0.1:{port}:")),
        "{err}"
    );
}

#[tokio::test]
async fn connect_times_out() {
    // A non-routable address (TEST-NET-1) never answers.
    let (s, _rx) = sink();
    let mgr = TelnetManager::default().with_connect_timeout(Duration::from_millis(200));
    let mut req = request(23);
    req.host = "192.0.2.1".into();
    let err = mgr.connect(req, s).await.unwrap_err();
    let message = err.to_string();
    // Some networks reject the address at once instead of letting it time out.
    assert!(
        message.starts_with("cannot connect to 192.0.2.1:23:"),
        "{message}"
    );
}

#[test]
fn errors_serialize_with_kind_and_message() {
    let json = serde_json::to_value(TelnetError::Connection("boom".into())).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "kind": "connection", "message": "boom" })
    );
}

#[test]
fn request_port_defaults_to_23() {
    let req: TelnetRequest =
        serde_json::from_str(r#"{ "host": "h", "cols": 80, "rows": 24 }"#).unwrap();
    assert_eq!(req.port, 23);
}

#[tokio::test]
async fn connects_to_an_ipv6_literal() {
    // Skipped where the machine has no IPv6 loopback.
    let Ok(listener) = TcpListener::bind("[::1]:0").await else {
        return;
    };
    let port = listener.local_addr().unwrap().port();
    let mgr = TelnetManager::default();
    let (s, _rx) = sink();
    let mut req = request(port);
    req.host = "::1".into();
    mgr.connect(req, s).await.unwrap();
    let mut peer = accept(&listener).await;
    peer.expect(&[IAC, WILL, TTYPE, IAC, WILL, NAWS]).await;
}
