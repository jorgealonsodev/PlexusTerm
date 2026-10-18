//! An eyedropper: picks the colour of any point of the screen. On Linux, in an X11 session (any
//! desktop: XFCE, MATE, Cinnamon...) it grabs the pointer with a crosshair and reads the clicked
//! pixel, as gpick does; on Wayland the desktop portal does it
//! (`org.freedesktop.portal.Screenshot.PickColor`, GNOME and KDE). Windows uses the webview's
//! EyeDropper instead, so this command is Linux only.

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

/// One pixel of an X11 image (`bytes`, in the server's byte order) as `#rrggbb`, its channels
/// read with the visual's `(red, green, blue)` masks and scaled to 8 bits.
pub fn pixel_hex(
    bytes: &[u8],
    (red, green, blue): (u32, u32, u32),
    big_endian: bool,
) -> Option<String> {
    if bytes.is_empty() || bytes.len() > 4 {
        return None;
    }
    let value = bytes.iter().enumerate().fold(0u32, |value, (i, &byte)| {
        let shift = if big_endian {
            8 * (bytes.len() - 1 - i)
        } else {
            8 * i
        };
        value | (u32::from(byte) << shift)
    });
    let channel = |mask: u32| {
        if mask == 0 {
            return 0;
        }
        let max = mask >> mask.trailing_zeros();
        let level = (value & mask) >> mask.trailing_zeros();
        ((level * 255 + max / 2) / max) as u8
    };
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(red),
        channel(green),
        channel(blue)
    ))
}

/// Picks a colour of the screen: `None` when the user cancels (Escape, another button or key).
#[cfg(target_os = "linux")]
pub fn pick() -> Result<Option<String>, String> {
    let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|t| t == "wayland")
        || std::env::var_os("WAYLAND_DISPLAY").is_some();
    if !wayland && std::env::var_os("DISPLAY").is_some() {
        return x11_pick();
    }
    portal_pick()
}

/// The X11 eyedropper: a crosshair over the whole screen until a click; the pixel under it.
#[cfg(target_os = "linux")]
fn x11_pick() -> Result<Option<String>, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::Event;
    use x11rb::protocol::xproto::{
        ConnectionExt, EventMask, GrabMode, GrabStatus, ImageFormat, ImageOrder,
    };

    let failed =
        |err: &dyn std::fmt::Display| format!("cannot pick a colour from the screen: {err}");
    let (conn, screen_num) = x11rb::connect(None).map_err(|e| failed(&e))?;
    let setup = conn.setup();
    let screen = &setup.roots[screen_num];
    let root = screen.root;
    // The crosshair of the X cursor font.
    const CROSSHAIR: u16 = 34;
    let font = conn.generate_id().map_err(|e| failed(&e))?;
    conn.open_font(font, b"cursor").map_err(|e| failed(&e))?;
    let cursor = conn.generate_id().map_err(|e| failed(&e))?;
    conn.create_glyph_cursor(
        cursor,
        font,
        font,
        CROSSHAIR,
        CROSSHAIR + 1,
        0,
        0,
        0,
        0xffff,
        0xffff,
        0xffff,
    )
    .map_err(|e| failed(&e))?;
    let grab = conn
        .grab_pointer(
            false,
            root,
            EventMask::BUTTON_PRESS,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
            x11rb::NONE,
            cursor,
            x11rb::CURRENT_TIME,
        )
        .map_err(|e| failed(&e))?
        .reply()
        .map_err(|e| failed(&e))?;
    if grab.status != GrabStatus::SUCCESS {
        return Err(failed(&"another program is holding the pointer"));
    }
    // Keys cancel; without the keyboard (another program holds it) a click still picks.
    let _ = conn
        .grab_keyboard(
            false,
            root,
            x11rb::CURRENT_TIME,
            GrabMode::ASYNC,
            GrabMode::ASYNC,
        )
        .map(|cookie| cookie.reply());
    let clicked = loop {
        match conn.wait_for_event() {
            Ok(Event::ButtonPress(press)) => {
                break Ok((press.detail == 1).then_some((press.root_x, press.root_y)));
            }
            Ok(Event::KeyPress(_)) => break Ok(None),
            Ok(_) => continue,
            Err(err) => break Err(failed(&err)),
        }
    };
    let _ = conn.ungrab_pointer(x11rb::CURRENT_TIME);
    let _ = conn.ungrab_keyboard(x11rb::CURRENT_TIME);
    let _ = conn.free_cursor(cursor);
    let _ = conn.close_font(font);
    let _ = conn.flush();
    let Some((x, y)) = clicked? else {
        return Ok(None);
    };
    let image = conn
        .get_image(ImageFormat::Z_PIXMAP, root, x, y, 1, 1, !0)
        .map_err(|e| failed(&e))?
        .reply()
        .map_err(|e| failed(&e))?;
    let visual = screen
        .allowed_depths
        .iter()
        .flat_map(|depth| &depth.visuals)
        .find(|visual| visual.visual_id == screen.root_visual)
        .ok_or_else(|| failed(&"unknown screen visual"))?;
    let bits = setup
        .pixmap_formats
        .iter()
        .find(|format| format.depth == image.depth)
        .map_or(32, |format| format.bits_per_pixel);
    let bytes = &image.data[..(usize::from(bits) / 8).min(image.data.len())];
    let big_endian = setup.image_byte_order == ImageOrder::MSB_FIRST;
    pixel_hex(
        bytes,
        (visual.red_mask, visual.green_mask, visual.blue_mask),
        big_endian,
    )
    .map(Some)
    .ok_or_else(|| failed(&"unreadable pixel"))
}

/// Asks the desktop portal for a colour of the screen (Wayland): `None` when the user cancels.
#[cfg(target_os = "linux")]
fn portal_pick() -> Result<Option<String>, String> {
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
    fn reads_a_pixel_with_the_screen_visual_masks() {
        // A 24-bit TrueColor visual stored as BGRX, little-endian: the usual X11 screen.
        let masks = (0x00ff_0000, 0x0000_ff00, 0x0000_00ff);
        assert_eq!(
            pixel_hex(&[0x56, 0x34, 0x12, 0x00], masks, false),
            Some("#123456".into())
        );
        // Big-endian byte order.
        assert_eq!(
            pixel_hex(&[0x00, 0x12, 0x34, 0x56], masks, true),
            Some("#123456".into())
        );
        // A 16-bit visual (RGB 565) scales each channel to 8 bits.
        assert_eq!(
            pixel_hex(&[0x1f, 0xf8], (0xf800, 0x07e0, 0x001f), false),
            Some("#ff00ff".into())
        );
        assert_eq!(pixel_hex(&[], masks, false), None);
    }

    #[test]
    fn turns_the_portal_colour_into_a_hex_code() {
        assert_eq!(hex_of(1.0, 0.5, 0.0), "#ff8000");
        assert_eq!(hex_of(0.0, 0.0, 0.0), "#000000");
        // Out of range values are clamped.
        assert_eq!(hex_of(1.2, -0.1, 0.18), "#ff002e");
    }
}
