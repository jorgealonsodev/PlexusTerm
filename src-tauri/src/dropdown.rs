//! The drop-down window (Settings → General): a system-wide shortcut that brings the main window
//! down from the top of the monitor under the pointer, at full width and a chosen height, and
//! hides it again. Off ("" shortcut) by default; nothing moves or resizes until it is used.

use std::str::FromStr;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcut, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

/// Smallest and largest drop-down height, in percent of the monitor's height.
pub const MIN_HEIGHT_PERCENT: u8 = 20;
pub const MAX_HEIGHT_PERCENT: u8 = 100;
const DEFAULT_HEIGHT_PERCENT: u8 = 50;

/// Why a drop-down shortcut could not be set, as the frontend reads it (`{kind, detail}`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum DropDownError {
    /// Not a combination PlexusTerm can turn into a global shortcut.
    Invalid(String),
    /// A Wayland session: applications cannot grab keys for the whole desktop.
    Wayland,
    /// The system refused it (most often another application already uses it).
    Register(String),
}

/// A screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// The key of a shortcut written as Settings captures it (`KeyboardEvent.key`, upper-cased when it
/// is one character): the physical key, so Shift+1 ("!") is the 1 key.
fn code_of(key: &str) -> Option<Code> {
    let mut chars = key.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        let named = match c {
            'A'..='Z' => format!("Key{c}"),
            '0'..='9' => format!("Digit{c}"),
            _ => {
                let code = match c {
                    '`' | '~' => Code::Backquote,
                    '-' | '_' => Code::Minus,
                    '=' | '+' => Code::Equal,
                    '[' | '{' => Code::BracketLeft,
                    ']' | '}' => Code::BracketRight,
                    '\\' | '|' => Code::Backslash,
                    ';' | ':' => Code::Semicolon,
                    '\'' | '"' => Code::Quote,
                    ',' | '<' => Code::Comma,
                    '.' | '>' => Code::Period,
                    '/' | '?' => Code::Slash,
                    '!' => Code::Digit1,
                    '@' => Code::Digit2,
                    '#' => Code::Digit3,
                    '$' => Code::Digit4,
                    '%' => Code::Digit5,
                    '^' => Code::Digit6,
                    '&' => Code::Digit7,
                    '*' => Code::Digit8,
                    '(' => Code::Digit9,
                    ')' => Code::Digit0,
                    _ => return None,
                };
                return Some(code);
            }
        };
        return Code::from_str(&named).ok();
    }
    const NAMED: [&str; 15] = [
        "Space",
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
    ];
    let function_key = key
        .strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n) && !key.starts_with("F0"));
    if NAMED.contains(&key) || function_key {
        Code::from_str(key).ok()
    } else {
        None
    }
}

/// The global shortcut for one written in the app's notation ("Ctrl+Alt+Shift+Meta+K", as Settings
/// captures it), `None` for "" (off). Like Settings, it needs Ctrl, Alt or Meta.
pub fn parse_shortcut(shortcut: &str) -> Result<Option<Shortcut>, DropDownError> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Ok(None);
    }
    let invalid = || DropDownError::Invalid(shortcut.to_string());
    let (mods, key) = match shortcut.strip_suffix("++") {
        Some(mods) => (mods, "+"),
        None => shortcut.rsplit_once('+').ok_or_else(invalid)?,
    };
    let code = code_of(key).ok_or_else(invalid)?;
    let mut modifiers = Modifiers::empty();
    for name in mods.split('+') {
        let modifier = match name {
            "Ctrl" => Modifiers::CONTROL,
            "Alt" => Modifiers::ALT,
            "Shift" => Modifiers::SHIFT,
            "Meta" => Modifiers::SUPER,
            _ => return Err(invalid()),
        };
        if modifiers.contains(modifier) {
            return Err(invalid());
        }
        modifiers |= modifier;
    }
    if !modifiers.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER) {
        return Err(invalid());
    }
    Ok(Some(Shortcut::new(Some(modifiers), code)))
}

/// Where the drop-down window goes on a monitor whose usable area is `area`: its top edge, full
/// width, `height_percent` (clamped to the bounds above) of its height.
pub fn drop_down_rect(area: Rect, height_percent: u8) -> Rect {
    let percent = u64::from(height_percent.clamp(MIN_HEIGHT_PERCENT, MAX_HEIGHT_PERCENT));
    // At most u32::MAX * 100 / 100: always fits back in a u32.
    let height = u32::try_from(u64::from(area.height) * percent / 100).unwrap_or(area.height);
    Rect { height, ..area }
}

struct Current {
    shortcut: Option<Shortcut>,
    height: u8,
}

/// The registered drop-down shortcut and the height it opens the window at.
pub struct DropDown(Mutex<Current>);

impl Default for DropDown {
    fn default() -> Self {
        Self(Mutex::new(Current {
            shortcut: None,
            height: DEFAULT_HEIGHT_PERCENT,
        }))
    }
}

impl DropDown {
    fn height(&self) -> u8 {
        self.0.lock().map_or(DEFAULT_HEIGHT_PERCENT, |c| c.height)
    }
}

/// Applications cannot grab keys for the whole desktop in a Wayland session.
fn wayland_session() -> bool {
    std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t == "wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

/// Loads the global-shortcut plugin the first time a shortcut is set (on the main thread, where the
/// system hotkey manager must be created), so an unused drop-down costs nothing.
async fn ensure_plugin(app: &AppHandle) -> Result<(), DropDownError> {
    if app.try_state::<GlobalShortcut<tauri::Wry>>().is_some() {
        return Ok(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let loaded = if handle.try_state::<GlobalShortcut<tauri::Wry>>().is_some() {
            Ok(())
        } else {
            handle.plugin(tauri_plugin_global_shortcut::Builder::new().build())
        };
        let _ = tx.send(loaded.map_err(|e| e.to_string()));
    })
    .map_err(|e| DropDownError::Register(e.to_string()))?;
    rx.await
        .map_err(|e| DropDownError::Register(e.to_string()))?
        .map_err(DropDownError::Register)
}

/// Sets the drop-down shortcut (Settings → General; "" turns it off) and its height in percent.
/// The previous shortcut is released first; an invalid one leaves it as it was.
#[tauri::command]
pub async fn dropdown_set(
    app: AppHandle,
    state: tauri::State<'_, DropDown>,
    shortcut: String,
    height: u8,
) -> Result<(), DropDownError> {
    let next = parse_shortcut(&shortcut)?;
    let previous = {
        let mut current = state
            .0
            .lock()
            .map_err(|e| DropDownError::Register(e.to_string()))?;
        current.height = height.clamp(MIN_HEIGHT_PERCENT, MAX_HEIGHT_PERCENT);
        if current.shortcut == next {
            return Ok(());
        }
        current.shortcut.take()
    };
    if let Some(previous) = previous
        && app.try_state::<GlobalShortcut<tauri::Wry>>().is_some()
    {
        let _ = app.global_shortcut().unregister(previous);
    }
    let Some(next) = next else { return Ok(()) };
    if wayland_session() {
        return Err(DropDownError::Wayland);
    }
    ensure_plugin(&app).await?;
    app.global_shortcut()
        .on_shortcut(next, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .map_err(|e| DropDownError::Register(e.to_string()))?;
    if let Ok(mut current) = state.0.lock() {
        current.shortcut = Some(next);
    }
    crate::diaglog::info(&format!("drop-down shortcut set: {shortcut}"));
    Ok(())
}

/// The usable area of the monitor under the pointer, or of the window's or the primary one.
fn monitor_area(app: &AppHandle, window: &WebviewWindow) -> Option<Rect> {
    let under_pointer = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    let monitor = under_pointer
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some(Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    })
}

/// The shortcut was pressed: hides the window when it is in front, else brings it down.
fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let in_front = window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false);
    if in_front {
        let _ = window.hide();
        return;
    }
    let _ = window.show();
    let _ = window.unminimize();
    if let Some(area) = monitor_area(app, &window) {
        let place = drop_down_rect(area, app.state::<DropDown>().height());
        let _ = window.unmaximize();
        let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
        let _ = window.set_size(PhysicalSize::new(place.width, place.height));
    }
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcut(mods: Modifiers, code: Code) -> Option<Shortcut> {
        Some(Shortcut::new(Some(mods), code))
    }

    #[test]
    fn an_empty_shortcut_is_off() {
        assert_eq!(parse_shortcut(""), Ok(None));
        assert_eq!(parse_shortcut("  "), Ok(None));
    }

    #[test]
    fn converts_the_app_notation_to_a_global_shortcut() {
        assert_eq!(
            parse_shortcut("Ctrl+Alt+K"),
            Ok(shortcut(Modifiers::CONTROL | Modifiers::ALT, Code::KeyK))
        );
        assert_eq!(
            parse_shortcut("Ctrl+Shift+Space"),
            Ok(shortcut(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space))
        );
        assert_eq!(
            parse_shortcut("Meta+F12"),
            Ok(shortcut(Modifiers::SUPER, Code::F12))
        );
        assert_eq!(
            parse_shortcut("Alt+1"),
            Ok(shortcut(Modifiers::ALT, Code::Digit1))
        );
        assert_eq!(
            parse_shortcut("Ctrl+`"),
            Ok(shortcut(Modifiers::CONTROL, Code::Backquote))
        );
        assert_eq!(
            parse_shortcut("Ctrl+ArrowDown"),
            Ok(shortcut(Modifiers::CONTROL, Code::ArrowDown))
        );
        assert_eq!(
            parse_shortcut("Ctrl++"),
            Ok(shortcut(Modifiers::CONTROL, Code::Equal))
        );
        // Shift+key gives the shifted character (Shift+1 is "!"): the same physical key.
        assert_eq!(
            parse_shortcut("Ctrl+Shift+!"),
            Ok(shortcut(
                Modifiers::CONTROL | Modifiers::SHIFT,
                Code::Digit1
            ))
        );
    }

    #[test]
    fn refuses_what_is_not_a_global_shortcut() {
        for bad in [
            "K",
            "Shift+K",
            "Ctrl+",
            "Ctrl+Alt",
            "Ctrl+Hyper+K",
            "Ctrl+Ctrl+K",
            "Ctrl+ñ",
            "Ctrl+Unknown",
        ] {
            assert!(
                matches!(parse_shortcut(bad), Err(DropDownError::Invalid(_))),
                "{bad} should be refused"
            );
        }
    }

    const AREA: Rect = Rect {
        x: 1920,
        y: 32,
        width: 2560,
        height: 1408,
    };

    #[test]
    fn places_the_window_at_the_top_at_full_width() {
        assert_eq!(
            drop_down_rect(AREA, 50),
            Rect {
                x: 1920,
                y: 32,
                width: 2560,
                height: 704
            }
        );
        assert_eq!(drop_down_rect(AREA, 100), AREA);
    }

    #[test]
    fn keeps_the_height_within_bounds() {
        assert_eq!(drop_down_rect(AREA, 0).height, 281); // 20 %
        assert_eq!(drop_down_rect(AREA, 5).height, 281);
        assert_eq!(drop_down_rect(AREA, 255).height, AREA.height);
        let huge = Rect {
            x: -10,
            y: -20,
            width: u32::MAX,
            height: u32::MAX,
        };
        assert_eq!(drop_down_rect(huge, 100), huge);
        assert_eq!(drop_down_rect(huge, 50).height, u32::MAX / 2);
    }
}
