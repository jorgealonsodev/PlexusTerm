//! Pieces shared by every kind of terminal session (local PTY, SSH, ...).

use std::sync::Arc;

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
}
