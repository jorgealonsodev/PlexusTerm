//! Who is watching a share: the viewers the relay let through, numbered by the sharing side
//! (PRD-share §4.1.4: "Viewer 2 — Chrome on Android, unverified"), and the browser and system
//! read from their `User-Agent`.

use std::collections::HashMap;

use plexusterm_share_protocol::content::Access;
use plexusterm_share_protocol::keys::LinkId;
use plexusterm_share_protocol::wire::ViewerInfo;

/// A viewer as the frontend shows it; the label is worded there, in the interface language.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewer {
    /// The relay's id for this connection.
    pub viewer: u32,
    /// "Viewer <number>", counted per share from 1.
    pub number: u32,
    pub access: Access,
    /// Relay-observed IP.
    pub ip: String,
    pub browser: Option<String>,
    pub os: Option<String>,
    /// When it joined, Unix milliseconds.
    pub since: u64,
}

/// The browser and the system of a `User-Agent`, when they are recognised.
pub fn browser_of(ua: &str) -> (Option<String>, Option<String>) {
    let browser = [
        ("PlexusTerm", "PlexusTerm"),
        ("Edg", "Edge"),
        ("OPR/", "Opera"),
        ("FxiOS", "Firefox"),
        ("Firefox/", "Firefox"),
        ("CriOS", "Chrome"),
        ("Chrome/", "Chrome"),
        ("Safari/", "Safari"),
    ]
    .iter()
    .find(|(token, _)| ua.contains(token))
    .map(|(_, name)| (*name).to_string());
    let os = [
        ("Android", "Android"),
        ("iPhone", "iOS"),
        ("iPad", "iPadOS"),
        ("CrOS", "ChromeOS"),
        ("Windows", "Windows"),
        ("Mac OS X", "macOS"),
        ("Macintosh", "macOS"),
        ("Linux", "Linux"),
    ]
    .iter()
    .find(|(token, _)| ua.contains(token))
    .map(|(_, name)| (*name).to_string());
    (browser, os)
}

/// The viewers of one share, by relay id.
#[derive(Default)]
pub struct Viewers {
    /// What the relay said about each connection it let through (`join` and `ready`).
    seen: HashMap<u32, ViewerInfo>,
    /// Pending and live viewers.
    known: HashMap<u32, Viewer>,
    /// Viewers that left, to give one coming back through the same link from the same place its
    /// old number (it "does not count as a new viewer", PRD §5.4).
    gone: Vec<(LinkId, String, String, u32)>,
    count: u32,
}

impl Viewers {
    pub fn seen(&mut self, info: ViewerInfo) {
        self.seen.insert(info.viewer, info);
    }

    /// A viewer asking to join, or one coming back; numbered and remembered.
    pub fn add(&mut self, viewer: u32, access: Access, ip: &str, ua: &str, now_ms: u64) -> Viewer {
        let link = self.seen.get(&viewer).map(|info| info.link_id);
        let back = link.and_then(|link| {
            self.gone
                .iter()
                .position(|(l, i, u, _)| *l == link && i == ip && u == ua)
        });
        let number = match back {
            Some(at) => self.gone.remove(at).3,
            None => {
                self.count += 1;
                self.count
            }
        };
        let (browser, os) = browser_of(ua);
        let entry = Viewer {
            viewer,
            number,
            access,
            ip: ip.to_string(),
            browser,
            os,
            since: now_ms,
        };
        self.known.insert(viewer, entry.clone());
        entry
    }

    /// What the relay told about `viewer` (`ip`, `ua`, `link_id`).
    pub fn info(&self, viewer: u32) -> Option<&ViewerInfo> {
        self.seen.get(&viewer)
    }

    pub fn get(&self, viewer: u32) -> Option<&Viewer> {
        self.known.get(&viewer)
    }

    pub fn remove(&mut self, viewer: u32) -> Option<Viewer> {
        let info = self.seen.remove(&viewer);
        let left = self.known.remove(&viewer)?;
        if let Some(info) = info {
            self.gone
                .push((info.link_id, info.ip, info.ua, left.number));
        }
        Some(left)
    }

    /// Can type → View only: every viewer becomes View only.
    pub fn view_only(&mut self) {
        for viewer in self.known.values_mut() {
            viewer.access = Access::View;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROME_ANDROID: &str = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    const SAFARI_IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

    fn info(viewer: u32, link: u8, ip: &str, ua: &str) -> ViewerInfo {
        ViewerInfo {
            viewer,
            link_id: LinkId([link; 16]),
            ip: ip.into(),
            ua: ua.into(),
        }
    }

    #[test]
    fn reads_the_browser_and_system_of_common_user_agents() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(browser_of(CHROME_ANDROID), (s("Chrome"), s("Android")));
        assert_eq!(browser_of(SAFARI_IPHONE), (s("Safari"), s("iOS")));
        assert_eq!(
            browser_of(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"
            ),
            (s("Firefox"), s("Windows"))
        );
        assert_eq!(
            browser_of(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
            ),
            (s("Edge"), s("macOS"))
        );
        assert_eq!(browser_of("curl/8.5"), (None, None));
    }

    #[test]
    fn numbers_viewers_from_one_and_gives_a_returning_viewer_its_number() {
        let mut viewers = Viewers::default();
        viewers.seen(info(10, 1, "1.1.1.1", CHROME_ANDROID));
        viewers.seen(info(11, 1, "2.2.2.2", SAFARI_IPHONE));
        assert_eq!(
            viewers
                .add(10, Access::View, "1.1.1.1", CHROME_ANDROID, 5)
                .number,
            1
        );
        assert_eq!(
            viewers
                .add(11, Access::View, "2.2.2.2", SAFARI_IPHONE, 6)
                .number,
            2
        );
        viewers.remove(10);
        // The phone comes back through the same link: same number.
        viewers.seen(info(12, 1, "1.1.1.1", CHROME_ANDROID));
        let back = viewers.add(12, Access::View, "1.1.1.1", CHROME_ANDROID, 7);
        assert_eq!((back.number, back.since), (1, 7));
        // Someone new gets the next number.
        viewers.seen(info(13, 2, "3.3.3.3", CHROME_ANDROID));
        assert_eq!(
            viewers
                .add(13, Access::Type, "3.3.3.3", CHROME_ANDROID, 8)
                .number,
            3
        );
    }

    #[test]
    fn view_only_turns_every_viewer_to_view_only() {
        let mut viewers = Viewers::default();
        viewers.add(1, Access::Type, "1.1.1.1", "", 0);
        viewers.view_only();
        assert_eq!(viewers.get(1).unwrap().access, Access::View);
    }
}
