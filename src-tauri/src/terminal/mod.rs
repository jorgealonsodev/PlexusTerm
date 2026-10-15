//! Pieces shared by every kind of terminal session (local PTY, SSH, ...).

mod utf8;

pub use utf8::Utf8Stream;

/// Receives the output of one terminal session.
pub trait TerminalSink: Send + 'static {
    fn data(&self, text: String);
    fn exit(&self, code: Option<u32>);
}
