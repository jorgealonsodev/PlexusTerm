//! Plan usage of the AI CLIs for the bar under a terminal: how much of each rate-limit window
//! (5 hours, a week, a month) is spent and when it resets.
//!
//! - Claude Code: Anthropic's OAuth usage service (what Claude Code's `/usage` shows), read with
//!   the sign-in Claude Code keeps in `~/.claude/.credentials.json` (the Keychain on macOS).
//! - Codex: ChatGPT's `wham/usage`, read with the sign-in Codex keeps in `~/.codex/auth.json`.
//! - Antigravity (`agy`): the quota summary its local language server answers on 127.0.0.1, asked
//!   with the CSRF token on that server's command line (only while Antigravity runs).
//! - OpenCode Go answers `GET /zen/go/v1/usage` (see `ai::AiClient::opencode_go_usage`).

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Where Anthropic reports Claude Code's plan usage (what Claude Code's `/usage` shows).
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// The beta the OAuth usage service asks for.
const CLAUDE_OAUTH_BETA: &str = "oauth-2025-04-20";
/// The largest usage answer read (they are a few kilobytes).
const MAX_BODY: usize = 256 * 1024;
/// Where ChatGPT reports Codex's plan usage (what the Codex CLI itself reads).
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
/// How long a usage service may take to answer.
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowKind {
    FiveHour,
    Weekly,
    Monthly,
}

/// One rate-limit window: the percent spent, when it resets (Unix seconds), whether the limit
/// is reached, and the group of models it counts (Antigravity has several; none elsewhere).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub kind: WindowKind,
    pub percent: f64,
    pub resets_at: Option<i64>,
    pub limited: bool,
    pub group: Option<String>,
}

/// The windows of one provider, shortest first.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub windows: Vec<UsageWindow>,
}

fn window(
    kind: WindowKind,
    percent: Option<f64>,
    resets_at: Option<i64>,
    limited: bool,
) -> Option<UsageWindow> {
    let percent = percent?;
    Some(UsageWindow {
        kind,
        percent,
        resets_at,
        limited: limited || percent >= 100.0,
        group: None,
    })
}

/// Anthropic's OAuth usage: `five_hour` / `seven_day` with `utilization` (percent) and
/// `resets_at` (ISO 8601). None when it holds no window.
pub fn parse_claude(body: &Value) -> Option<Usage> {
    let windows: Vec<_> = [
        ("five_hour", WindowKind::FiveHour),
        ("seven_day", WindowKind::Weekly),
    ]
    .into_iter()
    .filter_map(|(name, kind)| {
        let w = &body[name];
        window(
            kind,
            w["utilization"].as_f64(),
            w["resets_at"].as_str().and_then(parse_iso_utc),
            !w["locked_reason"].is_null(),
        )
    })
    .collect();
    (!windows.is_empty()).then_some(Usage { windows })
}

/// The kind of a window from its length in seconds (Codex: 18000 and 604800 today).
fn kind_of(seconds: Option<i64>) -> WindowKind {
    match seconds {
        Some(s) if s <= 24 * 3600 => WindowKind::FiveHour,
        Some(s) if s <= 8 * 24 * 3600 => WindowKind::Weekly,
        Some(_) => WindowKind::Monthly,
        None => WindowKind::FiveHour,
    }
}

/// ChatGPT's `wham/usage`: `rate_limit.primary_window` / `secondary_window` with
/// `used_percent`, `limit_window_seconds` and `reset_at`, and `rate_limit.limit_reached`.
pub fn parse_codex(body: &Value) -> Option<Usage> {
    let limits = &body["rate_limit"];
    let reached = limits["limit_reached"].as_bool() == Some(true)
        || !body["rate_limit_reached_type"].is_null();
    let mut windows: Vec<_> = ["primary_window", "secondary_window"]
        .into_iter()
        .filter_map(|name| {
            let w = &limits[name];
            window(
                kind_of(w["limit_window_seconds"].as_i64()),
                w["used_percent"].as_f64(),
                w["reset_at"].as_i64(),
                false,
            )
        })
        .collect();
    if windows.is_empty() {
        return None;
    }
    if reached && !windows.iter().any(|w| w.limited) {
        // ChatGPT says a limit is reached without saying which: the fullest window.
        if let Some(w) = windows
            .iter_mut()
            .max_by(|a, b| a.percent.total_cmp(&b.percent))
        {
            w.limited = true;
        }
    }
    Some(Usage { windows })
}

/// OpenCode Go's `usage`: `rolling` (5 hours), `weekly` and `monthly` with `status`
/// (`ok` / `rate-limited`), `percent` and `resetsAt` (ISO 8601).
pub fn parse_opencode_go(body: &Value) -> Option<Usage> {
    let usage = &body["usage"];
    let windows: Vec<_> = [
        ("rolling", WindowKind::FiveHour),
        ("weekly", WindowKind::Weekly),
        ("monthly", WindowKind::Monthly),
    ]
    .into_iter()
    .filter_map(|(name, kind)| {
        let w = &usage[name];
        window(
            kind,
            w["percent"].as_f64(),
            w["resetsAt"].as_str().and_then(parse_iso_utc),
            w["status"].as_str() == Some("rate-limited"),
        )
    })
    .collect();
    (!windows.is_empty()).then_some(Usage { windows })
}

/// Unix seconds of an ISO 8601 timestamp with a `Z` or `±HH:MM` offset
/// (`2026-10-22T19:30:00.000Z`, `2026-10-22T20:19:59.642726+00:00`).
fn parse_iso_utc(text: &str) -> Option<i64> {
    let (text, offset) = match text.strip_suffix('Z') {
        Some(text) => (text, 0),
        None => {
            let cut = text
                .len()
                .checked_sub(6)
                .filter(|&i| text.is_char_boundary(i))?;
            let (text, zone) = text.split_at(cut);
            let sign = match zone.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let (h, m) = zone[1..].split_once(':')?;
            (
                text,
                sign * (h.parse::<i64>().ok()? * 3600 + m.parse::<i64>().ok()? * 60),
            )
        }
    };
    let (date, time) = text.split_once('T')?;
    let mut d = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (d.next()??, d.next()??, d.next()??);
    let time = time.split('.').next()?;
    let mut t = time.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hour, minute, second) = (t.next()??, t.next()??, t.next()??);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hour * 3600 + minute * 60 + second - offset)
}

/// A client for the usage services: no redirects, so a token goes only to the URL asked.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("PlexusTerm/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|err| err.to_string())
}

/// A transport error for the user, without the URL (or anything sent with it).
fn transport_error(service: &str, err: reqwest::Error) -> String {
    if err.is_timeout() {
        format!("{service} did not answer in time.")
    } else {
        format!("Could not reach {service}: {}.", err.without_url())
    }
}

/// The status and body of an answer, the body cut off at [`MAX_BODY`].
async fn read_answer(
    service: &str,
    mut response: reqwest::Response,
) -> Result<(u16, Vec<u8>), String> {
    let status = response.status().as_u16();
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| transport_error(service, err))?
    {
        if body.len() + chunk.len() > MAX_BODY {
            return Err(format!(
                "{service} sent an answer PlexusTerm could not read."
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((status, body))
}

/// Where Claude Code keeps its sign-in: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
fn claude_home() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(|home| PathBuf::from(home).join(".claude"))
}

/// The Claude plan sign-in Claude Code keeps (`claudeAiOauth`): its access token and when it
/// expires (Unix milliseconds). PlexusTerm only reads it; Claude Code renews it.
#[derive(PartialEq)]
pub struct ClaudeAuth {
    token: String,
    expires_at: Option<i64>,
}

impl std::fmt::Debug for ClaudeAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ClaudeAuth(***)")
    }
}

/// The sign-in in Claude Code's credentials; an API key sign-in has no plan usage.
pub fn claude_auth(text: &str) -> Result<ClaudeAuth, String> {
    let credentials: Value = serde_json::from_str(text)
        .map_err(|_| "Claude Code's credentials could not be read.".to_string())?;
    let oauth = &credentials["claudeAiOauth"];
    let token = oauth["accessToken"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or("Claude Code shows plan usage only when signed in with a Claude plan.")?;
    Ok(ClaudeAuth {
        token: token.to_string(),
        expires_at: oauth["expiresAt"].as_i64(),
    })
}

/// Claude Code's credentials: its `.credentials.json`, or on macOS the Keychain item it uses.
async fn claude_credentials() -> Result<String, String> {
    let path = claude_home()
        .ok_or("Claude Code's folder was not found.")?
        .join(".credentials.json");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => return Ok(text),
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("Could not read Claude Code's sign-in: {err}."));
        }
        Err(_) => {}
    }
    #[cfg(target_os = "macos")]
    {
        let out = tokio::process::Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .output()
            .await
            .map_err(|err| format!("Could not read Claude Code's sign-in: {err}."))?;
        if out.status.success() {
            return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
        }
    }
    Err("Claude Code is not signed in to a Claude plan.".into())
}

/// Asks the same URL with `curl`, whose TLS handshake Anthropic's edge accepts when it turns
/// PlexusTerm's away ("Request not allowed"). The headers go through stdin, not the command line.
async fn curl_get(url: &str, headers: &str) -> Result<(u16, Vec<u8>), String> {
    use tokio::io::AsyncWriteExt;
    let mut child = tokio::process::Command::new(if cfg!(windows) { "curl.exe" } else { "curl" })
        .args([
            "-q",
            "-s",
            "-m",
            "15",
            "--max-filesize",
            "262144",
            "-w",
            "\n%{http_code}",
            "-H",
            "@-",
            url,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "Anthropic refused the connection and curl is not available.".to_string())?;
    let mut stdin = child.stdin.take().ok_or("Could not run curl.")?;
    stdin
        .write_all(headers.as_bytes())
        .await
        .map_err(|_| "Could not run curl.".to_string())?;
    drop(stdin);
    let out = child
        .wait_with_output()
        .await
        .map_err(|_| "Could not run curl.".to_string())?;
    let text = out.stdout;
    let cut = text
        .iter()
        .rposition(|&b| b == b'\n')
        .ok_or("Could not reach Anthropic.")?;
    let status = std::str::from_utf8(&text[cut + 1..])
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&s| s != 0)
        .ok_or("Could not reach Anthropic.")?;
    Ok((status, text[..cut].to_vec()))
}

/// Asks Anthropic for Claude Code's plan usage, as `/usage` does. The token goes only to `url`
/// and never shows up in an error.
pub async fn fetch_claude(
    http: &reqwest::Client,
    url: &str,
    auth: &ClaudeAuth,
) -> Result<Usage, String> {
    let service = "Anthropic";
    let response = http
        .get(url)
        .timeout(TIMEOUT)
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", auth.token),
        )
        .header("anthropic-beta", CLAUDE_OAUTH_BETA)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|err| transport_error(service, err))?;
    let (mut status, mut body) = read_answer(service, response).await?;
    if status == 403 && String::from_utf8_lossy(&body).contains("Request not allowed") {
        let headers = format!(
            "Authorization: Bearer {}\nanthropic-beta: {CLAUDE_OAUTH_BETA}\nContent-Type: application/json\n",
            auth.token
        );
        (status, body) = curl_get(url, &headers).await?;
    }
    match status {
        200..=299 => {}
        401 => {
            return Err("Claude Code's sign-in has expired: open Claude Code to renew it.".into());
        }
        429 => {
            return Err(
                "Anthropic is limiting requests; the usage will be read again in a minute.".into(),
            );
        }
        _ => return Err(format!("Anthropic answered with HTTP {status}.")),
    }
    let body: Value = serde_json::from_slice(&body)
        .map_err(|_| "Anthropic sent an answer PlexusTerm could not read.".to_string())?;
    parse_claude(&body).ok_or_else(|| "Anthropic sent no usage figures for Claude Code.".into())
}

/// Claude Code's plan usage, read with the sign-in Claude Code keeps (never renewed here).
#[tauri::command]
pub async fn usage_claude() -> Result<Usage, String> {
    let auth = claude_auth(&claude_credentials().await?)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default();
    if auth.expires_at.is_some_and(|at| at <= now_ms) {
        return Err("Claude Code's sign-in has expired: open Claude Code to renew it.".into());
    }
    fetch_claude(&http_client()?, CLAUDE_USAGE_URL, &auth).await
}

/// Where Antigravity's language server answers the quota summary.
const AGY_QUOTA_PATH: &str =
    "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary";

/// Antigravity's quota summary: model `groups`, each with `buckets` whose `window` is `5h` or
/// `weekly`, with `remainingFraction` (0..1) and `resetTime` (ISO 8601).
pub fn parse_agy(body: &Value) -> Option<Usage> {
    let mut windows = Vec::new();
    for group in body["response"]["groups"].as_array().into_iter().flatten() {
        let name = group["displayName"].as_str().map(String::from);
        for bucket in group["buckets"].as_array().into_iter().flatten() {
            let id = [&bucket["window"], &bucket["bucketId"]]
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            let kind = if id.contains("week") {
                WindowKind::Weekly
            } else if id.contains("5h") || id.contains("hour") {
                WindowKind::FiveHour
            } else {
                continue;
            };
            let remaining = match &bucket["remainingFraction"] {
                Value::String(text) => text.parse::<f64>().ok(),
                // Zero is left out of the answer: a spent bucket keeps only its reset time.
                Value::Null if bucket["resetTime"].is_string() => Some(0.0),
                value => value.as_f64(),
            };
            let Some(remaining) = remaining.filter(|r| r.is_finite()) else {
                continue;
            };
            let used = ((1.0 - remaining.clamp(0.0, 1.0)) * 1000.0).round() / 10.0;
            let resets_at = bucket["resetTime"].as_str().and_then(parse_iso_utc);
            if let Some(mut w) = window(kind, Some(used), resets_at, false) {
                w.group = name.clone();
                windows.push(w);
            }
        }
    }
    windows.sort_by_key(|w| w.kind != WindowKind::FiveHour);
    (!windows.is_empty()).then_some(Usage { windows })
}

/// The value of `--name value` or `--name=value` among a command line's words.
fn flag_value(args: &str, name: &str) -> Option<String> {
    let mut words = args.split_whitespace();
    while let Some(word) = words.next() {
        if word == name {
            return words
                .next()
                .map(|v| v.trim_matches(['"', '\'']).to_string());
        }
        if let Some(value) = word
            .strip_prefix(name)
            .and_then(|rest| rest.strip_prefix('='))
        {
            return Some(value.trim_matches(['"', '\'']).to_string());
        }
    }
    None
}

/// Antigravity language servers in `pid args` lines, with their CSRF token (the IDE's and
/// `agy`'s). Other editors' language servers have no `--csrf_token`.
pub fn language_servers(processes: &str) -> Vec<(u32, String)> {
    processes
        .lines()
        .filter(|line| line.contains("language_server"))
        .filter_map(|line| {
            let line = line.trim();
            let (pid, args) = line.split_once(char::is_whitespace)?;
            let csrf = flag_value(args, "--csrf_token").filter(|t| !t.is_empty())?;
            Some((pid.trim().parse().ok()?, csrf))
        })
        .collect()
}

/// The loopback ports `pid` listens on, from `ss -ltnpH` (Linux), `lsof -Fn` (macOS) or
/// `netstat -ano` (Windows) output.
pub fn listening_ports(output: &str, pid: u32) -> Vec<u16> {
    let mut ports: Vec<u16> = Vec::new();
    let port_of = |addr: &str| {
        let (host, port) = addr.rsplit_once(':')?;
        matches!(host, "127.0.0.1" | "[::1]" | "localhost" | "*" | "0.0.0.0")
            .then(|| port.parse().ok())
            .flatten()
    };
    for line in output.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        let port = if line.contains(&format!("pid={pid},")) {
            words.get(3).and_then(|a| port_of(a))
        } else if let Some(addr) = line.strip_prefix('n') {
            port_of(addr)
        } else if words.len() >= 5 && words[3] == "LISTENING" && words[4] == pid.to_string() {
            port_of(words[1])
        } else {
            None
        };
        if let Some(port) = port.filter(|p| !ports.contains(p)) {
            ports.push(port);
        }
    }
    ports
}

async fn run(program: &str, args: &[&str]) -> Option<String> {
    let out = tokio::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The running processes as `pid args` lines.
async fn process_list() -> Option<String> {
    if cfg!(windows) {
        run(
            "powershell",
            &["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name like 'language_server%'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"],
        )
        .await
    } else {
        run("ps", &["-eo", "pid,args"]).await
    }
}

async fn ports_of(pid: u32) -> Vec<u16> {
    let output = if cfg!(target_os = "linux") {
        run("ss", &["-ltnpH"]).await
    } else if cfg!(windows) {
        run("netstat", &["-ano", "-p", "tcp"]).await
    } else {
        run(
            "lsof",
            &[
                "-nP",
                "-a",
                "-p",
                &pid.to_string(),
                "-iTCP",
                "-sTCP:LISTEN",
                "-Fn",
            ],
        )
        .await
    };
    output.map(|o| listening_ports(&o, pid)).unwrap_or_default()
}

/// The language server that answered last time (port and token), tried first.
static AGY_SERVER: std::sync::Mutex<Option<(u16, String)>> = std::sync::Mutex::new(None);

/// Asks the language server on `port` for its quota summary; the token goes only to 127.0.0.1.
pub async fn ask_agy(http: &reqwest::Client, base: &str, csrf: &str) -> Option<Value> {
    let response = http
        .post(format!("{base}{AGY_QUOTA_PATH}"))
        .timeout(Duration::from_secs(5))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header("X-Codeium-Csrf-Token", csrf)
        .header("Connect-Protocol-Version", "1")
        .body("{}")
        .send()
        .await
        .ok()?;
    let (status, body) = read_answer("Antigravity", response).await.ok()?;
    (status == 200)
        .then(|| serde_json::from_slice(&body).ok())
        .flatten()
}

/// Antigravity's plan usage, asked of its language server while Antigravity (the IDE or `agy`)
/// runs on this computer.
#[tauri::command]
pub async fn usage_agy() -> Result<Usage, String> {
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .build()
        .map_err(|err| err.to_string())?;
    let known = AGY_SERVER.lock().ok().and_then(|s| s.clone());
    let mut candidates: Vec<(u16, String)> = known.into_iter().collect();
    if candidates.is_empty() {
        let processes = process_list().await.unwrap_or_default();
        for (pid, csrf) in language_servers(&processes) {
            for port in ports_of(pid).await {
                candidates.push((port, csrf.clone()));
            }
        }
    }
    for (port, csrf) in &candidates {
        if let Some(body) = ask_agy(&http, &format!("http://127.0.0.1:{port}"), csrf).await {
            if let Ok(mut known) = AGY_SERVER.lock() {
                *known = Some((*port, csrf.clone()));
            }
            return parse_agy(&body).ok_or_else(|| "Antigravity sent no usage figures.".into());
        }
    }
    let had_known = AGY_SERVER.lock().ok().and_then(|mut s| s.take()).is_some();
    if had_known {
        // The language server it answered on has gone: look for the running one again.
        return Box::pin(usage_agy()).await;
    }
    Err("Antigravity is not running: its usage is read while the IDE or agy is open.".into())
}

/// Where Codex keeps its state: `$CODEX_HOME`, else `~/.codex`.
fn codex_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("CODEX_HOME").filter(|h| !h.is_empty()) {
        return Some(PathBuf::from(home));
    }
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(|home| PathBuf::from(home).join(".codex"))
}

/// The ChatGPT sign-in Codex keeps in `auth.json`: its access token and account.
#[derive(PartialEq)]
pub struct CodexAuth {
    token: String,
    account: Option<String>,
}

impl std::fmt::Debug for CodexAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CodexAuth(***)")
    }
}

/// The sign-in in Codex's `auth.json`; an API key sign-in has no plan usage.
pub fn codex_auth(text: &str) -> Result<CodexAuth, String> {
    let auth: Value = serde_json::from_str(text)
        .map_err(|_| "Codex's auth.json could not be read.".to_string())?;
    let tokens = &auth["tokens"];
    let token = tokens["access_token"]
        .as_str()
        .filter(|t| !t.is_empty())
        .ok_or("Codex shows plan usage only when signed in with ChatGPT.")?;
    Ok(CodexAuth {
        token: token.to_string(),
        account: tokens["account_id"]
            .as_str()
            .filter(|a| !a.is_empty())
            .map(String::from),
    })
}

/// Asks ChatGPT for Codex's plan usage, as the Codex CLI does. The token goes only to `url`,
/// redirects are refused, and it never shows up in an error.
pub async fn fetch_codex(
    http: &reqwest::Client,
    url: &str,
    auth: &CodexAuth,
) -> Result<Usage, String> {
    let mut request = http
        .get(url)
        .timeout(TIMEOUT)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", auth.token),
        )
        .header("originator", "plexusterm");
    if let Some(account) = &auth.account {
        request = request.header("ChatGPT-Account-Id", account);
    }
    let response = request
        .send()
        .await
        .map_err(|err| transport_error("ChatGPT", err))?;
    let (status, bytes) = read_answer("ChatGPT", response).await?;
    match status {
        200..=299 => {}
        401 | 403 => {
            return Err("Codex's ChatGPT sign-in has expired: run codex to sign in again.".into());
        }
        _ => return Err(format!("ChatGPT answered with HTTP {status}.")),
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "ChatGPT sent an answer PlexusTerm could not read.".to_string())?;
    parse_codex(&body).ok_or_else(|| "ChatGPT sent no usage figures for Codex.".into())
}

/// Codex's plan usage, read with the ChatGPT sign-in in `~/.codex/auth.json`.
#[tauri::command]
pub async fn usage_codex() -> Result<Usage, String> {
    let path = codex_home()
        .ok_or("Codex's folder was not found.")?
        .join("auth.json");
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err("Codex is not signed in (no ~/.codex/auth.json).".into());
        }
        Err(err) => return Err(format!("Could not read Codex's sign-in: {err}.")),
    };
    let auth = codex_auth(&text)?;
    fetch_codex(&http_client()?, CODEX_USAGE_URL, &auth).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn codex_windows_are_named_by_their_length() {
        let body = json!({"plan_type": "plus", "rate_limit": {"allowed": true, "limit_reached": false,
            "primary_window": {"used_percent": 5, "limit_window_seconds": 18000, "reset_after_seconds": 10197, "reset_at": 1_792_695_835},
            "secondary_window": {"used_percent": 19, "limit_window_seconds": 604800, "reset_at": 1_793_082_826}},
            "rate_limit_reached_type": null});
        let usage = parse_codex(&body).unwrap();
        assert_eq!(usage.windows[0].kind, WindowKind::FiveHour);
        assert_eq!(usage.windows[0].percent, 5.0);
        assert_eq!(usage.windows[0].resets_at, Some(1_792_695_835));
        assert_eq!(usage.windows[1].kind, WindowKind::Weekly);
        assert!(!usage.windows.iter().any(|w| w.limited));
    }

    #[test]
    fn codex_reached_limit_marks_the_fullest_window() {
        let body = json!({"rate_limit": {"limit_reached": true,
            "primary_window": {"used_percent": 60, "limit_window_seconds": 18000},
            "secondary_window": {"used_percent": 99, "limit_window_seconds": 604800}}});
        let usage = parse_codex(&body).unwrap();
        assert!(!usage.windows[0].limited);
        assert!(usage.windows[1].limited);
    }

    #[test]
    fn codex_auth_takes_the_chatgpt_token_and_account() {
        let auth = codex_auth(r#"{"auth_mode":"chatgpt","tokens":{"access_token":"tok","account_id":"acc","refresh_token":"r"}}"#).unwrap();
        assert_eq!(
            auth,
            CodexAuth {
                token: "tok".into(),
                account: Some("acc".into())
            }
        );
        assert_eq!(format!("{auth:?}"), "CodexAuth(***)");
    }

    #[test]
    fn codex_api_key_sign_in_has_no_plan_usage() {
        assert_eq!(
            codex_auth(r#"{"OPENAI_API_KEY":"sk-x","tokens":null}"#),
            Err("Codex shows plan usage only when signed in with ChatGPT.".to_string())
        );
        assert!(codex_auth("not json").is_err());
    }

    /// Answers one request per reply, in order, at `/backend-api/wham/usage`; returns the URL
    /// and the requests it got (lowercased).
    async fn serve(
        replies: Vec<(u16, &'static str)>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!(
            "http://{}/backend-api/wham/usage",
            listener.local_addr().unwrap()
        );
        let task = tokio::spawn(async move {
            let mut seen = Vec::new();
            for (status, body) in replies {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = vec![0; 8192];
                let n = socket.read(&mut buf).await.unwrap();
                let reply = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(reply.as_bytes()).await.unwrap();
                seen.push(String::from_utf8_lossy(&buf[..n]).to_lowercase());
            }
            seen
        });
        (url, task)
    }

    async fn serve_once(
        status: u16,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        serve(vec![(status, body)]).await
    }

    #[tokio::test]
    async fn codex_usage_is_asked_with_the_token_and_account() {
        let (url, request) = serve_once(
            200,
            r#"{"rate_limit":{"primary_window":{"used_percent":5,"limit_window_seconds":18000,"reset_at":7}}}"#,
        )
        .await;
        let auth = CodexAuth {
            token: "tok".into(),
            account: Some("acc".into()),
        };
        let usage = fetch_codex(&reqwest::Client::new(), &url, &auth)
            .await
            .unwrap();
        assert_eq!(usage.windows[0].percent, 5.0);
        let request = request.await.unwrap().remove(0);
        assert!(request.starts_with("get /backend-api/wham/usage"));
        assert!(request.contains("authorization: bearer tok"));
        assert!(request.contains("chatgpt-account-id: acc"));
    }

    #[tokio::test]
    async fn codex_expired_sign_in_is_explained_without_the_token() {
        let (url, _request) = serve_once(401, r#"{"detail":"token tok expired"}"#).await;
        let auth = CodexAuth {
            token: "tok".into(),
            account: None,
        };
        let err = fetch_codex(&reqwest::Client::new(), &url, &auth)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "Codex's ChatGPT sign-in has expired: run codex to sign in again."
        );
    }

    #[test]
    fn opencode_go_usage_reads_three_windows_and_the_rate_limited_status() {
        let body = json!({"usage": {
            "rolling": {"status": "ok", "percent": 42, "resetsAt": "2026-10-22T19:30:00.000Z"},
            "weekly": {"status": "ok", "percent": 18, "resetsAt": "2026-10-26T00:00:00.000Z"},
            "monthly": {"status": "rate-limited", "percent": 97, "resetsAt": "2026-11-01T00:00:00.000Z"}}});
        let usage = parse_opencode_go(&body).unwrap();
        let kinds: Vec<_> = usage.windows.iter().map(|w| w.kind).collect();
        assert_eq!(
            kinds,
            [
                WindowKind::FiveHour,
                WindowKind::Weekly,
                WindowKind::Monthly
            ]
        );
        assert_eq!(usage.windows[0].resets_at, Some(1_792_697_400));
        assert!(!usage.windows[0].limited);
        assert!(usage.windows[2].limited);
    }

    #[test]
    fn iso_timestamps_convert_to_unix_seconds() {
        assert_eq!(parse_iso_utc("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_utc("2000-03-01T12:00:00Z"), Some(951_912_000));
        assert_eq!(parse_iso_utc("2026-10-22T19:30:00"), None);
        assert_eq!(parse_iso_utc("not a date"), None);
    }

    const CLAUDE_BODY: &str = r#"{"five_hour":{"utilization":6.0,"resets_at":"2026-10-22T20:19:59.642726+00:00","locked_reason":null},
        "seven_day":{"utilization":85.0,"resets_at":"2026-10-25T11:59:59.642743+00:00","locked_reason":null},
        "seven_day_opus":null,"extra_usage":{"is_enabled":false}}"#;

    #[test]
    fn claude_usage_gives_the_five_hour_and_weekly_windows() {
        let usage = parse_claude(&serde_json::from_str(CLAUDE_BODY).unwrap()).unwrap();
        assert_eq!(
            usage.windows,
            vec![
                UsageWindow {
                    kind: WindowKind::FiveHour,
                    percent: 6.0,
                    resets_at: Some(1_792_700_399),
                    limited: false,
                    group: None,
                },
                UsageWindow {
                    kind: WindowKind::Weekly,
                    percent: 85.0,
                    resets_at: Some(1_792_929_599),
                    limited: false,
                    group: None,
                },
            ]
        );
        assert_eq!(parse_claude(&json!({"five_hour": null})), None);
        let locked = json!({"five_hour": {"utilization": 40.0, "locked_reason": "rate_limited"}});
        assert!(parse_claude(&locked).unwrap().windows[0].limited);
    }

    #[test]
    fn claude_auth_takes_the_plan_token_and_its_expiry() {
        let auth = claude_auth(r#"{"claudeAiOauth":{"accessToken":"tok","refreshToken":"r","expiresAt":1700000000000,"scopes":[]}}"#).unwrap();
        assert_eq!(
            auth,
            ClaudeAuth {
                token: "tok".into(),
                expires_at: Some(1_700_000_000_000)
            }
        );
        assert_eq!(format!("{auth:?}"), "ClaudeAuth(***)");
        assert_eq!(
            claude_auth(r#"{"primaryApiKey":"sk"}"#),
            Err("Claude Code shows plan usage only when signed in with a Claude plan.".to_string())
        );
        assert!(claude_auth("{").is_err());
    }

    #[tokio::test]
    async fn claude_usage_is_asked_with_the_token_and_the_oauth_beta() {
        let (url, requests) = serve_once(200, CLAUDE_BODY).await;
        let auth = ClaudeAuth {
            token: "tok".into(),
            expires_at: None,
        };
        let usage = fetch_claude(&reqwest::Client::new(), &url, &auth)
            .await
            .unwrap();
        assert_eq!(usage.windows[1].percent, 85.0);
        let request = requests.await.unwrap().remove(0);
        assert!(request.contains("authorization: bearer tok"));
        assert!(request.contains("anthropic-beta: oauth-2025-04-20"));
    }

    #[tokio::test]
    async fn claude_expired_sign_in_is_explained_without_the_token() {
        let (url, _requests) =
            serve_once(401, r#"{"error":{"message":"token tok invalid"}}"#).await;
        let auth = ClaudeAuth {
            token: "tok".into(),
            expires_at: None,
        };
        let err = fetch_claude(&reqwest::Client::new(), &url, &auth)
            .await
            .unwrap_err();
        assert_eq!(
            err,
            "Claude Code's sign-in has expired: open Claude Code to renew it."
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_usage_is_asked_again_with_curl_when_anthropic_refuses_the_handshake() {
        let (url, requests) = serve(vec![
            (403, r#"{"error":"Request not allowed"}"#),
            (200, CLAUDE_BODY),
        ])
        .await;
        let auth = ClaudeAuth {
            token: "tok".into(),
            expires_at: None,
        };
        let usage = fetch_claude(&reqwest::Client::new(), &url, &auth)
            .await
            .unwrap();
        assert_eq!(usage.windows[0].percent, 6.0);
        let requests = requests.await.unwrap();
        assert!(requests[1].contains("user-agent: curl"));
        assert!(requests[1].contains("authorization: bearer tok"));
        assert!(requests[1].contains("anthropic-beta: oauth-2025-04-20"));
    }

    #[test]
    fn iso_timestamps_with_an_offset_convert_to_unix_seconds() {
        assert_eq!(
            parse_iso_utc("2026-10-22T20:19:59.642726+00:00"),
            Some(1_792_700_399)
        );
        assert_eq!(parse_iso_utc("1970-01-01T02:00:00+02:00"), Some(0));
        assert_eq!(parse_iso_utc("1970-01-01T00:00:00-01:30"), Some(5400));
        assert_eq!(parse_iso_utc("2026-10-22T20:19:€abcd"), None);
    }
    const AGY_BODY: &str = r#"{"response":{"groups":[
        {"displayName":"Gemini Models","buckets":[
            {"bucketId":"gemini-weekly","window":"weekly","remainingFraction":0.75,"resetTime":"2026-10-24T09:16:08Z"},
            {"bucketId":"gemini-5h","window":"5h","remainingFraction":1,"resetTime":"2026-10-22T21:21:56Z"}]},
        {"displayName":"Claude and GPT models","buckets":[
            {"bucketId":"3p-5h","window":"5h","remainingFraction":"0.1","resetTime":"2026-10-22T21:21:56Z"}]}]}}"#;

    #[test]
    fn agy_quota_gives_each_group_s_windows_as_percent_used() {
        let usage = parse_agy(&serde_json::from_str(AGY_BODY).unwrap()).unwrap();
        let rows: Vec<_> = usage
            .windows
            .iter()
            .map(|w| (w.kind, w.percent, w.group.as_deref().unwrap()))
            .collect();
        assert_eq!(
            rows,
            [
                (WindowKind::FiveHour, 0.0, "Gemini Models"),
                (WindowKind::FiveHour, 90.0, "Claude and GPT models"),
                (WindowKind::Weekly, 25.0, "Gemini Models"),
            ]
        );
        assert_eq!(
            usage.windows[0].resets_at,
            parse_iso_utc("2026-10-22T21:21:56Z")
        );
        assert_eq!(parse_agy(&json!({"response": {"groups": []}})), None);
        let spent = json!({"response": {"groups": [{"displayName": "G", "buckets": [
            {"window": "5h", "resetTime": "2026-10-22T21:21:56Z"}, {"window": "weekly"}]}]}});
        let windows = parse_agy(&spent).unwrap().windows;
        assert_eq!(windows.len(), 1);
        assert!(windows[0].limited && windows[0].percent == 100.0);
    }

    #[test]
    fn antigravity_language_servers_are_found_by_their_csrf_token() {
        let ps = "  PID ARGS\n 293393 /opt/antigravity/bin/language_server_linux_x64 --csrf_token abc --extension_server_csrf_token zzz\n 400 /usr/bin/language_server --stdio\n 500 /x/language_server_macos --csrf_token=def\n";
        assert_eq!(
            language_servers(ps),
            vec![(293393, "abc".to_string()), (500, "def".to_string())]
        );
    }

    #[test]
    fn listening_ports_are_read_from_ss_lsof_and_netstat() {
        let ss = "LISTEN 0 4096 127.0.0.1:35081 0.0.0.0:* users:((\"language_server\",pid=293393,fd=9))\nLISTEN 0 4096 127.0.0.1:9999 0.0.0.0:* users:((\"other\",pid=1,fd=3))\n";
        assert_eq!(listening_ports(ss, 293393), vec![35081]);
        assert_eq!(
            listening_ports("p500\nf9\nn127.0.0.1:40277\n", 500),
            vec![40277]
        );
        let netstat = "  TCP    127.0.0.1:35081    0.0.0.0:0    LISTENING    700\n  TCP    127.0.0.1:1    0.0.0.0:0    LISTENING    8\n";
        assert_eq!(listening_ports(netstat, 700), vec![35081]);
    }

    #[tokio::test]
    async fn agy_quota_is_asked_with_the_csrf_token() {
        let (url, requests) = serve_once(200, AGY_BODY).await;
        let base = url.trim_end_matches("/backend-api/wham/usage");
        let body = ask_agy(&reqwest::Client::new(), base, "abc").await.unwrap();
        assert!(parse_agy(&body).is_some());
        let request = requests.await.unwrap().remove(0);
        assert!(request.starts_with(
            "post /exa.language_server_pb.languageserverservice/retrieveuserquotasummary"
        ));
        assert!(request.contains("x-codeium-csrf-token: abc"));
        assert!(request.contains("connect-protocol-version: 1"));
    }
}
