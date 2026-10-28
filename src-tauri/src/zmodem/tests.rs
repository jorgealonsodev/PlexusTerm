//! A link against the other end of a transfer played by `zmodem2` itself: its `Sender` stands
//! for the remote `sz`, its `Receiver` for the remote `rz`.

use super::*;
use zmodem2::{Action, Event, FileInfo, Position, Receiver, Sender};

struct Harness {
    link: Arc<Mutex<Link>>,
    /// What the link wrote to the session (the remote's input).
    to_remote: Arc<Mutex<Vec<u8>>>,
    outs: Arc<Mutex<Vec<Out>>>,
}

impl Harness {
    fn new(enabled: bool) -> Self {
        let outs = Arc::new(Mutex::new(Vec::new()));
        let seen = outs.clone();
        let emit: Emit = Arc::new(move |out| seen.lock().unwrap().push(out));
        let link = Link::with_switch(emit, Arc::new(AtomicBool::new(enabled)));
        let to_remote = Arc::new(Mutex::new(Vec::new()));
        let sink = to_remote.clone();
        lock(&link).set_writer(Arc::new(move |bytes: &[u8]| {
            sink.lock().unwrap().extend_from_slice(bytes);
            Ok(())
        }));
        Self {
            link,
            to_remote,
            outs,
        }
    }

    fn feed(&self, bytes: &[u8]) -> String {
        lock(&self.link).feed(bytes)
    }

    fn take_written(&self) -> Vec<u8> {
        std::mem::take(&mut *self.to_remote.lock().unwrap())
    }

    fn notices(&self) -> Vec<Notice> {
        self.outs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|out| match out {
                Out::Notice(notice) => Some(notice.clone()),
                Out::Text(_) => None,
            })
            .collect()
    }

    fn last_notice(&self) -> Option<Notice> {
        self.notices().pop()
    }
}

fn content(len: usize) -> Vec<u8> {
    // Every byte value, ZDLE, XON/XOFF, CR and ESC included, in an order that does not repeat
    // quickly.
    let mut x: u32 = 0x1234_5678;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 24) as u8
        })
        .collect()
}

/// The remote `sz`, sending `name` with `data`.
struct RemoteSz {
    sender: Sender,
    data: Vec<u8>,
    inbox: Vec<u8>,
}

impl RemoteSz {
    fn new(name: &[u8], data: Vec<u8>) -> Self {
        let mut sender = Sender::new().unwrap();
        let size = u32::try_from(data.len()).unwrap();
        sender
            .start_file(FileInfo::new(name, Some(Position::new(size))))
            .unwrap();
        Self {
            sender,
            data,
            inbox: Vec::new(),
        }
    }

    /// Runs the remote until it needs input; returns what it wrote.
    fn run(&mut self) -> (Vec<u8>, bool) {
        let mut out = Vec::new();
        loop {
            match self.sender.poll() {
                Action::WriteWire(bytes) => {
                    out.extend_from_slice(bytes);
                    let n = bytes.len();
                    self.sender.wire_written(n);
                }
                Action::ReadFile { offset, max_len } => {
                    let start = offset.get() as usize;
                    let end = (start + max_len).min(self.data.len());
                    let chunk = self.data[start..end].to_vec();
                    self.sender.submit_file(&chunk).unwrap();
                }
                Action::Event(Event::FileCompleted) => self.sender.finish().unwrap(),
                Action::Event(Event::SessionCompleted) => {
                    while let Action::WriteWire(bytes) = self.sender.poll() {
                        out.extend_from_slice(bytes);
                        let n = bytes.len();
                        self.sender.wire_written(n);
                    }
                    return (out, true);
                }
                Action::Event(Event::Aborted) => return (out, true),
                _ => {
                    if self.inbox.is_empty() {
                        return (out, false);
                    }
                    match self.sender.submit_wire(&self.inbox) {
                        Ok(0) => return (out, false),
                        Ok(n) => {
                            self.inbox.drain(..n);
                        }
                        Err(_) => self.inbox.clear(),
                    }
                }
            }
        }
    }

    /// Bytes for the remote, taken as it can.
    fn take(&mut self, bytes: &[u8]) {
        self.inbox.extend_from_slice(bytes);
    }
}

/// Plays a whole receive: `sz` starts, the user picks `dir`, the file goes through in reads of
/// `chunk` bytes.
fn receive_through(h: &Harness, remote: &mut RemoteSz, dir: &std::path::Path, chunk: usize) {
    let (start, _) = remote.run();
    h.feed(&start);
    assert_eq!(
        h.last_notice(),
        Some(Notice::Offer {
            direction: Direction::Receive
        })
    );
    lock(&h.link).receive(dir.to_path_buf()).unwrap();
    for _ in 0..100_000 {
        let answer = h.take_written();
        if !answer.is_empty() {
            remote.take(&answer);
        }
        let (out, over) = remote.run();
        for piece in out.chunks(chunk.max(1)) {
            assert_eq!(
                h.feed(piece),
                "",
                "transfer bytes must not reach the terminal"
            );
        }
        if over {
            // The receiver's last ZFIN reaches the sender, which ends with "OO".
            let answer = h.take_written();
            remote.take(&answer);
            let (out, _) = remote.run();
            if !out.is_empty() {
                h.feed(&out);
            }
            return;
        }
    }
    panic!("the transfer never ended");
}

#[test]
fn a_typed_asterisk_is_echoed_at_once() {
    // `ls *` must not wait for a header that never comes.
    let h = Harness::new(true);
    assert_eq!(h.feed(b"*"), "*");
    assert_eq!(h.feed(b"[****"), "[****");
}

#[test]
fn a_full_receive_writes_the_exact_file_and_hands_the_terminal_back() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    let data = content(150_000);
    let mut remote = RemoteSz::new(b"report.bin", data.clone());
    receive_through(&h, &mut remote, dir.path(), 777);
    let saved = dir.path().join("report.bin");
    assert_eq!(std::fs::read(&saved).unwrap(), data);
    assert_eq!(
        h.last_notice(),
        Some(Notice::Done {
            direction: Direction::Receive,
            files: vec![saved.to_string_lossy().into_owned()],
        })
    );
    assert!(h.notices().iter().any(|n| matches!(
        n,
        Notice::Progress { file, total: Some(150_000), .. } if file == "report.bin"
    )));
    assert_eq!(h.feed(b"$ "), "$ ");
    assert_eq!(h.feed(b"ls\r\n"), "ls\r\n");
}

#[test]
fn a_received_name_stays_in_the_folder_and_never_overwrites() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("data.bin"), b"mine").unwrap();
    let mut remote = RemoteSz::new(b"../../data.bin", b"theirs".to_vec());
    receive_through(&h, &mut remote, dir.path(), 64);
    assert_eq!(std::fs::read(dir.path().join("data.bin")).unwrap(), b"mine");
    assert_eq!(
        std::fs::read(dir.path().join("data (1).bin")).unwrap(),
        b"theirs"
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    assert!(
        !dir.path().parent().unwrap().join("data.bin").exists(),
        "nothing is written outside the folder"
    );
}

#[test]
fn cancelling_a_receive_sends_cans_and_removes_the_partial_file() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    let mut remote = RemoteSz::new(b"big.bin", content(400_000));
    let (start, _) = remote.run();
    h.feed(&start);
    lock(&h.link).receive(dir.path().to_path_buf()).unwrap();
    // Run until part of the file is on disk.
    let partial = dir.path().join("big.bin");
    for _ in 0..1000 {
        let answer = h.take_written();
        remote.take(&answer);
        let (out, _) = remote.run();
        h.feed(&out);
        if std::fs::metadata(&partial).is_ok_and(|m| m.len() > 0) {
            break;
        }
    }
    assert!(partial.exists(), "the transfer started");
    h.take_written();
    lock(&h.link).cancel().unwrap();
    let written = h.take_written();
    assert!(
        written.windows(8).any(|w| w == [0x18; 8]),
        "the other end is told with CANs: {written:?}"
    );
    assert!(!partial.exists(), "the unfinished file is removed");
    assert_eq!(
        h.last_notice(),
        Some(Notice::Cancelled {
            direction: Direction::Receive,
            files: Vec::new(),
        })
    );
    // The rest of the remote's data is dropped, then the terminal goes on.
    let (late, _) = remote.run();
    assert_eq!(h.feed(&late), "");
    std::thread::sleep(DRAIN + Duration::from_millis(100));
    assert_eq!(h.feed(b"$ "), "$ ");
}

#[test]
fn declining_an_offer_sends_cans() {
    let h = Harness::new(true);
    let mut remote = RemoteSz::new(b"x", vec![1, 2, 3]);
    let (start, _) = remote.run();
    h.feed(&start);
    lock(&h.link).cancel().unwrap();
    let written = h.take_written();
    assert!(written.windows(8).any(|w| w == [0x18; 8]));
    assert!(matches!(h.last_notice(), Some(Notice::Cancelled { .. })));
}

#[test]
fn after_declining_the_shell_text_shows_at_once_and_only_transfer_bytes_are_dropped() {
    let h = Harness::new(true);
    let mut remote = RemoteSz::new(b"x", vec![1, 2, 3]);
    let (start, _) = remote.run();
    h.feed(&start);
    lock(&h.link).cancel().unwrap();
    // What the remote still had on its way: frames with ZDLE and CANs.
    assert_eq!(h.feed(b"**\x18B0100000000aa51\r\x8a\x11\x18\x18\x18"), "");
    // The shell's prompt after `sz` gave up, well within the old one-second drain.
    assert_eq!(h.feed(b"\r\nuser@host:~$ "), "\r\nuser@host:~$ ");
    assert_eq!(h.feed(b"ls\r\n"), "ls\r\n");
}

#[test]
fn a_send_produces_frames_a_receiver_accepts() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    let first = content(70_000);
    let second = b"second file\n".to_vec();
    std::fs::write(dir.path().join("one.bin"), &first).unwrap();
    std::fs::write(dir.path().join("two.txt"), &second).unwrap();

    // The remote `rz` starts with ZRINIT.
    let mut remote = Receiver::new().unwrap();
    let mut start = Vec::new();
    while let Action::WriteWire(bytes) = remote.poll() {
        start.extend_from_slice(bytes);
        let n = bytes.len();
        remote.wire_written(n);
    }
    assert_eq!(h.feed(&[b"rz waiting\r\n".as_slice(), &start].concat()), "");
    assert_eq!(
        h.last_notice(),
        Some(Notice::Offer {
            direction: Direction::Send
        })
    );
    lock(&h.link)
        .send(vec![dir.path().join("one.bin"), dir.path().join("two.txt")])
        .unwrap();

    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut done = false;
    while !done {
        assert!(Instant::now() < deadline, "the send never ended");
        let input = h.take_written();
        let mut rest = input.as_slice();
        loop {
            match remote.poll() {
                Action::WriteWire(bytes) => {
                    let answer = bytes.to_vec();
                    remote.wire_written(answer.len());
                    assert_eq!(h.feed(&answer), "");
                }
                Action::WriteFile(bytes) => {
                    let n = bytes.len();
                    files.last_mut().unwrap().1.extend_from_slice(bytes);
                    remote.file_written(n).unwrap();
                }
                Action::Event(Event::FileStarted(info)) => {
                    files.push((String::from_utf8_lossy(info.name).into_owned(), Vec::new()));
                }
                Action::Event(Event::SessionCompleted) => {
                    while let Action::WriteWire(bytes) = remote.poll() {
                        let answer = bytes.to_vec();
                        remote.wire_written(answer.len());
                        h.feed(&answer);
                    }
                    done = true;
                    break;
                }
                Action::Event(_) => {}
                _ => {
                    if rest.is_empty() {
                        break;
                    }
                    match remote.submit_wire(rest) {
                        Ok(n) => rest = &rest[n..],
                        Err(_) => rest = &[],
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(
        files,
        vec![
            ("one.bin".to_string(), first),
            ("two.txt".to_string(), second)
        ]
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !matches!(h.last_notice(), Some(Notice::Done { .. })) {
        assert!(Instant::now() < deadline, "no Done notice");
        std::thread::sleep(Duration::from_millis(5));
    }
    while matches!(lock(&h.link).state, State::Sending(_)) {
        assert!(Instant::now() < deadline, "still sending");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(h.feed(b"$ "), "$ ");
}

#[test]
fn cancelling_a_send_tells_the_receiver() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.bin"), content(10_000)).unwrap();
    let mut remote = Receiver::new().unwrap();
    let mut start = Vec::new();
    while let Action::WriteWire(bytes) = remote.poll() {
        start.extend_from_slice(bytes);
        let n = bytes.len();
        remote.wire_written(n);
    }
    h.feed(&start);
    lock(&h.link).send(vec![dir.path().join("a.bin")]).unwrap();
    lock(&h.link).cancel().unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !matches!(h.last_notice(), Some(Notice::Cancelled { .. })) {
        assert!(Instant::now() < deadline, "no Cancelled notice");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(h.take_written().windows(8).any(|w| w == [0x18; 8]));
}

#[test]
fn text_before_an_offer_reaches_the_pane_before_it() {
    let h = Harness::new(true);
    let header = detect::hex_header(0, [0; 4]);
    assert_eq!(
        h.feed(&[b"$ sz f\r\nrz\r".as_slice(), &header].concat()),
        ""
    );
    assert_eq!(
        *h.outs.lock().unwrap(),
        vec![
            Out::Text("$ sz f\r\nrz\r".into()),
            Out::Notice(Notice::Offer {
                direction: Direction::Receive
            })
        ]
    );
}

#[test]
fn a_header_split_across_reads_is_one_offer() {
    let h = Harness::new(true);
    let header = detect::hex_header(1, [0, 4, 0, 0x23]);
    assert_eq!(
        h.feed(&[b"rz ready ".as_slice(), &header[..9]].concat()),
        "rz ready "
    );
    assert_eq!(h.feed(&header[9..]), "");
    assert_eq!(
        h.notices(),
        vec![Notice::Offer {
            direction: Direction::Send
        }]
    );
    // The remote repeating its header while the user decides is no second offer.
    assert_eq!(h.feed(&header), "");
    assert_eq!(h.notices().len(), 1);
}

#[test]
fn a_false_start_is_shown_after_a_moment() {
    let h = Harness::new(true);
    assert_eq!(h.feed(b"a **\x18B0"), "a ");
    std::thread::sleep(HOLD + Duration::from_millis(200));
    assert_eq!(*h.outs.lock().unwrap(), vec![Out::Text("**\x18B0".into())]);
    assert!(h.notices().is_empty());
    assert_eq!(h.feed(b"b"), "b");
}

#[test]
fn with_the_setting_off_bytes_pass_through_unchanged() {
    let h = Harness::new(false);
    let input = [
        b"rz\r".as_slice(),
        &detect::hex_header(0, [0; 4]),
        "ñ".as_bytes(),
    ]
    .concat();
    let mut plain = Utf8Stream::default();
    let expected = plain.push(&input);
    let mut got = String::new();
    for piece in input.chunks(3) {
        got.push_str(&h.feed(piece));
    }
    assert_eq!(got, expected);
    assert!(h.outs.lock().unwrap().is_empty());
    assert!(h.take_written().is_empty());
}

#[test]
fn an_answer_without_an_offer_is_refused() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    assert!(lock(&h.link).receive(dir.path().to_path_buf()).is_err());
    assert!(lock(&h.link).send(vec![dir.path().join("x")]).is_err());
}

#[test]
fn the_session_ending_mid_receive_removes_the_partial_file() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    let mut remote = RemoteSz::new(b"cut.bin", content(300_000));
    let (start, _) = remote.run();
    h.feed(&start);
    lock(&h.link).receive(dir.path().to_path_buf()).unwrap();
    let partial = dir.path().join("cut.bin");
    for _ in 0..1000 {
        let answer = h.take_written();
        remote.take(&answer);
        let (out, _) = remote.run();
        h.feed(&out);
        if std::fs::metadata(&partial).is_ok_and(|m| m.len() > 0) {
            break;
        }
    }
    assert!(partial.exists());
    lock(&h.link).ended();
    assert!(!partial.exists());
}

#[test]
fn accepting_a_false_start_gives_the_output_back_to_the_terminal() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    h.feed(&detect::hex_header(0, [0; 4]));
    lock(&h.link).receive(dir.path().to_path_buf()).unwrap();
    // No `sz` answers: the shell echoes what is typed.
    assert_eq!(h.feed(b"$ ls\r\n"), "");
    std::thread::sleep(receive::NO_START_AFTER + Duration::from_millis(1500));
    let outs = h.outs.lock().unwrap().clone();
    assert!(outs.contains(&Out::Text("$ ls\r\n".into())), "{outs:?}");
    assert!(matches!(h.last_notice(), Some(Notice::Failed { .. })));
    assert!(
        !h.take_written().windows(5).any(|w| w == [0x18; 5]),
        "no CANs typed into a shell"
    );
    assert_eq!(h.feed(b"x"), "x");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn sending_to_a_false_start_gives_the_output_back_to_the_terminal() {
    let h = Harness::new(true);
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.txt"), b"a").unwrap();
    h.feed(&detect::hex_header(1, [0, 4, 0, 0x23]));
    lock(&h.link).send(vec![dir.path().join("a.txt")]).unwrap();
    assert_eq!(h.feed(b"$ ls\r\n"), "");
    let deadline = Instant::now() + Duration::from_secs(10);
    while matches!(lock(&h.link).state, State::Sending(_)) {
        assert!(Instant::now() < deadline, "still sending");
        std::thread::sleep(Duration::from_millis(20));
    }
    let outs = h.outs.lock().unwrap().clone();
    assert!(outs.contains(&Out::Text("$ ls\r\n".into())), "{outs:?}");
    assert_eq!(h.feed(b"x"), "x");
}
