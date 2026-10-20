//! Staying awake while a share is live (PRD-share §5.6): the system is asked not to sleep when
//! idle, and released when the last share ends.
//!
//! - Linux: a logind `sleep:idle` inhibitor (`handle-lid-switch` too when the user opts in).
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` from a long-lived thread.
//! - macOS: `IOPMAssertionCreateWithName(kIOPMAssertPreventUserIdleSystemSleep)`.

/// Holds the system awake until dropped.
pub struct Guard(#[allow(dead_code, reason = "held for its Drop")] imp::Inner);

/// Asks the system not to sleep when idle; `lid` also blocks lid-close sleep where the system
/// lets an application do so (Linux). Fails when the system refuses (no logind, ...).
pub fn hold(lid: bool) -> Result<Guard, String> {
    imp::hold(lid).map(Guard)
}

/// The logind inhibitor `what` for the lid choice.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn logind_what(lid: bool) -> &'static str {
    if lid {
        "sleep:idle:handle-lid-switch"
    } else {
        "sleep:idle"
    }
}

/// How many shares keep the system awake, and the guard while there is one.
#[derive(Default)]
pub struct Awake {
    count: usize,
    guard: Option<Guard>,
}

impl Awake {
    /// A share started. The first one takes the guard (a failure is returned, the share goes on).
    pub fn acquire(&mut self, lid: bool) -> Result<(), String> {
        self.count += 1;
        if self.guard.is_none() {
            self.guard = Some(hold(lid)?);
        }
        Ok(())
    }

    /// A share ended; the last one releases the guard.
    pub fn release(&mut self) {
        self.count = self.count.saturating_sub(1);
        if self.count == 0 {
            self.guard = None;
        }
    }

    #[cfg(test)]
    pub fn held(&self) -> bool {
        self.guard.is_some()
    }
}

#[cfg(target_os = "linux")]
mod imp {
    pub struct Inner(
        #[allow(dead_code, reason = "closing the descriptor ends the inhibitor")]
        zbus::zvariant::OwnedFd,
    );

    pub fn hold(lid: bool) -> Result<Inner, String> {
        let connection = zbus::blocking::Connection::system().map_err(|e| e.to_string())?;
        let reply = connection
            .call_method(
                Some("org.freedesktop.login1"),
                "/org/freedesktop/login1",
                Some("org.freedesktop.login1.Manager"),
                "Inhibit",
                &(
                    super::logind_what(lid),
                    "PlexusTerm",
                    "A terminal is being shared",
                    "block",
                ),
            )
            .map_err(|e| e.to_string())?;
        let fd: zbus::zvariant::OwnedFd = reply.body().deserialize().map_err(|e| e.to_string())?;
        Ok(Inner(fd))
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::mpsc::{Sender, channel};
    use windows_sys::Win32::System::Power::{
        ES_CONTINUOUS, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
    };

    /// The execution state belongs to the thread that set it: a thread holds it until told to stop.
    pub struct Inner(Sender<()>);

    pub fn hold(_lid: bool) -> Result<Inner, String> {
        let (stop, stopped) = channel::<()>();
        let (ready, set) = channel::<bool>();
        std::thread::spawn(move || {
            // SAFETY: plain Win32 call with constant flags.
            let previous = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
            let _ = ready.send(previous != 0);
            let _ = stopped.recv();
            // SAFETY: as above; clears this thread's requirement.
            unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        });
        match set.recv() {
            Ok(true) => Ok(Inner(stop)),
            _ => Err("SetThreadExecutionState failed".into()),
        }
    }

    impl Drop for Inner {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_char, c_void};

    type CFStringRef = *const c_void;
    const UTF8: u32 = 0x0800_0100;
    const LEVEL_ON: u32 = 255;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            text: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(value: *const c_void);
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: CFStringRef,
            level: u32,
            name: CFStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    pub struct Inner(u32);

    fn cf(text: &std::ffi::CStr) -> CFStringRef {
        // SAFETY: `text` is a valid NUL-terminated string; a null allocator means the default one.
        unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8) }
    }

    pub fn hold(_lid: bool) -> Result<Inner, String> {
        let kind = cf(c"PreventUserIdleSystemSleep");
        let name = cf(c"PlexusTerm: a terminal is being shared");
        if kind.is_null() || name.is_null() {
            return Err("CFStringCreateWithCString failed".into());
        }
        let mut id = 0u32;
        // SAFETY: both strings are live CFStrings and `id` is a valid out pointer.
        let status = unsafe { IOPMAssertionCreateWithName(kind, LEVEL_ON, name, &mut id) };
        // SAFETY: we own one reference to each string.
        unsafe {
            CFRelease(kind);
            CFRelease(name);
        }
        if status == 0 {
            Ok(Inner(id))
        } else {
            Err(format!("IOPMAssertionCreateWithName failed ({status})"))
        }
    }

    impl Drop for Inner {
        fn drop(&mut self) {
            // SAFETY: `self.0` is an assertion this process created and has not released.
            unsafe { IOPMAssertionRelease(self.0) };
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
mod imp {
    pub struct Inner;

    pub fn hold(_lid: bool) -> Result<Inner, String> {
        Err("staying awake is not supported on this system".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_lid_switch_is_inhibited_only_when_asked() {
        assert_eq!(logind_what(false), "sleep:idle");
        assert_eq!(logind_what(true), "sleep:idle:handle-lid-switch");
    }

    #[test]
    fn releasing_a_share_that_never_held_the_system_does_not_underflow() {
        let mut awake = Awake::default();
        awake.release();
        assert!(!awake.held());
    }
}
