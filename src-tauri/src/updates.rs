//! Checking GitHub for a newer PlexusTerm release. Installation is isolated in `install`;
//! the existing release-check API also serves the manual release-page action.

pub mod install;

use std::time::Duration;

/// The latest published release of PlexusTerm (drafts and pre-releases are never returned).
pub const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/jorgealonsodev/PlexusTerm/releases/latest";

/// A release newer than the running version.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Release {
    pub version: String,
    pub notes: String,
    /// The release page, where every package can be downloaded.
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: Option<Release>,
}

/// `X.Y.Z` (an optional leading `v`; a `-pre` or `+build` suffix is ignored).
fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.strip_prefix('v').unwrap_or(text);
    let core = text.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(version)
}

/// The fields of GitHub's release JSON that matter here.
#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// The release described by GitHub's `releases/latest` JSON when it is newer than `current`.
pub fn newer_release(current: &str, json: &str) -> Result<Option<Release>, String> {
    let release: GithubRelease = serde_json::from_str(json)
        .map_err(|err| format!("unexpected answer from GitHub: {err}"))?;
    let latest = parse_version(&release.tag_name)
        .ok_or_else(|| format!("unexpected release tag {:?}", release.tag_name))?;
    let running =
        parse_version(current).ok_or_else(|| format!("unexpected running version {current:?}"))?;
    if release.draft || release.prerelease || latest <= running {
        return Ok(None);
    }
    Ok(Some(Release {
        version: format!("{}.{}.{}", latest.0, latest.1, latest.2),
        notes: release.body.unwrap_or_default(),
        url: release.html_url,
    }))
}

pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(crate::ai::USER_AGENT)
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
}

/// Asks `url` (GitHub's latest release) whether a release newer than `current` exists.
pub async fn check_at(
    client: &reqwest::Client,
    url: &str,
    current: &str,
) -> Result<UpdateCheck, String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|err| format!("cannot reach GitHub: {err}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("cannot read GitHub's answer: {err}"))?;
    if !status.is_success() {
        return Err(format!("GitHub answered {status}"));
    }
    Ok(UpdateCheck {
        current: current.into(),
        latest: newer_release(current, &body)?,
    })
}

/// Checks the latest published release against this build.
pub async fn check() -> Result<UpdateCheck, String> {
    let client = http_client().map_err(|err| err.to_string())?;
    check_at(&client, LATEST_RELEASE_URL, env!("CARGO_PKG_VERSION")).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn release(tag: &str) -> String {
        serde_json::json!({
            "tag_name": tag,
            "html_url": format!("https://github.com/jorgealonsodev/PlexusTerm/releases/tag/{tag}"),
            "body": "Fixes.",
            "draft": false,
            "prerelease": false,
        })
        .to_string()
    }

    #[test]
    fn versions_are_read_with_or_without_v_and_suffixes() {
        assert_eq!(parse_version("v0.1.12"), Some((0, 1, 12)));
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v2.0.0-rc.1"), Some((2, 0, 0)));
        assert_eq!(parse_version("1.2.3+build"), Some((1, 2, 3)));
        for bad in ["", "v", "1.2", "1.2.3.4", "a.b.c", "latest"] {
            assert_eq!(parse_version(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_a_newer_release_is_returned() {
        assert_eq!(
            newer_release("0.1.2", &release("v0.1.10")),
            Ok(Some(Release {
                version: "0.1.10".into(),
                notes: "Fixes.".into(),
                url: "https://github.com/jorgealonsodev/PlexusTerm/releases/tag/v0.1.10".into(),
            }))
        );
        assert_eq!(newer_release("0.1.2", &release("v0.1.2")), Ok(None));
        assert_eq!(newer_release("0.2.0", &release("v0.1.9")), Ok(None));
    }

    #[test]
    fn drafts_pre_releases_and_bad_answers_are_never_updates() {
        let mut draft: serde_json::Value = serde_json::from_str(&release("v9.0.0")).unwrap();
        draft["draft"] = true.into();
        assert_eq!(newer_release("0.1.2", &draft.to_string()), Ok(None));
        let mut pre: serde_json::Value = serde_json::from_str(&release("v9.0.0")).unwrap();
        pre["prerelease"] = true.into();
        assert_eq!(newer_release("0.1.2", &pre.to_string()), Ok(None));
        assert!(newer_release("0.1.2", "not json").is_err());
        assert!(newer_release("0.1.2", r#"{"tag_name":"nightly","html_url":"x"}"#).is_err());
        assert!(newer_release("0.1.2", r#"{"message":"Not Found"}"#).is_err());
    }

    /// Serves one HTTP response and returns the request line and headers it got.
    async fn serve_once(
        status: &'static str,
        body: String,
    ) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/releases/latest", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = socket.read(&mut buf).await.unwrap();
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (url, task)
    }

    #[tokio::test]
    async fn the_check_asks_github_for_json_and_reports_the_newer_release() {
        let (url, server) = serve_once("200 OK", release("v0.2.0")).await;
        let check = check_at(&http_client().unwrap(), &url, "0.1.2")
            .await
            .unwrap();
        assert_eq!(check.current, "0.1.2");
        assert_eq!(check.latest.map(|r| r.version), Some("0.2.0".into()));
        let request = server.await.unwrap().to_lowercase();
        assert!(
            request.contains("accept: application/vnd.github+json"),
            "{request}"
        );
        assert!(request.contains("user-agent: plexusterm/"), "{request}");
    }

    #[tokio::test]
    async fn a_failed_check_is_an_error_message() {
        let (url, _server) = serve_once("404 Not Found", r#"{"message":"Not Found"}"#.into()).await;
        let err = check_at(&http_client().unwrap(), &url, "0.1.2")
            .await
            .unwrap_err();
        assert!(err.contains("404"), "{err}");
    }
}
