//! An eyedropper: picks the colour of any point of the screen. On Linux the desktop portal does it
//! (`org.freedesktop.portal.Screenshot.PickColor`: GNOME and KDE show their own picker); Windows
//! uses the webview's EyeDropper instead, so this command is Linux only.

/// A colour of the portal, `(red, green, blue)` from 0 to 1, as `#rrggbb`.
pub fn hex_of(red: f64, green: f64, blue: f64) -> String {
    let channel = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        channel(red),
        channel(green),
        channel(blue)
    )
}

/// Asks the desktop portal for a colour of the screen: `None` when the user cancels.
#[cfg(target_os = "linux")]
pub fn pick() -> Result<Option<String>, String> {
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use zbus::blocking::{Connection, MessageIterator};
    use zbus::zvariant::{OwnedValue, Value};

    static SEQ: AtomicU32 = AtomicU32::new(0);
    let failed = |err: zbus::Error| format!("cannot pick a colour from the screen: {err}");
    let conn = Connection::session().map_err(failed)?;
    // The portal answers on a request object named after our connection and this token; listen
    // to it before asking, so the answer cannot be missed.
    let token = format!(
        "plexusterm{}_{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let sender = conn
        .unique_name()
        .ok_or("cannot pick a colour from the screen: no D-Bus name")?
        .trim_start_matches(':')
        .replace('.', "_");
    let request = format!("/org/freedesktop/portal/desktop/request/{sender}/{token}");
    let rule = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.freedesktop.portal.Request")
        .and_then(|b| b.member("Response"))
        .and_then(|b| b.path(request.as_str()))
        .map_err(failed)?
        .build();
    let mut answers = MessageIterator::for_match_rule(rule, &conn, Some(1)).map_err(failed)?;
    let mut options: HashMap<&str, Value> = HashMap::new();
    options.insert("handle_token", Value::from(token.as_str()));
    conn.call_method(
        Some("org.freedesktop.portal.Desktop"),
        "/org/freedesktop/portal/desktop",
        Some("org.freedesktop.portal.Screenshot"),
        "PickColor",
        &("", options),
    )
    .map_err(failed)?;
    let answer = answers
        .next()
        .ok_or("cannot pick a colour from the screen: the portal did not answer")?
        .map_err(failed)?;
    let (response, results): (u32, HashMap<String, OwnedValue>) =
        answer.body().deserialize().map_err(failed)?;
    // 1: cancelled by the user; 2: ended another way.
    if response != 0 {
        return Ok(None);
    }
    let color = results
        .get("color")
        .ok_or("cannot pick a colour from the screen: the portal sent no colour")?;
    let (red, green, blue): (f64, f64, f64) = color
        .try_clone()
        .map_err(|err| failed(err.into()))?
        .try_into()
        .map_err(|err: zbus::zvariant::Error| failed(err.into()))?;
    Ok(Some(hex_of(red, green, blue)))
}

#[cfg(not(target_os = "linux"))]
pub fn pick() -> Result<Option<String>, String> {
    Err("picking a colour from the screen is not available here".into())
}

/// Picks a colour from the screen (Linux): `#rrggbb`, or null when cancelled.
#[tauri::command]
pub async fn screen_color_pick() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(pick)
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_the_portal_colour_into_a_hex_code() {
        assert_eq!(hex_of(1.0, 0.5, 0.0), "#ff8000");
        assert_eq!(hex_of(0.0, 0.0, 0.0), "#000000");
        // Out of range values are clamped.
        assert_eq!(hex_of(1.2, -0.1, 0.18), "#ff002e");
    }
}
