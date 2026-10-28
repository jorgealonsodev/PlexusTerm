//! Serial console sessions (USB adapters, on-board UARTs), independent of Tauri so they can be
//! tested directly against a pseudo-terminal pair.

pub(crate) mod ports;

use std::collections::HashMap;
use std::io::{ErrorKind as IoKind, Read, Write};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use serialport::{DataBits, FlowControl, Parity, StopBits};

use crate::platform::{self, SerialPort};
use crate::terminal::TerminalSink;

/// Lists the serial devices present on this machine (`/dev/ttyUSB0`, `COM3`, ...).
pub fn list_ports() -> Vec<String> {
    platform::serial_ports()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParitySetting {
    None,
    Odd,
    Even,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FlowSetting {
    None,
    Software,
    Hardware,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialRequest {
    pub path: String,
    pub baud: u32,
    pub data_bits: u8,
    pub parity: ParitySetting,
    pub stop_bits: u8,
    pub flow: FlowSetting,
}

#[derive(Debug, thiserror::Error)]
pub enum SerialError {
    #[error(
        "permission denied opening {0}: add your user to the \"dialout\" group (sudo usermod -aG dialout $USER), then log out and back in"
    )]
    PermissionDenied(String),
    #[error("serial device {0} not found")]
    NotFound(String),
    #[error("serial device {0} is busy (it is already open in another program)")]
    Busy(String),
    #[error("invalid serial settings: {0}")]
    InvalidSettings(String),
    #[error("unknown serial session {0}")]
    UnknownSession(u32),
    #[error("{0}")]
    Io(String),
}

impl SerialError {
    fn kind(&self) -> &'static str {
        match self {
            Self::PermissionDenied(_) => "permissionDenied",
            Self::NotFound(_) => "notFound",
            Self::Busy(_) => "busy",
            Self::InvalidSettings(_) => "invalidSettings",
            Self::UnknownSession(_) => "unknownSession",
            Self::Io(_) => "io",
        }
    }
}

/// Serialized as `{ "kind": "...", "message": "..." }` so the frontend can show the message.
impl serde::Serialize for SerialError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("SerialError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

fn open_error(path: &str, err: serialport::Error) -> SerialError {
    match err.kind {
        serialport::ErrorKind::Io(IoKind::PermissionDenied) => {
            SerialError::PermissionDenied(path.into())
        }
        serialport::ErrorKind::Io(IoKind::NotFound) => SerialError::NotFound(path.into()),
        serialport::ErrorKind::NoDevice => SerialError::Busy(path.into()),
        serialport::ErrorKind::InvalidInput => SerialError::InvalidSettings(err.description),
        _ => SerialError::Io(format!("{path}: {}", err.description)),
    }
}

fn io_err(err: impl std::fmt::Display) -> SerialError {
    SerialError::Io(err.to_string())
}

/// Checks the request and translates it into serialport settings.
fn settings(req: &SerialRequest) -> Result<(DataBits, Parity, StopBits, FlowControl), SerialError> {
    if req.path.trim().is_empty() {
        return Err(SerialError::InvalidSettings("device path is empty".into()));
    }
    if req.baud == 0 {
        return Err(SerialError::InvalidSettings(
            "baud rate must be greater than 0".into(),
        ));
    }
    let data_bits = match req.data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        8 => DataBits::Eight,
        n => {
            return Err(SerialError::InvalidSettings(format!(
                "data bits must be 5, 6, 7 or 8 (got {n})"
            )));
        }
    };
    let stop_bits = match req.stop_bits {
        1 => StopBits::One,
        2 => StopBits::Two,
        n => {
            return Err(SerialError::InvalidSettings(format!(
                "stop bits must be 1 or 2 (got {n})"
            )));
        }
    };
    let parity = match req.parity {
        ParitySetting::None => Parity::None,
        ParitySetting::Odd => Parity::Odd,
        ParitySetting::Even => Parity::Even,
    };
    let flow = match req.flow {
        FlowSetting::None => FlowControl::None,
        FlowSetting::Software => FlowControl::Software,
        FlowSetting::Hardware => FlowControl::Hardware,
    };
    Ok((data_bits, parity, stop_bits, flow))
}

/// How long one read waits before checking whether the session was closed.
const READ_TIMEOUT: Duration = Duration::from_millis(100);

struct Session {
    port: SerialPort,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SerialManager {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

impl SerialManager {
    pub fn open(&self, req: SerialRequest, sink: impl TerminalSink) -> Result<u32, SerialError> {
        let (data_bits, parity, stop_bits, flow) = settings(&req)?;
        let builder = serialport::new(&req.path, req.baud)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .flow_control(flow)
            .timeout(READ_TIMEOUT);
        let port = platform::open_serial(builder).map_err(|err| open_error(&req.path, err))?;
        let mut reader = platform::clone_serial(&port).map_err(io_err)?;

        let stop = Arc::new(AtomicBool::new(false));
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(
            id,
            Session {
                port,
                stop: stop.clone(),
            },
        );

        let path = req.path;
        std::thread::spawn(move || {
            let mut decoder = sink.decoder();
            let mut buf = [0u8; 4096];
            // Never paused by flow control: a serial device has no backpressure (without RTS/CTS
            // or XON/XOFF its output would overflow the system's few-KB buffer and be lost).
            while !stop.load(Ordering::Relaxed) {
                match reader.read(&mut buf) {
                    Ok(0) => {}
                    Ok(n) => {
                        let text = decoder.push(&buf[..n]);
                        if !text.is_empty() {
                            sink.data(text);
                        }
                    }
                    Err(err)
                        if matches!(
                            err.kind(),
                            IoKind::TimedOut | IoKind::WouldBlock | IoKind::Interrupted
                        ) => {}
                    Err(err) => {
                        // Closing the session from our side is not an error worth reporting.
                        if !stop.load(Ordering::Relaxed) {
                            sink.data(format!(
                                "\r\n\x1b[31mSerial device {path} disconnected: {err}\x1b[0m\r\n"
                            ));
                            sink.exit(None);
                        }
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), SerialError> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(&id)
            .ok_or(SerialError::UnknownSession(id))?;
        session.port.write_all(data).map_err(io_err)?;
        session.port.flush().map_err(io_err)
    }

    /// Stops the reader thread and closes the device.
    pub fn close(&self, id: u32) -> Result<(), SerialError> {
        let session = self
            .sessions
            .lock()
            .unwrap()
            .remove(&id)
            .ok_or(SerialError::UnknownSession(id))?;
        session.stop.store(true, Ordering::Relaxed);
        Ok(())
    }
}

// The tests drive a Unix pseudo-terminal pair.
#[cfg(all(test, unix))]
mod tests;

/// Flow control: a serial session keeps reading even when its terminal asks to pause, so the
/// device's output is never lost, and still closes at once.
#[cfg(all(test, unix))]
mod flow_tests {
    use super::*;
    use crate::terminal::FlowGate;
    use portable_pty::{PtySize, native_pty_system};
    use std::io::Write;
    use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
    use std::time::Instant;

    struct GatedSink(Sender<String>, Arc<FlowGate>);

    impl TerminalSink for GatedSink {
        fn data(&self, text: String) {
            let _ = self.0.send(text);
        }
        fn exit(&self, _code: Option<u32>) {}
        fn flow(&self) -> Option<Arc<FlowGate>> {
            Some(self.1.clone())
        }
    }

    /// A paused session on a pseudo-terminal standing in for the device.
    fn paused() -> (
        SerialManager,
        u32,
        portable_pty::PtyPair,
        Arc<FlowGate>,
        Receiver<String>,
    ) {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let path = pair
            .master
            .tty_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let (tx, rx) = channel();
        let gate = Arc::new(FlowGate::new());
        gate.set_paused(true);
        let mgr = SerialManager::default();
        let request = SerialRequest {
            path,
            baud: 115_200,
            data_bits: 8,
            parity: ParitySetting::None,
            stop_bits: 1,
            flow: FlowSetting::None,
        };
        let id = mgr.open(request, GatedSink(tx, gate.clone())).unwrap();
        (mgr, id, pair, gate, rx)
    }

    #[test]
    fn a_paused_session_keeps_reading_so_nothing_is_lost() {
        let (mgr, id, pair, _gate, rx) = paused();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"boot-flow\r\n").unwrap();
        writer.flush().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut out = String::new();
        while !out.contains("boot-flow") && Instant::now() < deadline {
            if let Ok(text) = rx.recv_timeout(Duration::from_millis(100)) {
                out.push_str(&text);
            }
        }
        assert!(out.contains("boot-flow"), "output was {out:?}");
        mgr.close(id).unwrap();
    }

    #[test]
    fn closing_a_paused_session_still_stops_its_reader_at_once() {
        let (mgr, id, _pair, _gate, rx) = paused();
        let started = Instant::now();
        mgr.close(id).unwrap();
        // The reader thread owns the sink; it is dropped once the reader stops.
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Err(RecvTimeoutError::Disconnected) => break,
                _ => assert!(
                    started.elapsed() < Duration::from_secs(2),
                    "reader still running"
                ),
            }
        }
    }
}
