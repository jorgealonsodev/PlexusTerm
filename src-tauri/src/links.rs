//! Web links open in the system's browser: the app's own window never navigates away from it.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Runtime, Url};

/// True for a web page outside the app: the app itself is served from `tauri://localhost`,
/// `http(s)://tauri.localhost` (Windows) or `http://localhost:1420` while developing.
pub fn opens_outside(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && !matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "127.0.0.1" | "[::1]"))
}

/// Cancels the window's navigation to an outside page and opens it in the browser instead.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("external-links")
        .on_navigation(|_, url| {
            if !opens_outside(url) {
                return true;
            }
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outside(url: &str) -> bool {
        opens_outside(&Url::parse(url).unwrap())
    }

    #[test]
    fn web_pages_open_in_the_browser() {
        assert!(outside("https://github.com/jorgealonsodev/plexusterm-relay"));
        assert!(outside("http://example.com/page"));
    }

    #[test]
    fn the_app_itself_stays_in_the_window() {
        assert!(!outside("tauri://localhost/index.html"));
        assert!(!outside("http://tauri.localhost/"));
        assert!(!outside("https://tauri.localhost/"));
        assert!(!outside("http://localhost:1420/"));
        assert!(!outside("http://127.0.0.1:1420/"));
        assert!(!outside("about:blank"));
        assert!(!outside("data:text/html,hi"));
    }
}
