//! Terminal output on its way to the webview, in fewer and larger messages: each message is one
//! script the webview runs on its UI thread, so a burst of small reads (a TUI redrawing, an AI
//! tool streaming) would queue hundreds of them in front of the next key's echo.

use std::sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError};
use std::time::{Duration, Instant};

/// What a session sends on: output text, then its exit code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output(String),
    Exit(Option<u32>),
}

/// Output arriving within this long of the previous message is still part of a burst.
pub const BURST_GAP: Duration = Duration::from_millis(8);
/// During a burst, output is gathered for this long before it is sent.
pub const WINDOW: Duration = Duration::from_millis(4);
/// A batch never grows beyond this many bytes.
pub const MAX_BATCH: usize = 64 * 1024;

/// Forwards the events of `rx` to `send` in order until the exit or until every sender is gone.
/// Output after a quiet moment (a key's echo) goes out at once; output during a burst is
/// gathered for [`WINDOW`] at most.
pub fn forward(rx: Receiver<Event>, mut send: impl FnMut(Event)) {
    let mut last_sent: Option<Instant> = None;
    while let Ok(first) = rx.recv() {
        let mut batch = match first {
            Event::Exit(code) => return send(Event::Exit(code)),
            Event::Output(text) => text,
        };
        let busy = last_sent.is_some_and(|at| at.elapsed() < BURST_GAP);
        let deadline = Instant::now() + if busy { WINDOW } else { Duration::ZERO };
        let mut exit = None;
        let mut gone = false;
        while batch.len() < MAX_BATCH {
            let next = match deadline.checked_duration_since(Instant::now()) {
                Some(wait) if !wait.is_zero() => rx.recv_timeout(wait).map_err(|err| match err {
                    RecvTimeoutError::Timeout => TryRecvError::Empty,
                    RecvTimeoutError::Disconnected => TryRecvError::Disconnected,
                }),
                _ => rx.try_recv(),
            };
            match next {
                Ok(Event::Output(text)) => batch.push_str(&text),
                Ok(Event::Exit(code)) => {
                    exit = Some(code);
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    gone = true;
                    break;
                }
            }
        }
        send(Event::Output(batch));
        last_sent = Some(Instant::now());
        if let Some(code) = exit {
            return send(Event::Exit(code));
        }
        if gone {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    fn run(events: Vec<Event>) -> Vec<Event> {
        let (tx, rx) = channel();
        for event in events {
            tx.send(event).unwrap();
        }
        drop(tx);
        let mut out = Vec::new();
        forward(rx, |event| out.push(event));
        out
    }

    fn output(text: &str) -> Event {
        Event::Output(text.to_string())
    }

    #[test]
    fn output_already_waiting_goes_out_as_one_message_in_order() {
        let out = run(vec![
            output("a"),
            output("b"),
            output("c"),
            Event::Exit(Some(0)),
        ]);
        assert_eq!(out, vec![output("abc"), Event::Exit(Some(0))]);
    }

    #[test]
    fn the_first_output_after_a_quiet_moment_is_sent_at_once() {
        let (tx, rx) = channel();
        let (got_tx, got_rx) = channel();
        let forwarder =
            std::thread::spawn(move || forward(rx, |event| got_tx.send(event).unwrap()));
        tx.send(output("x")).unwrap();
        let echo = got_rx.recv_timeout(Duration::from_millis(50)).unwrap();
        assert_eq!(echo, output("x"));
        drop(tx);
        forwarder.join().unwrap();
    }

    #[test]
    fn a_burst_is_gathered_into_few_messages_without_losing_or_reordering_text() {
        let (tx, rx) = channel();
        let (got_tx, got_rx) = channel();
        let forwarder =
            std::thread::spawn(move || forward(rx, |event| got_tx.send(event).unwrap()));
        let mut sent = String::new();
        for i in 0..2000 {
            let piece = format!("{i},");
            sent.push_str(&piece);
            tx.send(Event::Output(piece)).unwrap();
            if i % 50 == 0 {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        tx.send(Event::Exit(None)).unwrap();
        forwarder.join().unwrap();
        let events: Vec<Event> = got_rx.try_iter().collect();
        assert_eq!(events.last(), Some(&Event::Exit(None)));
        let text: String = events
            .iter()
            .filter_map(|event| match event {
                Event::Output(text) => Some(text.as_str()),
                Event::Exit(_) => None,
            })
            .collect();
        assert_eq!(text, sent);
        assert!(
            events.len() < 200,
            "{} messages for 2000 reads",
            events.len()
        );
    }

    #[test]
    fn a_batch_never_grows_past_its_limit() {
        let piece = "x".repeat(1024);
        let out = run((0..200).map(|_| output(&piece)).collect());
        assert!(out.len() >= 3, "{}", out.len());
        for event in &out {
            if let Event::Output(text) = event {
                assert!(text.len() <= MAX_BATCH + piece.len());
            }
        }
    }
}
