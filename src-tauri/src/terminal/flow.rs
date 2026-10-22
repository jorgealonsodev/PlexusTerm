//! Flow control for a session's output: the webview asks to pause reading while its terminal has
//! too much output still to parse, and to resume once it caught up. A paused session's reader
//! waits here instead of reading, so the program's own output blocks (the operating system or the
//! remote end holds it) rather than piling up in memory on its way to the webview.

use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

/// A pause the webview never lifted (its resume lost, the pane gone) ends after this long.
pub const LEASE: Duration = Duration::from_secs(5);

#[derive(Default)]
struct State {
    /// When the current pause began (or was last confirmed); None while reading may go on.
    paused_at: Option<Instant>,
    closed: bool,
}

/// Whether one session's reader may read on.
pub struct FlowGate {
    state: Mutex<State>,
    changed: Condvar,
    notify: tokio::sync::Notify,
    lease: Duration,
}

impl Default for FlowGate {
    fn default() -> Self {
        Self::with_lease(LEASE)
    }
}

impl FlowGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_lease(lease: Duration) -> Self {
        Self {
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
            notify: tokio::sync::Notify::new(),
            lease,
        }
    }

    /// How much longer a reader must wait now; None when it may read.
    fn remaining(&self, state: &State) -> Option<Duration> {
        if state.closed {
            return None;
        }
        let left = self.lease.checked_sub(state.paused_at?.elapsed())?;
        (!left.is_zero()).then_some(left)
    }

    /// Pauses or resumes reading. A closed gate stays open for good.
    pub fn set_paused(&self, paused: bool) {
        {
            let mut state = self.state.lock().unwrap();
            if state.closed {
                return;
            }
            state.paused_at = paused.then(Instant::now);
        }
        self.wake();
    }

    /// The session ended or no longer has a webview to slow it down: never wait again.
    pub fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.wake();
    }

    fn wake(&self) {
        self.changed.notify_all();
        self.notify.notify_waiters();
    }

    /// Blocks the calling thread while reading is paused.
    pub fn wait_sync(&self) {
        while !self.wait_sync_for(Duration::from_secs(3600)) {}
    }

    /// Blocks while reading is paused, for `max` at most; true when reading may go on.
    pub fn wait_sync_for(&self, max: Duration) -> bool {
        let deadline = Instant::now() + max;
        let mut state = self.state.lock().unwrap();
        loop {
            let Some(left) = self.remaining(&state) else {
                return true;
            };
            let Some(until_deadline) = deadline.checked_duration_since(Instant::now()) else {
                return false;
            };
            if until_deadline.is_zero() {
                return false;
            }
            state = self
                .changed
                .wait_timeout(state, left.min(until_deadline))
                .unwrap()
                .0;
        }
    }

    /// Waits (asynchronously) while reading is paused.
    pub async fn wait(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            // Registered before the state is read, so a resume in between is not lost.
            notified.as_mut().enable();
            let Some(left) = self.remaining(&self.state.lock().unwrap()) else {
                return;
            };
            let _ = tokio::time::timeout(left, notified).await;
        }
    }
}

/// The gate of every live session, by its share tap id (the id the webview already gets).
#[derive(Default)]
pub struct Gates {
    gates: Mutex<HashMap<u64, Weak<FlowGate>>>,
}

impl Gates {
    pub fn register(&self, tap: u64, gate: &Arc<FlowGate>) {
        let mut gates = self.gates.lock().unwrap();
        gates.retain(|_, g| g.strong_count() > 0);
        gates.insert(tap, Arc::downgrade(gate));
    }

    /// Pauses or resumes session `tap`; false when it is gone.
    pub fn set_paused(&self, tap: u64, paused: bool) -> bool {
        let gate = self.gates.lock().unwrap().get(&tap).and_then(Weak::upgrade);
        match gate {
            Some(gate) => {
                gate.set_paused(paused);
                true
            }
            None => false,
        }
    }
}

pub fn gates() -> &'static Gates {
    static GATES: OnceLock<Gates> = OnceLock::new();
    GATES.get_or_init(Gates::default)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;

    const SHORT: Duration = Duration::from_millis(150);

    /// Runs `wait_sync` on a thread; the receiver gets a message once it returned.
    fn waiting(gate: &Arc<FlowGate>) -> std::sync::mpsc::Receiver<()> {
        let (tx, rx) = channel();
        let gate = gate.clone();
        std::thread::spawn(move || {
            gate.wait_sync();
            let _ = tx.send(());
        });
        rx
    }

    #[test]
    fn an_open_gate_never_waits() {
        let gate = Arc::new(FlowGate::new());
        assert!(waiting(&gate).recv_timeout(SHORT).is_ok());
    }

    #[test]
    fn a_paused_gate_waits_until_resumed() {
        let gate = Arc::new(FlowGate::new());
        gate.set_paused(true);
        let done = waiting(&gate);
        assert!(done.recv_timeout(SHORT).is_err());
        gate.set_paused(false);
        assert!(done.recv_timeout(SHORT).is_ok());
    }

    #[test]
    fn closing_releases_a_paused_gate_for_good() {
        let gate = Arc::new(FlowGate::new());
        gate.set_paused(true);
        let done = waiting(&gate);
        assert!(done.recv_timeout(SHORT).is_err());
        gate.close();
        assert!(done.recv_timeout(SHORT).is_ok());
        gate.set_paused(true);
        assert!(waiting(&gate).recv_timeout(SHORT).is_ok());
    }

    #[test]
    fn a_pause_never_lifted_ends_after_its_lease() {
        let gate = Arc::new(FlowGate::with_lease(Duration::from_millis(300)));
        gate.set_paused(true);
        let started = Instant::now();
        let done = waiting(&gate);
        assert!(done.recv_timeout(Duration::from_secs(3)).is_ok());
        assert!(started.elapsed() >= Duration::from_millis(250));
    }

    #[test]
    fn a_bounded_wait_returns_false_while_still_paused() {
        let gate = FlowGate::new();
        gate.set_paused(true);
        assert!(!gate.wait_sync_for(Duration::from_millis(50)));
        gate.set_paused(false);
        assert!(gate.wait_sync_for(Duration::from_millis(50)));
    }

    #[tokio::test]
    async fn an_async_wait_follows_pause_resume_and_close() {
        let gate = Arc::new(FlowGate::new());
        gate.set_paused(true);
        let waiter = tokio::spawn({
            let gate = gate.clone();
            async move { gate.wait().await }
        });
        tokio::time::sleep(SHORT).await;
        assert!(!waiter.is_finished());
        gate.set_paused(false);
        tokio::time::timeout(SHORT, waiter).await.unwrap().unwrap();

        gate.set_paused(true);
        let waiter = tokio::spawn({
            let gate = gate.clone();
            async move { gate.wait().await }
        });
        tokio::time::sleep(SHORT).await;
        assert!(!waiter.is_finished());
        gate.close();
        tokio::time::timeout(SHORT, waiter).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn an_async_wait_ends_after_the_lease() {
        let gate = FlowGate::with_lease(Duration::from_millis(200));
        gate.set_paused(true);
        tokio::time::timeout(Duration::from_secs(3), gate.wait())
            .await
            .unwrap();
    }

    #[test]
    fn gates_are_found_by_tap_while_their_session_lives() {
        let gates = Gates::default();
        let gate = Arc::new(FlowGate::new());
        gates.register(7, &gate);
        assert!(gates.set_paused(7, true));
        assert!(!gate.wait_sync_for(Duration::from_millis(20)));
        assert!(gates.set_paused(7, false));
        assert!(gate.wait_sync_for(Duration::from_millis(20)));
        assert!(!gates.set_paused(8, true));
        drop(gate);
        assert!(!gates.set_paused(7, true));
    }
}
