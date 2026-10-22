//! Telnet sessions over TCP (S17.1), independent of Tauri so they can be tested directly
//! against an in-process server. Option negotiation lives in [`protocol`].

pub mod protocol;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};

use crate::terminal::{TerminalSink, Utf8Stream};
use protocol::{Telnet, encode_input};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelnetRequest {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub cols: u16,
    pub rows: u16,
}

fn default_port() -> u16 {
    23
}

#[derive(Debug, thiserror::Error)]
pub enum TelnetError {
    #[error("{0}")]
    Connection(String),
    #[error("unknown telnet session {0}")]
    UnknownSession(u32),
}

impl TelnetError {
    fn kind(&self) -> &'static str {
        match self {
            Self::Connection(_) => "connection",
            Self::UnknownSession(_) => "unknownSession",
        }
    }
}

/// Serialized as `{ "kind": "...", "message": "..." }`, like serial errors.
impl serde::Serialize for TelnetError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("TelnetError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

enum Command {
    Data(Vec<u8>),
    Resize(u16, u16),
    Close,
}

pub struct TelnetManager {
    connect_timeout: Duration,
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, UnboundedSender<Command>>>,
}

impl Default for TelnetManager {
    fn default() -> Self {
        Self {
            connect_timeout: CONNECT_TIMEOUT,
            next_id: AtomicU32::new(0),
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

impl TelnetManager {
    #[cfg(test)]
    fn with_connect_timeout(mut self, timeout: Duration) -> Self {
        self.connect_timeout = timeout;
        self
    }

    /// Connects and starts negotiating; output and the end of the session go to `sink`.
    pub async fn connect(
        &self,
        req: TelnetRequest,
        sink: impl TerminalSink,
    ) -> Result<u32, TelnetError> {
        let address = format!("{}:{}", req.host.trim(), req.port);
        let stream =
            match tokio::time::timeout(self.connect_timeout, TcpStream::connect(&address)).await {
                Ok(Ok(stream)) => stream,
                Ok(Err(err)) => {
                    return Err(TelnetError::Connection(format!(
                        "cannot connect to {address}: {err}"
                    )));
                }
                Err(_) => {
                    return Err(TelnetError::Connection(format!(
                        "cannot connect to {address}: timed out after {} s",
                        self.connect_timeout.as_secs()
                    )));
                }
            };
        let _ = stream.set_nodelay(true);
        let (mut reader, mut writer) = stream.into_split();

        let mut telnet = Telnet::new(req.cols, req.rows);
        let (tx, mut commands) = unbounded_channel::<Command>();
        // Negotiation answers go through the same queue as user input, in order.
        let _ = tx.send(Command::Data(telnet.start()));
        let telnet = std::sync::Arc::new(Mutex::new(telnet));

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, tx.clone());

        // Wakes the reader when the session is closed from our side.
        let stop = std::sync::Arc::new(tokio::sync::Notify::new());
        let (writer_telnet, writer_stop) = (telnet.clone(), stop.clone());
        tokio::spawn(async move {
            while let Some(command) = commands.recv().await {
                let bytes = match command {
                    Command::Data(bytes) => bytes,
                    Command::Resize(cols, rows) => {
                        match writer_telnet.lock().unwrap().resize(cols, rows) {
                            Some(bytes) => bytes,
                            None => continue,
                        }
                    }
                    Command::Close => break,
                };
                if writer.write_all(&bytes).await.is_err() {
                    break;
                }
            }
            let _ = writer.shutdown().await;
            writer_stop.notify_one();
        });

        let flow = sink.flow();
        tokio::spawn(async move {
            let mut decoder = Utf8Stream::default();
            let mut buf = [0u8; 8192];
            loop {
                // While the webview catches up; closing (the stop below) still ends the session.
                if let Some(gate) = &flow {
                    tokio::select! {
                        _ = gate.wait() => {}
                        _ = stop.notified() => break,
                    }
                }
                let read = tokio::select! {
                    read = reader.read(&mut buf) => read,
                    _ = stop.notified() => break,
                };
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let received = telnet.lock().unwrap().receive(&buf[..n]);
                        if !received.reply.is_empty() {
                            let _ = tx.send(Command::Data(received.reply));
                        }
                        let text = decoder.push(&received.data);
                        if !text.is_empty() {
                            sink.data(text);
                        }
                    }
                }
            }
            let _ = tx.send(Command::Close);
            sink.exit(None);
        });

        Ok(id)
    }

    fn send(&self, id: u32, command: Command) -> Result<(), TelnetError> {
        let sessions = self.sessions.lock().unwrap();
        let tx = sessions.get(&id).ok_or(TelnetError::UnknownSession(id))?;
        tx.send(command)
            .map_err(|_| TelnetError::Connection("the Telnet session has ended".into()))
    }

    /// Sends user input, with IAC escaped and bare CRs sent as CR NUL.
    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), TelnetError> {
        self.send(id, Command::Data(encode_input(data)))
    }

    /// Re-sends the window size when the server enabled NAWS.
    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), TelnetError> {
        self.send(id, Command::Resize(cols, rows))
    }

    pub fn close(&self, id: u32) -> Result<(), TelnetError> {
        let tx = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(TelnetError::UnknownSession(id))?;
        let _ = tx.send(Command::Close);
        Ok(())
    }
}

#[cfg(test)]
mod tests;

/// Flow control: a paused session reads nothing until resumed, and still closes at once.
#[cfg(test)]
mod flow_tests {
    use super::*;
    use crate::terminal::FlowGate;
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};

    enum Event {
        Data(String),
        Exit,
    }

    struct GatedSink(UnboundedSender<Event>, Arc<FlowGate>);

    impl TerminalSink for GatedSink {
        fn data(&self, text: String) {
            let _ = self.0.send(Event::Data(text));
        }
        fn exit(&self, _code: Option<u32>) {
            let _ = self.0.send(Event::Exit);
        }
        fn flow(&self) -> Option<Arc<FlowGate>> {
            Some(self.1.clone())
        }
    }

    /// A paused client connected to a server that has not sent anything yet.
    async fn paused() -> (
        TelnetManager,
        u32,
        TcpStream,
        Arc<FlowGate>,
        UnboundedReceiver<Event>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = unbounded_channel();
        let gate = Arc::new(FlowGate::new());
        gate.set_paused(true);
        let mgr = TelnetManager::default();
        let request = TelnetRequest {
            host: "127.0.0.1".into(),
            port,
            cols: 80,
            rows: 24,
        };
        let id = mgr
            .connect(request, GatedSink(tx, gate.clone()))
            .await
            .unwrap();
        let (peer, _) = listener.accept().await.unwrap();
        (mgr, id, peer, gate, rx)
    }

    #[tokio::test]
    async fn a_paused_session_reads_nothing_until_resumed() {
        let (_mgr, _id, mut peer, gate, mut rx) = paused().await;
        peer.write_all(b"hello-flow").await.unwrap();
        let early = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        assert!(early.is_err(), "output was read while paused");
        gate.set_paused(false);
        let mut out = String::new();
        while !out.contains("hello-flow") {
            match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
                Ok(Some(Event::Data(text))) => out.push_str(&text),
                other => panic!("no output after resume: {:?}", other.is_ok()),
            }
        }
    }

    #[tokio::test]
    async fn closing_a_paused_session_still_ends_it_at_once() {
        let (mgr, id, _peer, _gate, mut rx) = paused().await;
        mgr.close(id).unwrap();
        let exited = tokio::time::timeout(Duration::from_secs(2), async {
            while let Some(event) = rx.recv().await {
                if matches!(event, Event::Exit) {
                    return true;
                }
            }
            false
        })
        .await;
        assert!(matches!(exited, Ok(true)), "the session did not end");
    }
}
