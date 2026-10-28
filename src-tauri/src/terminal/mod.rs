//! Pieces shared by every kind of terminal session (local PTY, SSH, ...).

use std::sync::{Arc, Mutex};

pub mod coalesce;
pub mod flow;
mod utf8;

pub use flow::FlowGate;
pub use utf8::Utf8Stream;

/// Receives the output of one terminal session.
pub trait TerminalSink: Send + 'static {
    fn data(&self, text: String);
    fn exit(&self, code: Option<u32>);
    /// The gate the session's reader waits on while the webview catches up; None reads freely.
    fn flow(&self) -> Option<Arc<FlowGate>> {
        None
    }
    /// What the session's reader turns its raw output into text with.
    fn decoder(&self) -> Decoder {
        Decoder::default()
    }
}

/// Turns a session's raw output into text: plain UTF-8 decoding, or first through the session's
/// ZMODEM link, which takes the bytes of a file transfer before they become text.
pub enum Decoder {
    Plain(Utf8Stream),
    Zmodem(Arc<Mutex<crate::zmodem::Link>>),
}

impl Default for Decoder {
    fn default() -> Self {
        Decoder::Plain(Utf8Stream::default())
    }
}

impl Decoder {
    /// The text for the terminal in `bytes` (with what earlier reads left incomplete).
    pub fn push(&mut self, bytes: &[u8]) -> String {
        match self {
            Decoder::Plain(utf8) => utf8.push(bytes),
            Decoder::Zmodem(link) => crate::zmodem::lock(link).feed(bytes),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_decoder_decodes_like_utf8_stream() {
        let bytes = "a ñ **\x18B00 z".as_bytes();
        let mut decoder = Decoder::default();
        let mut plain = Utf8Stream::default();
        let mut got = String::new();
        let mut want = String::new();
        for piece in bytes.chunks(2) {
            got.push_str(&decoder.push(piece));
            want.push_str(&plain.push(piece));
        }
        assert_eq!(got, want);
    }
}
