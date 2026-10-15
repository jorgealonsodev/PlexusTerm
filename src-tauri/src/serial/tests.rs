//! Tests use a pseudo-terminal pair as the serial device; they never open real hardware.

use super::*;
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::Instant;

use portable_pty::{MasterPty, PtyPair, PtySize, native_pty_system};

enum Event {
    Data(String),
    Exit(Option<u32>),
}

struct TestSink(Sender<Event>);

impl TerminalSink for TestSink {
    fn data(&self, text: String) {
        let _ = self.0.send(Event::Data(text));
    }
    fn exit(&self, code: Option<u32>) {
        let _ = self.0.send(Event::Exit(code));
    }
}

fn sink() -> (TestSink, Receiver<Event>) {
    let (tx, rx) = channel();
    (TestSink(tx), rx)
}

fn pty_pair() -> (PtyPair, String) {
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
        .expect("pty slave path")
        .to_string_lossy()
        .into_owned();
    assert!(path.starts_with("/dev/pts/"), "unexpected pty path {path}");
    (pair, path)
}

fn request(path: &str) -> SerialRequest {
    SerialRequest {
        path: path.into(),
        baud: 115_200,
        data_bits: 8,
        parity: ParitySetting::None,
        stop_bits: 1,
        flow: FlowSetting::None,
    }
}

/// Collects sink output until `needle` appears or the session exits.
fn wait_for(rx: &Receiver<Event>, needle: &str) -> (String, Option<Option<u32>>) {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut out = String::new();
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Event::Data(t)) => {
                out.push_str(&t);
                if !needle.is_empty() && out.contains(needle) {
                    return (out, None);
                }
            }
            Ok(Event::Exit(code)) => return (out, Some(code)),
            Err(_) => {}
        }
    }
    (out, None)
}

/// Reads from the master side on a helper thread until `needle` shows up.
fn master_reads(master: &dyn MasterPty, needle: &str) -> String {
    let mut reader = master.try_clone_reader().unwrap();
    let (tx, rx) = channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut out = Vec::new();
    while Instant::now() < deadline {
        if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
            out.extend(chunk);
            if String::from_utf8_lossy(&out).contains(needle) {
                break;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[test]
fn streams_device_output_to_the_sink() {
    let (pair, path) = pty_pair();
    let mgr = SerialManager::default();
    let (s, rx) = sink();
    let id = mgr.open(request(&path), s).unwrap();

    let mut writer = pair.master.take_writer().unwrap();
    writer.write_all("boot: ñ ok\r\n".as_bytes()).unwrap();
    writer.flush().unwrap();

    let (out, exit) = wait_for(&rx, "ok");
    assert!(out.contains("boot: ñ ok"), "output was {out:?}");
    assert_eq!(exit, None);
    mgr.close(id).unwrap();
}

#[test]
fn writes_input_to_the_device() {
    let (pair, path) = pty_pair();
    let mgr = SerialManager::default();
    let (s, _rx) = sink();
    let id = mgr.open(request(&path), s).unwrap();

    mgr.write(id, b"show version\r").unwrap();
    let out = master_reads(&*pair.master, "show version");
    assert!(out.contains("show version"), "master read {out:?}");
    mgr.close(id).unwrap();
}

fn assert_invalid(req: SerialRequest, needle: &str) {
    let mgr = SerialManager::default();
    let (s, _rx) = sink();
    match mgr.open(req, s) {
        Err(err @ SerialError::InvalidSettings(_)) => {
            assert!(err.to_string().contains(needle), "message was {err}");
        }
        other => panic!("expected invalidSettings, got {:?}", other.map(|_| ())),
    }
}

#[test]
fn rejects_invalid_settings_before_opening() {
    // The path does not exist: validation must fail first, without touching it.
    let missing = "/nonexistent/oxyterm-serial";
    assert_invalid(
        SerialRequest {
            data_bits: 9,
            ..request(missing)
        },
        "data bits",
    );
    assert_invalid(
        SerialRequest {
            baud: 0,
            ..request(missing)
        },
        "baud",
    );
    assert_invalid(
        SerialRequest {
            stop_bits: 3,
            ..request(missing)
        },
        "stop bits",
    );
    assert_invalid(request("  "), "path");
}

#[test]
fn missing_device_is_not_found() {
    let mgr = SerialManager::default();
    let (s, _rx) = sink();
    let err = mgr
        .open(request("/dev/oxyterm-test-missing-serial"), s)
        .expect_err("open should fail");
    assert!(matches!(err, SerialError::NotFound(_)), "got {err:?}");
    assert!(err.to_string().contains("not found"), "message was {err}");
}

#[test]
fn device_already_open_is_busy() {
    let (_pair, path) = pty_pair();
    let mgr = SerialManager::default();
    let (s1, _rx1) = sink();
    let id = mgr.open(request(&path), s1).unwrap();
    let (s2, _rx2) = sink();
    let err = mgr.open(request(&path), s2).expect_err("second open");
    assert!(matches!(err, SerialError::Busy(_)), "got {err:?}");
    mgr.close(id).unwrap();
}

#[test]
fn errors_serialize_with_kind_and_message() {
    let json = serde_json::to_value(SerialError::PermissionDenied("/dev/ttyUSB9".into())).unwrap();
    assert_eq!(json["kind"], "permissionDenied");
    let message = json["message"].as_str().unwrap();
    assert!(message.contains("dialout"), "message was {message}");
    assert!(message.contains("log out"), "message was {message}");

    let json = serde_json::to_value(SerialError::Busy("/dev/ttyUSB9".into())).unwrap();
    assert_eq!(json["kind"], "busy");
    let json = serde_json::to_value(SerialError::NotFound("/dev/x".into())).unwrap();
    assert_eq!(json["kind"], "notFound");
    let json = serde_json::to_value(SerialError::InvalidSettings("x".into())).unwrap();
    assert_eq!(json["kind"], "invalidSettings");
    let json = serde_json::to_value(SerialError::Io("x".into())).unwrap();
    assert_eq!(json["kind"], "io");
}

#[test]
fn permission_errors_map_to_permission_denied() {
    let err = open_error(
        "/dev/ttyUSB9",
        serialport::Error::new(
            serialport::ErrorKind::Io(IoKind::PermissionDenied),
            "Permission denied",
        ),
    );
    assert!(
        matches!(err, SerialError::PermissionDenied(_)),
        "got {err:?}"
    );
}

#[test]
fn unplugged_device_reports_the_error_and_ends() {
    let (pair, path) = pty_pair();
    let mgr = SerialManager::default();
    let (s, rx) = sink();
    mgr.open(request(&path), s).unwrap();
    // Closing the master side hangs up the slave, like a USB adapter being pulled out.
    drop(pair);

    let (out, exit) = wait_for(&rx, "");
    assert_eq!(exit, Some(None), "session did not end; output {out:?}");
    assert!(out.contains("disconnected"), "output was {out:?}");
}

#[test]
fn close_stops_the_reader_and_forgets_the_session() {
    let (_pair, path) = pty_pair();
    let mgr = SerialManager::default();
    let (s, rx) = sink();
    let id = mgr.open(request(&path), s).unwrap();
    mgr.close(id).unwrap();

    // The reader thread owns the sink; it is dropped (disconnecting the channel) once it stops.
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Err(RecvTimeoutError::Disconnected) => break,
            Ok(Event::Exit(_)) => panic!("closing must not report an exit"),
            _ => assert!(Instant::now() < deadline, "reader still running"),
        }
    }
    assert!(matches!(
        mgr.write(id, b"x"),
        Err(SerialError::UnknownSession(_))
    ));
    assert!(matches!(mgr.close(id), Err(SerialError::UnknownSession(_))));
}
