//! Verified updates; no URL, file path or executable comes from the webview.
mod native;

use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const MAX_PACKAGE: u64 = 512 * 1024 * 1024;
const MAX_METADATA: u64 = 2 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Deb,
    Rpm,
    Tar,
    AppImage,
    Msi,
    Nsis,
}

#[derive(Clone, Debug)]
struct Installation {
    format: Format,
    target: PathBuf,
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Installed,
    InstallerOpened,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Progress {
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
}
type Report<'a> = &'a (dyn Fn(Progress) -> Result<(), String> + Send + Sync);
fn phase(report: Report<'_>, name: &'static str) -> Result<(), String> {
    report(Progress {
        phase: name,
        downloaded: None,
        total: None,
    })
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn private_dir() -> Result<tempfile::TempDir, String> {
    let mut builder = tempfile::Builder::new();
    builder.prefix("plexusterm-update-");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(std::fs::Permissions::from_mode(0o700));
    }
    builder.tempdir().map_err(error)
}

fn asset_name(format: Format, arch: &str, version: &str) -> Result<String, String> {
    if super::parse_version(version).map(|(a, b, c)| format!("{a}.{b}.{c}")) != Some(version.into())
    {
        return Err("Invalid update version".into());
    }
    let deb_arch = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => return Err("Unsupported update architecture".into()),
    };
    let suffix = match format {
        Format::Deb => format!("linux_{deb_arch}.deb"),
        Format::Rpm => format!("linux_{arch}.rpm"),
        Format::Tar => format!("linux_{deb_arch}.tar.gz"),
        Format::AppImage => format!("linux_{deb_arch}.AppImage"),
        Format::Msi if arch == "x86_64" => "windows_x86_64.msi".into(),
        Format::Nsis if arch == "x86_64" => "windows_x86_64-setup.exe".into(),
        _ => return Err("Unsupported Windows update architecture".into()),
    };
    Ok(format!("plexusterm_{version}_{suffix}"))
}
fn trusted_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "api.github.com"
                        | "github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            )
    })
}
fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(crate::ai::USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !trusted_url(attempt.url().as_str()) {
                attempt.error("Untrusted update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(error)
}
fn checksum(text: &str, name: &str) -> Result<String, String> {
    let entries: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let (hash, file) = line.split_once("  ")?;
            (file == name).then_some(hash)
        })
        .collect();
    match entries.as_slice() {
        [hash] if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Ok(hash.to_ascii_lowercase())
        }
        _ => Err(format!("Missing, invalid or duplicate checksum for {name}")),
    }
}
struct Flight<'a>(&'a AtomicBool);
impl<'a> Flight<'a> {
    fn acquire(busy: &'a AtomicBool) -> Result<Self, String> {
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self(busy))
            .map_err(|_| "An update is already in progress".into())
    }
}
impl Drop for Flight<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(serde::Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}
#[derive(serde::Deserialize)]
struct Assets {
    tag_name: String,
    assets: Vec<Asset>,
}
fn select_asset<'a>(assets: &'a [Asset], name: &str, max: u64) -> Result<&'a Asset, String> {
    let matches: Vec<_> = assets.iter().filter(|a| a.name == name).collect();
    match matches.as_slice() {
        [asset]
            if asset.size > 0
                && asset.size <= max
                && official_asset_url(&asset.browser_download_url, name) =>
        {
            Ok(asset)
        }
        _ => Err(format!(
            "Missing, ambiguous or unsafe official asset: {name}"
        )),
    }
}

fn official_asset_url(url: &str, name: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(url) else {
        return false;
    };
    let parts: Vec<_> = url.path_segments().into_iter().flatten().collect();
    trusted_url(url.as_str())
        && url.host_str() == Some("github.com")
        && url.query().is_none()
        && url.fragment().is_none()
        && matches!(parts.as_slice(), ["jorgealonsodev", "PlexusTerm", "releases", "download", tag, file] if !tag.is_empty() && *file == name)
}
fn same_release(asset: &Asset, tag: &str) -> Result<(), String> {
    let mut expected =
        reqwest::Url::parse("https://github.com/jorgealonsodev/PlexusTerm/releases/download/")
            .map_err(error)?;
    expected
        .path_segments_mut()
        .map_err(|_| "Invalid release URL")?
        .pop_if_empty()
        .push(tag)
        .push(&asset.name);
    if asset.browser_download_url != expected.as_str() {
        return Err("Asset does not belong to the selected release".into());
    }
    Ok(())
}

/// Streams bounded responses to a private file (or a small metadata buffer).
async fn fetch(
    client: &reqwest::Client,
    url: &str,
    max: u64,
    expected: Option<u64>,
    file: Option<&mut std::fs::File>,
    report: Option<Report<'_>>,
) -> Result<Vec<u8>, String> {
    if !trusted_url(url) {
        return Err("Untrusted update URL".into());
    }
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(error)?
        .error_for_status()
        .map_err(error)?;
    if !response.status().is_success() {
        return Err(format!("Update server answered {}", response.status()));
    }
    consume(response, max, expected, file, report).await
}
async fn consume(
    mut response: reqwest::Response,
    max: u64,
    expected: Option<u64>,
    mut file: Option<&mut std::fs::File>,
    report: Option<Report<'_>>,
) -> Result<Vec<u8>, String> {
    let total = response.content_length();
    if total.is_some_and(|n| n > max || expected.is_some_and(|e| e != n)) {
        return Err("Invalid update response size".into());
    }
    let mut downloaded = 0u64;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(error)? {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or("Update too large")?;
        if downloaded > max {
            return Err("Update too large".into());
        }
        if let Some(file) = file.as_deref_mut() {
            file.write_all(&chunk).map_err(error)?;
        } else {
            bytes.extend_from_slice(&chunk);
        }
        if let Some(report) = report {
            report(Progress {
                phase: "downloading",
                downloaded: Some(downloaded),
                total: expected.or(total),
            })?;
        }
    }
    if expected.is_some_and(|e| e != downloaded) {
        return Err("Incomplete update download".into());
    }
    Ok(bytes)
}
fn verify(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = std::fs::File::open(path).map_err(error)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(error)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    if hash
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        != expected
    {
        return Err("Update checksum mismatch; nothing was installed".into());
    }
    Ok(())
}

fn verified_apply(
    package: &Path,
    expected: &str,
    report: Report<'_>,
    apply: impl FnOnce() -> Result<Outcome, String>,
) -> Result<Outcome, String> {
    phase(report, "verifying")?;
    verify(package, expected)?;
    phase(report, "installing")?;
    apply()
}

/// The guard covers download AND native installer lifetime, and resets when the future is dropped.
pub async fn install(
    report: impl Fn(Progress) -> Result<(), String> + Send + Sync + 'static,
) -> Result<Outcome, String> {
    let guard = Flight::acquire(&BUSY)?;
    phase(&report, "checking")?;
    let installation = native::detect()?;
    let metadata_client = client(Duration::from_secs(15))?;
    let json = fetch(
        &metadata_client,
        super::LATEST_RELEASE_URL,
        MAX_METADATA,
        None,
        None,
        None,
    )
    .await?;
    let json = std::str::from_utf8(&json).map_err(error)?;
    let release = super::newer_release(env!("CARGO_PKG_VERSION"), json)?
        .ok_or("No newer release is available")?;
    let assets: Assets = serde_json::from_str(json).map_err(error)?;
    let name = asset_name(
        installation.format,
        std::env::consts::ARCH,
        &release.version,
    )?;
    let package = select_asset(&assets.assets, &name, MAX_PACKAGE)?;
    let sums = select_asset(&assets.assets, "checksums.txt", MAX_METADATA)?;
    same_release(package, &assets.tag_name)?;
    same_release(sums, &assets.tag_name)?;
    let checksums = fetch(
        &metadata_client,
        &sums.browser_download_url,
        MAX_METADATA,
        Some(sums.size),
        None,
        None,
    )
    .await?;
    let expected = checksum(std::str::from_utf8(&checksums).map_err(error)?, &name)?;
    let dir = private_dir()?;
    let path = dir.path().join(&name);
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(error)?;
    phase(&report, "downloading")?;
    let download_client = client(Duration::from_secs(600))?;
    fetch(
        &download_client,
        &package.browser_download_url,
        MAX_PACKAGE,
        Some(package.size),
        Some(&mut file),
        Some(&report),
    )
    .await?;
    file.sync_all().map_err(error)?;
    drop(file);
    // The blocking task owns both resources: cancelling IPC cannot delete an installer in use
    // or release the single-flight guard while OS authentication is pending.
    tauri::async_runtime::spawn_blocking(move || {
        let (_guard, dir) = (guard, dir);
        let result = verified_apply(&path, &expected, &report, || {
            native::apply(&installation, &path, &name)
        });
        // A failed native Windows wait can leave an installer alive. Conservatively retain
        // the private payload on error rather than remove a file it might still consume.
        #[cfg(windows)]
        if result.is_err() {
            let retained = dir.keep();
            return result.map_err(|message| {
                format!(
                    "{message}; installer files retained at {}",
                    retained.display()
                )
            });
        }
        drop(dir);
        result
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_published_format_and_architecture_matches_exactly() {
        for (format, arch, suffix) in [
            (Format::Deb, "x86_64", "linux_amd64.deb"),
            (Format::Deb, "aarch64", "linux_arm64.deb"),
            (Format::Rpm, "x86_64", "linux_x86_64.rpm"),
            (Format::Rpm, "aarch64", "linux_aarch64.rpm"),
            (Format::Tar, "x86_64", "linux_amd64.tar.gz"),
            (Format::Tar, "aarch64", "linux_arm64.tar.gz"),
            (Format::AppImage, "x86_64", "linux_amd64.AppImage"),
            (Format::AppImage, "aarch64", "linux_arm64.AppImage"),
            (Format::Msi, "x86_64", "windows_x86_64.msi"),
            (Format::Nsis, "x86_64", "windows_x86_64-setup.exe"),
        ] {
            assert_eq!(
                asset_name(format, arch, "1.2.3").unwrap(),
                format!("plexusterm_1.2.3_{suffix}")
            );
        }
        for format in [
            Format::Deb,
            Format::Rpm,
            Format::Tar,
            Format::AppImage,
            Format::Msi,
            Format::Nsis,
        ] {
            assert!(asset_name(format, "riscv64", "1.2.3").is_err());
            assert!(asset_name(format, "x86_64", "../../evil").is_err());
        }
        assert!(asset_name(Format::Msi, "aarch64", "1.2.3").is_err());
        assert!(asset_name(Format::Nsis, "aarch64", "1.2.3").is_err());
    }
    #[test]
    fn only_trusted_https_hosts_without_credentials_or_ports() {
        for url in [
            "https://api.github.com/repos/x",
            "https://github.com/x",
            "https://release-assets.githubusercontent.com/x",
            "https://objects.githubusercontent.com/x",
        ] {
            assert!(trusted_url(url), "{url}");
        }
        for url in [
            "http://github.com/x",
            "https://github.com.evil/x",
            "https://user@github.com/x",
            "https://github.com:444/x",
            "file:///tmp/x",
            "https://evil/x",
        ] {
            assert!(!trusted_url(url), "{url}");
        }
    }
    #[test]
    fn checksum_is_exact_unique_and_hexadecimal() {
        let hash = "ab".repeat(32);
        assert_eq!(
            checksum(&format!("{hash}  package.deb\n"), "package.deb").unwrap(),
            hash
        );
        assert!(checksum(&format!("{hash}  other-package.deb\n"), "package.deb").is_err());
        assert!(
            checksum(
                &format!("{hash}  package.deb\n{hash}  package.deb"),
                "package.deb"
            )
            .is_err()
        );
        assert!(checksum(&format!("{}  package.deb", "z".repeat(64)), "package.deb").is_err());
    }
    #[test]
    fn verification_progress_cancellation_and_failure_never_launch_unverified_bytes() {
        use std::sync::Mutex;
        let dir = private_dir().unwrap();
        let package = dir.path().join("package");
        std::fs::write(&package, b"abc").unwrap();
        let expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let events = Mutex::new(Vec::new());
        let report = |p: Progress| {
            events.lock().unwrap().push(p.phase);
            Ok(())
        };
        assert_eq!(
            verified_apply(&package, expected, &report, || Ok(Outcome::Installed)).unwrap(),
            Outcome::Installed
        );
        assert_eq!(*events.lock().unwrap(), ["verifying", "installing"]);
        events.lock().unwrap().clear();
        assert!(
            verified_apply(&package, &"0".repeat(64), &report, || panic!(
                "must not launch"
            ))
            .is_err()
        );
        assert_eq!(*events.lock().unwrap(), ["verifying"]);
        assert!(
            verified_apply(&package, expected, &|_| Err("cancelled".into()), || panic!(
                "must not launch"
            ))
            .is_err()
        );
        assert_eq!(
            verified_apply(&package, expected, &report, || Err("launch failed".into())),
            Err("launch failed".into())
        );
        assert_eq!(std::fs::read(&package).unwrap(), b"abc");
        assert_eq!(
            serde_json::to_string(&Outcome::Installed).unwrap(),
            "\"installed\""
        );
        assert_eq!(
            serde_json::to_string(&Outcome::InstallerOpened).unwrap(),
            "\"installerOpened\""
        );
        assert_eq!(
            serde_json::to_value(Progress {
                phase: "downloading",
                downloaded: Some(3),
                total: Some(5)
            })
            .unwrap(),
            serde_json::json!({"phase":"downloading","downloaded":3,"total":5})
        );
        assert_eq!(
            serde_json::to_value(Progress {
                phase: "checking",
                downloaded: None,
                total: None
            })
            .unwrap(),
            serde_json::json!({"phase":"checking"})
        );
    }
    #[test]
    fn missing_wrong_host_duplicate_and_oversized_assets_fail() {
        let good = || Asset {
            name: "package.deb".into(),
            browser_download_url:
                "https://github.com/jorgealonsodev/PlexusTerm/releases/download/v1.2.3/package.deb"
                    .into(),
            size: 100,
        };
        assert!(select_asset(&[good()], "package.deb", 100).is_ok());
        assert!(select_asset(&[], "package.deb", 100).is_err());
        assert!(select_asset(&[good()], "other.deb", 100).is_err());
        assert!(select_asset(&[good(), good()], "package.deb", 100).is_err());
        assert!(select_asset(&[good()], "package.deb", 99).is_err());
        assert!(same_release(&good(), "v1.2.3").is_ok());
        assert!(same_release(&good(), "v1.2.4").is_err());
        assert!(!official_asset_url(
            "https://github.com/jorgealonsodev/PlexusTerm/releases/download/v1.2.3/other.deb",
            "package.deb"
        ));
        let mut bad = good();
        bad.browser_download_url = "https://evil/package.deb".into();
        assert!(select_asset(&[bad], "package.deb", 100).is_err());
    }
    async fn response(headers: &str, body: &str) -> reqwest::Response {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let answer = format!("HTTP/1.1 200 OK\r\n{headers}\r\nconnection: close\r\n\r\n{body}");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            // Only wait for request arrival; these fixtures do not parse HTTP headers.
            let mut request = [0; 1];
            socket.read_exact(&mut request).await.unwrap();
            socket.write_all(answer.as_bytes()).await.unwrap();
        });
        reqwest::Client::new().get(url).send().await.unwrap()
    }
    #[tokio::test]
    async fn downloads_are_bounded_complete_and_report_bytes_without_changing_target() {
        use std::sync::Mutex;
        let dir = private_dir().unwrap();
        let target = dir.path().join("target");
        std::fs::write(&target, b"original").unwrap();
        let package = dir.path().join("download");
        let mut file = std::fs::File::create(&package).unwrap();
        let events = Mutex::new(Vec::new());
        let report = |p: Progress| {
            events
                .lock()
                .unwrap()
                .push((p.phase, p.downloaded, p.total));
            Ok(())
        };
        consume(
            response("content-length: 3", "abc").await,
            3,
            Some(3),
            Some(&mut file),
            Some(&report),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&package).unwrap(), b"abc");
        assert_eq!(*events.lock().unwrap(), [("downloading", Some(3), Some(3))]);
        assert!(
            consume(
                response("content-length: 3", "abc").await,
                2,
                None,
                None,
                None
            )
            .await
            .is_err()
        );
        assert!(
            consume(
                response("content-length: 3", "abc").await,
                4,
                Some(4),
                None,
                None
            )
            .await
            .is_err()
        );
        assert!(
            consume(
                response("transfer-encoding: chunked", "3\r\nabc\r\n0\r\n\r\n").await,
                2,
                None,
                None,
                None
            )
            .await
            .is_err()
        );
        assert!(
            consume(
                response("content-length: 4", "abc").await,
                4,
                Some(4),
                None,
                None
            )
            .await
            .is_err()
        );
        assert!(
            consume(
                response("content-length: 3", "abc").await,
                3,
                Some(3),
                None,
                Some(&|_| Err("channel closed".into()))
            )
            .await
            .is_err()
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert_eq!(
            fetch(
                &client(Duration::from_secs(1)).unwrap(),
                "http://evil/",
                5,
                None,
                None,
                None
            )
            .await,
            Err("Untrusted update URL".into())
        );
    }
    #[tokio::test]
    async fn redirect_policy_and_request_timeout_are_enforced() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        for redirect in [false, true] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                // Only wait for request arrival, without assuming a complete socket read.
                let mut request = [0; 1];
                socket.read_exact(&mut request).await.unwrap();
                if redirect {
                    socket.write_all(b"HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:1/untrusted\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").await.unwrap();
                } else {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            });
            let timeout = if redirect {
                Duration::from_secs(2)
            } else {
                Duration::from_millis(50)
            };
            let err = client(timeout).unwrap().get(url).send().await.unwrap_err();
            if redirect {
                assert!(err.is_redirect(), "{err}");
            } else {
                assert!(err.is_timeout(), "{err}");
            }
            server.abort();
            let _ = server.await;
        }
    }
    #[tokio::test]
    async fn aborted_future_releases_single_flight() {
        let busy = std::sync::Arc::new(AtomicBool::new(false));
        let (started, ready) = tokio::sync::oneshot::channel();
        let owned = busy.clone();
        let task = tokio::spawn(async move {
            let _guard = Flight::acquire(&owned).unwrap();
            started.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        ready.await.unwrap();
        assert!(Flight::acquire(&busy).is_err());
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(Flight::acquire(&busy).is_ok());
    }
    #[test]
    fn single_flight_resets_after_error_or_cancellation() {
        let busy = AtomicBool::new(false);
        {
            let _guard = Flight::acquire(&busy).unwrap();
            assert!(Flight::acquire(&busy).is_err());
        }
        assert!(Flight::acquire(&busy).is_ok());
    }
}
