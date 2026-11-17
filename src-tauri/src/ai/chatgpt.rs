//! The "ChatGPT plan" provider: OpenAI's Sign in with ChatGPT flow for open-source apps
//! (developers.openai.com/siwc/token-sharing-open-source), so the AI features run on the
//! user's ChatGPT plan without an API key.
//!
//! Sign-in is an OAuth authorization-code flow with PKCE through the system browser and a
//! loopback listener on `127.0.0.1`. The credential record (tokens included) lives in a
//! private app config file; tokens never go back to the frontend, into errors, or into
//! `Debug` output. Refreshes, sign-in results and sign-out are serialized on one lock, so a
//! rotating refresh token is never used twice.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{AiError, AiErrorKind, ApiKey, Endpoints, Provider, USER_AGENT, transport_error};

/// The app name shown on OpenAI's consent screen (first registration only).
pub const AGENT_NAME: &str = "PlexusTerm";
/// The first-registration client ID; never saved or used for a token exchange.
const REGISTRATION_CLIENT: &str = "dynamic_agent_client";
/// The API the tokens are issued for.
pub const RESOURCE: &str = "https://api.openai.com/v1";
/// The issuer every ID token must name.
const ISSUER: &str = "https://auth.openai.com";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The granted scope that allows inference on the ChatGPT plan.
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const CALLBACK_PATH: &str = "/auth/callback";
/// The port OpenAI's examples use; any free port works when it is taken.
const PREFERRED_PORT: u16 = 1455;
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// A connection to the callback listener must send its request line within this time.
const CALLBACK_READ_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CALLBACK_REQUEST: usize = 16 * 1024;
/// Access tokens are renewed this long before they expire.
const REFRESH_MARGIN_SECS: u64 = 120;
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// The private app config file holding the credential record.
pub const CREDENTIALS_FILE: &str = "chatgpt-auth.json";
/// OAuth errors after which a refresh token can never work again.
const TERMINAL_REFRESH_ERRORS: [&str; 6] = [
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];

/// What the frontend may know about the sign-in (never a token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
    pub plan_enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignOut {
    /// False when OpenAI could not confirm that the session was revoked.
    pub revoked: bool,
}

/// The saved registration and token set. The host and client IDs outlive a sign-out.
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(default)]
    host_id: String,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scopes: Vec<String>,
    /// Unix seconds.
    #[serde(default)]
    expires_at: u64,
}

impl std::fmt::Debug for Record {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Record")
            .field("client_id", &self.client_id)
            .field("signed_in", &self.signed_in())
            .field("scopes", &self.scopes)
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

impl Record {
    fn signed_in(&self) -> bool {
        self.access_token.is_some() || self.refresh_token.is_some()
    }

    fn plan_enabled(&self) -> bool {
        self.signed_in() && self.scopes.iter().any(|s| s == PLAN_SCOPE)
    }

    fn status(&self) -> Status {
        Status {
            signed_in: self.signed_in(),
            email: self.email.clone().filter(|_| self.signed_in()),
            plan_enabled: self.plan_enabled(),
        }
    }

    /// Forgets the tokens; the registration (host, client, account) is kept for a later sign-in.
    fn clear_tokens(&mut self) {
        self.id_token = None;
        self.access_token = None;
        self.refresh_token = None;
        self.scopes.clear();
        self.expires_at = 0;
    }
}

/// The token endpoint's answer.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
}

/// The ID token claims PlexusTerm checks.
#[derive(Deserialize)]
struct Claims {
    iss: String,
    aud: Value,
    exp: u64,
    #[serde(default)]
    nonce: Option<String>,
    sub: String,
    #[serde(default)]
    email: Option<String>,
}

/// The ChatGPT sign-in (Tauri managed state, inside `AiClient`).
#[derive(Default)]
pub struct ChatGptAuth {
    path: Mutex<Option<PathBuf>>,
    /// Held for every read-modify-write of the record.
    lock: tokio::sync::Mutex<()>,
    /// The pending sign-in (its attempt number), ended when its sender is dropped or sent to.
    pending: Mutex<Option<(u64, tokio::sync::oneshot::Sender<()>)>>,
    /// Numbers sign-in attempts, so one never clears another's pending slot.
    attempts: std::sync::atomic::AtomicU64,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn config_error(message: impl Into<String>) -> AiError {
    AiError::config(message)
}

fn not_signed_in() -> AiError {
    AiError::new(
        AiErrorKind::NoKey,
        "Not signed in to ChatGPT. Use \"Continue with ChatGPT\" in Settings > AI.",
    )
}

fn expired_sign_in() -> AiError {
    AiError::new(
        AiErrorKind::NoKey,
        "Your ChatGPT sign-in has expired. Use \"Continue with ChatGPT\" in Settings > AI to sign in again.",
    )
}

fn plan_not_enabled() -> AiError {
    config_error(
        "ChatGPT plan use isn't enabled for PlexusTerm. Use \"Continue with ChatGPT\" in Settings > AI and allow it.",
    )
}

impl ChatGptAuth {
    /// Where the credential record is kept (set once the app paths are known).
    pub fn set_path(&self, path: Option<PathBuf>) {
        let mut current = self.path.lock().unwrap_or_else(|p| p.into_inner());
        if path.is_some() {
            *current = path;
        }
    }

    fn path(&self) -> Result<PathBuf, AiError> {
        self.path
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
            .ok_or_else(|| config_error("PlexusTerm has no folder to keep the ChatGPT sign-in in."))
    }

    fn load(&self) -> Result<Record, AiError> {
        let path = self.path()?;
        let text = crate::storage::load(&path)
            .map_err(|err| config_error(format!("Could not read the ChatGPT sign-in: {err}.")))?;
        Ok(text
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default())
    }

    fn save(&self, record: &Record) -> Result<(), AiError> {
        let path = self.path()?;
        let text = serde_json::to_string_pretty(record)
            .map_err(|_| config_error("Could not save the ChatGPT sign-in."))?;
        crate::storage::save(&path, &text)
            .map_err(|err| config_error(format!("Could not save the ChatGPT sign-in: {err}.")))
    }

    pub async fn status(&self) -> Result<Status, AiError> {
        let _guard = self.lock.lock().await;
        Ok(self.load()?.status())
    }

    /// Ends a pending sign-in, if any.
    pub fn cancel(&self) {
        if let Some((_, tx)) = self
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            let _ = tx.send(());
        }
    }

    /// Signs in through the browser: `open` gets the authorization URL to show the user.
    pub async fn sign_in(
        &self,
        http: &reqwest::Client,
        endpoints: &Endpoints,
        open: impl FnOnce(&str) -> Result<(), String>,
    ) -> Result<Status, AiError> {
        // A stable host ID is chosen and saved before the first sign-in.
        let saved = {
            let _guard = self.lock.lock().await;
            let mut record = self.load()?;
            if record.host_id.is_empty() {
                record.host_id = host_id()?;
                self.save(&record)?;
            }
            record
        };
        let (tx, mut cancelled) = tokio::sync::oneshot::channel();
        let number = self
            .attempts
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        // A new sign-in ends the previous one (its sender is dropped).
        *self.pending.lock().unwrap_or_else(|p| p.into_inner()) = Some((number, tx));

        let listener = bind_callback().await?;
        let port = listener
            .local_addr()
            .map_err(|err| config_error(format!("Could not start the sign-in listener: {err}.")))?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
        let attempt = Attempt::new()?;
        let url = authorize_url(endpoints, &saved, &redirect_uri, &attempt);
        open(&url).map_err(|err| config_error(format!("Could not open the browser: {err}.")))?;

        let params = tokio::select! {
            params = wait_callback(&listener, &attempt.state) => params?,
            _ = &mut cancelled => return Err(config_error("ChatGPT sign-in was cancelled.")),
            _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => {
                return Err(config_error("ChatGPT sign-in timed out. Try again."));
            }
        };
        drop(listener);
        {
            // Only this attempt's slot: a newer sign-in may have replaced it meanwhile.
            let mut pending = self.pending.lock().unwrap_or_else(|p| p.into_inner());
            if pending.as_ref().is_some_and(|(n, _)| *n == number) {
                pending.take();
            }
        }

        if let Some(error) = params.get("error") {
            if error == "access_denied" {
                return Err(config_error(
                    "ChatGPT sign-in was declined, so PlexusTerm cannot use your ChatGPT plan.",
                ));
            }
            return Err(config_error(format!(
                "ChatGPT sign-in failed ({}).",
                safe_code(error)
            )));
        }
        let code = params
            .get("code")
            .filter(|c| !c.is_empty())
            .ok_or_else(|| config_error("ChatGPT sign-in returned no authorization code."))?;
        let client_id = match (&saved.client_id, params.get("client_id")) {
            (None, Some(issued)) if valid_client_id(issued) => issued.clone(),
            (None, _) => {
                return Err(config_error(
                    "ChatGPT did not finish registering PlexusTerm. Try again.",
                ));
            }
            (Some(saved_id), Some(issued)) if issued != saved_id => {
                return Err(config_error(
                    "ChatGPT returned another app registration; the sign-in was not used.",
                ));
            }
            (Some(saved_id), _) => saved_id.clone(),
        };

        let (status, body) = post_form(
            http,
            &token_url(endpoints),
            &[
                ("grant_type", "authorization_code"),
                ("client_id", &client_id),
                ("code", code),
                ("code_verifier", &attempt.verifier),
                ("redirect_uri", &redirect_uri),
                ("resource", RESOURCE),
            ],
        )
        .await?;
        if !(200..300).contains(&status) {
            return Err(config_error(format!(
                "ChatGPT sign-in failed: the code could not be exchanged ({}). Try again.",
                oauth_error(&body).unwrap_or_else(|| format!("HTTP {status}"))
            )));
        }
        let tokens: TokenResponse =
            serde_json::from_str(&body).map_err(|_| AiError::bad_response(Provider::ChatGpt))?;
        let id_token = tokens
            .id_token
            .clone()
            .ok_or_else(|| AiError::bad_response(Provider::ChatGpt))?;
        let claims = validate_id_token(&id_token, &client_id, &attempt.nonce, now_secs())?;
        if saved.subject.as_ref().is_some_and(|s| *s != claims.sub) {
            return Err(config_error(
                "Another ChatGPT account signed in than the one this registration belongs to; the sign-in was not used.",
            ));
        }
        // Only the token response's granted scopes count (not the callback's).
        let granted = tokens.scope.clone().unwrap_or_default();

        let _guard = self.lock.lock().await;
        let mut record = self.load()?;
        record.host_id = saved.host_id;
        record.client_id = Some(client_id);
        record.subject = Some(claims.sub);
        record.email = claims.email;
        record.id_token = Some(id_token);
        record.access_token = Some(tokens.access_token);
        record.refresh_token = tokens.refresh_token;
        record.scopes = granted.split_whitespace().map(str::to_string).collect();
        record.expires_at = now_secs() + tokens.expires_in.unwrap_or(3600);
        self.save(&record)?;
        Ok(record.status())
    }

    /// A valid access token for inference, renewed first when it is about to expire.
    pub async fn access_token(
        &self,
        http: &reqwest::Client,
        endpoints: &Endpoints,
    ) -> Result<ApiKey, AiError> {
        let _guard = self.lock.lock().await;
        let mut record = self.load()?;
        if !record.signed_in() {
            return Err(not_signed_in());
        }
        if !record.plan_enabled() {
            return Err(plan_not_enabled());
        }
        if let Some(token) = &record.access_token
            && now_secs() + REFRESH_MARGIN_SECS < record.expires_at
        {
            return Ok(ApiKey(token.clone()));
        }
        let (Some(refresh), Some(client_id)) =
            (record.refresh_token.clone(), record.client_id.clone())
        else {
            record.clear_tokens();
            self.save(&record)?;
            return Err(expired_sign_in());
        };
        let (status, body) = post_form(
            http,
            &token_url(endpoints),
            &[
                ("grant_type", "refresh_token"),
                ("client_id", &client_id),
                ("refresh_token", &refresh),
                ("resource", RESOURCE),
            ],
        )
        .await?;
        if !(200..300).contains(&status) {
            let error = oauth_error(&body);
            if error
                .as_deref()
                .is_some_and(|e| TERMINAL_REFRESH_ERRORS.contains(&e))
            {
                record.clear_tokens();
                self.save(&record)?;
                return Err(expired_sign_in());
            }
            if error.as_deref() == Some("invalid_client") {
                return Err(config_error(
                    "ChatGPT no longer accepts PlexusTerm's registration. Sign out and use \"Continue with ChatGPT\" again in Settings > AI.",
                ));
            }
            return Err(match status {
                500..=599 => AiError::new(
                    AiErrorKind::Network,
                    format!("ChatGPT's sign-in service is unavailable right now (HTTP {status})."),
                ),
                _ => AiError::new(
                    AiErrorKind::Auth,
                    format!(
                        "ChatGPT did not renew the sign-in ({}).",
                        error.unwrap_or_else(|| format!("HTTP {status}"))
                    ),
                ),
            });
        }
        let tokens: TokenResponse =
            serde_json::from_str(&body).map_err(|_| AiError::bad_response(Provider::ChatGpt))?;
        record.access_token = Some(tokens.access_token.clone());
        if let Some(replacement) = tokens.refresh_token {
            record.refresh_token = Some(replacement);
        }
        if let Some(scope) = tokens.scope {
            record.scopes = scope.split_whitespace().map(str::to_string).collect();
        }
        if let Some(id_token) = tokens.id_token {
            record.id_token = Some(id_token);
        }
        record.expires_at = now_secs() + tokens.expires_in.unwrap_or(3600);
        self.save(&record)?;
        if !record.plan_enabled() {
            return Err(plan_not_enabled());
        }
        Ok(ApiKey(tokens.access_token))
    }

    /// Revokes the renewable session, then forgets the tokens even when revocation failed.
    pub async fn sign_out(
        &self,
        http: &reqwest::Client,
        endpoints: &Endpoints,
    ) -> Result<SignOut, AiError> {
        self.cancel();
        let _guard = self.lock.lock().await;
        let mut record = self.load()?;
        let revoked = match (&record.refresh_token, &record.client_id) {
            (Some(refresh), Some(client_id)) => revoke(http, endpoints, refresh, client_id).await,
            _ => true,
        };
        record.clear_tokens();
        self.save(&record)?;
        Ok(SignOut { revoked })
    }
}

/// Values fresh for each sign-in attempt.
struct Attempt {
    state: String,
    nonce: String,
    verifier: String,
}

impl Attempt {
    fn new() -> Result<Self, AiError> {
        Ok(Self {
            state: random_token()?,
            nonce: random_token()?,
            verifier: random_token()?,
        })
    }
}

fn random_bytes<const N: usize>() -> Result<[u8; N], AiError> {
    use rand::TryRng;
    let mut bytes = [0u8; N];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .map_err(|_| config_error("The system has no random source for the ChatGPT sign-in."))?;
    Ok(bytes)
}

/// 32 random bytes, base64url (43 characters, a valid PKCE verifier).
fn random_token() -> Result<String, AiError> {
    Ok(base64url(&random_bytes::<32>()?))
}

/// A UUIDv4 URN, the host ID format OpenAI accepts.
fn host_id() -> Result<String, AiError> {
    let mut b = random_bytes::<16>()?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!(
        "urn:uuid:{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url.
pub(super) fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(char::from(B64URL[((n >> (18 - 6 * i)) & 63) as usize]));
        }
    }
    out
}

/// Decodes base64url with or without padding.
fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    let text = text.trim_end_matches('=');
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in text.bytes() {
        let v = B64URL.iter().position(|&b| b == c)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// The PKCE S256 challenge of `verifier`.
pub(super) fn pkce_challenge(verifier: &str) -> String {
    base64url(&Sha256::digest(verifier.as_bytes()))
}

/// Percent-encodes everything but the RFC 3986 unreserved characters.
fn encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let digits = &bytes[i + 1..i + 3];
                let hex = digits
                    .iter()
                    .all(u8::is_ascii_hexdigit)
                    .then(|| std::str::from_utf8(digits).ok())
                    .flatten();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn form_encode(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

pub(super) fn parse_query(query: &str) -> HashMap<String, String> {
    query
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (decode(k), decode(v))
        })
        .collect()
}

fn auth_base(endpoints: &Endpoints) -> &str {
    endpoints.chatgpt_auth.trim_end_matches('/')
}

fn token_url(endpoints: &Endpoints) -> String {
    format!("{}/api/accounts/oauth/token", auth_base(endpoints))
}

/// The browser URL of one authorization attempt.
fn authorize_url(
    endpoints: &Endpoints,
    record: &Record,
    redirect_uri: &str,
    attempt: &Attempt,
) -> String {
    let challenge = pkce_challenge(&attempt.verifier);
    let mut params: Vec<(&str, &str)> = vec![("response_type", "code")];
    match &record.client_id {
        Some(client_id) => {
            params.push(("client_id", client_id));
            if let Some(hint) = &record.id_token {
                params.push(("id_token_hint", hint));
            }
            if let Some(email) = &record.email {
                params.push(("login_hint", email));
            }
        }
        None => {
            params.push(("client_id", REGISTRATION_CLIENT));
            params.push(("agent_name_hint", AGENT_NAME));
        }
    }
    params.extend([
        ("ext_agent_host_id", record.host_id.as_str()),
        ("redirect_uri", redirect_uri),
        ("scope", SCOPE),
        ("resource", RESOURCE),
        ("state", attempt.state.as_str()),
        ("nonce", attempt.nonce.as_str()),
        ("code_challenge_method", "S256"),
        ("code_challenge", challenge.as_str()),
    ]);
    format!(
        "{}/api/accounts/authorize?{}",
        auth_base(endpoints),
        form_encode(&params)
    )
}

/// Issued client IDs look like `oaiapp_...`; anything odd is refused.
fn valid_client_id(id: &str) -> bool {
    id != REGISTRATION_CLIENT
        && !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// An OAuth/API error code reduced to safe characters for a message.
fn safe_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        .take(64)
        .collect()
}

fn oauth_error(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let code = value["error"]
        .as_str()
        .or_else(|| value["error"]["code"].as_str())?;
    Some(safe_code(code)).filter(|c| !c.is_empty())
}

/// Checks the claims of an ID token received straight from the token endpoint over TLS
/// (OIDC Core 3.1.3.7 lets TLS stand in for the signature there).
fn validate_id_token(
    token: &str,
    client_id: &str,
    nonce: &str,
    now: u64,
) -> Result<Claims, AiError> {
    let invalid = || config_error("ChatGPT sent a sign-in PlexusTerm could not verify.");
    let payload = token.split('.').nth(1).ok_or_else(invalid)?;
    let claims: Claims = serde_json::from_slice(&base64url_decode(payload).ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    let audience_ok = match &claims.aud {
        Value::String(aud) => aud == client_id,
        Value::Array(auds) => auds.iter().any(|a| a == client_id),
        _ => false,
    };
    let valid = claims.iss == ISSUER
        && audience_ok
        && claims.exp > now
        && claims.nonce.as_deref() == Some(nonce)
        && !claims.sub.is_empty();
    if valid { Ok(claims) } else { Err(invalid()) }
}

async fn bind_callback() -> Result<TcpListener, AiError> {
    match TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).await {
        Ok(listener) => Ok(listener),
        Err(_) => TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|err| config_error(format!("Could not start the sign-in listener: {err}."))),
    }
}

const DONE_PAGE: &str = "<!doctype html><meta charset=\"utf-8\"><title>PlexusTerm</title><body style=\"font-family:sans-serif;margin:3em\"><h1>PlexusTerm</h1><p>You can close this tab and go back to PlexusTerm.</p></body>";

/// Waits for the browser's callback with `state`; other requests are answered and ignored.
async fn wait_callback(
    listener: &TcpListener,
    state: &str,
) -> Result<HashMap<String, String>, AiError> {
    // Each connection is read on its own task, so one that sends nothing (a browser
    // preconnect) never holds up the callback.
    let (found_tx, mut found) = tokio::sync::mpsc::channel(1);
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (socket, _) = accepted
                    .map_err(|err| config_error(format!("The sign-in listener failed: {err}.")))?;
                tokio::spawn(answer_callback(socket, state.to_string(), found_tx.clone()));
            }
            Some(params) = found.recv() => return Ok(params),
        }
    }
}

/// Answers one connection to the listener; sends the parameters of the right callback.
async fn answer_callback(
    mut socket: tokio::net::TcpStream,
    state: String,
    found: tokio::sync::mpsc::Sender<HashMap<String, String>>,
) {
    let Ok(Some(target)) =
        tokio::time::timeout(CALLBACK_READ_TIMEOUT, read_target(&mut socket)).await
    else {
        return;
    };
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    if path != CALLBACK_PATH {
        reply(&mut socket, "404 Not Found", "").await;
        return;
    }
    let params = parse_query(query);
    if params.get("state") != Some(&state) {
        reply(&mut socket, "400 Bad Request", "").await;
        return;
    }
    reply(&mut socket, "200 OK", DONE_PAGE).await;
    let _ = found.send(params).await;
}

/// The request target of a `GET` request line.
async fn read_target(socket: &mut tokio::net::TcpStream) -> Option<String> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 2048];
    while !raw.windows(2).any(|w| w == b"\r\n") {
        let n = socket.read(&mut buf).await.ok()?;
        if n == 0 || raw.len() + n > MAX_CALLBACK_REQUEST {
            return None;
        }
        raw.extend_from_slice(&buf[..n]);
    }
    let line = String::from_utf8_lossy(&raw);
    let mut parts = line.lines().next()?.split(' ');
    (parts.next()? == "GET").then_some(())?;
    parts.next().map(str::to_string)
}

async fn reply(socket: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
}

async fn post_form(
    http: &reqwest::Client,
    url: &str,
    pairs: &[(&str, &str)],
) -> Result<(u16, String), AiError> {
    let response = http
        .post(url)
        .timeout(HTTP_TIMEOUT)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .header(reqwest::header::ACCEPT, "application/json")
        .body(form_encode(pairs))
        .send()
        .await
        .map_err(|err| transport_error(Provider::ChatGpt, err))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| transport_error(Provider::ChatGpt, err))?;
    Ok((status, body))
}

/// `scheme://host[:port]` of a URL.
fn origin(url: &str) -> Option<&str> {
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find('/').unwrap_or(rest.len());
    Some(&url[..scheme.len() + 3 + end])
}

/// Revokes the refresh token at the issuer's `revocation_endpoint`, retrying network and
/// server failures twice. The endpoint must be on the sign-in service's own origin.
async fn revoke(
    http: &reqwest::Client,
    endpoints: &Endpoints,
    refresh: &str,
    client_id: &str,
) -> bool {
    let base = auth_base(endpoints);
    let discovery = format!("{base}/.well-known/openid-configuration");
    let Ok(response) = http
        .get(&discovery)
        .timeout(HTTP_TIMEOUT)
        .header(reqwest::header::USER_AGENT, USER_AGENT)
        .send()
        .await
    else {
        return false;
    };
    let Ok(config) = response.json::<Value>().await else {
        return false;
    };
    let Some(endpoint) = config["revocation_endpoint"].as_str() else {
        return false;
    };
    if origin(endpoint).is_none() || origin(endpoint) != origin(base) {
        return false;
    }
    for attempt in 0..3u64 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
        }
        match post_form(
            http,
            endpoint,
            &[
                ("token", refresh),
                ("token_type_hint", "refresh_token"),
                ("client_id", client_id),
            ],
        )
        .await
        {
            Ok((200..=299, _)) => return true,
            Ok((500..=599, _)) | Err(_) => continue,
            Ok(_) => return false,
        }
    }
    false
}

/// The `response` object of the stream's terminal event, or the error it carried.
/// Success needs `response.completed`; `response.incomplete` comes back as an incomplete
/// response (a truncated answer).
pub(super) fn stream_response(body: &str) -> Result<Value, AiError> {
    let mut data = String::new();
    for line in body.lines().chain(std::iter::once("")) {
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.strip_prefix(' ').unwrap_or(rest));
            continue;
        }
        if !line.trim().is_empty() || data.is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(&data).unwrap_or(Value::Null);
        data.clear();
        match event["type"].as_str() {
            Some("response.completed" | "response.incomplete") => {
                return Ok(event["response"].clone());
            }
            Some("response.failed") => {
                let error = &event["response"]["error"];
                return Err(api_error(
                    0,
                    error["code"].as_str(),
                    error["param"].as_str(),
                ));
            }
            Some("error") => {
                let code = event["code"]
                    .as_str()
                    .or_else(|| event["error"]["code"].as_str());
                return Err(api_error(0, code, event["param"].as_str()));
            }
            _ => {}
        }
    }
    Err(AiError::new(
        AiErrorKind::Network,
        "ChatGPT's answer stopped before it was complete; try again.",
    ))
}

/// Maps a non-2xx answer of the ChatGPT plan API.
pub(super) fn status_error(status: u16, body: &str) -> AiError {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let error = &value["error"];
    api_error(status, error["code"].as_str(), error["param"].as_str())
}

/// The message for a structured ChatGPT plan error (`status` 0 when it came in the stream).
fn api_error(status: u16, code: Option<&str>, param: Option<&str>) -> AiError {
    let usage = "https://chatgpt.com/settings/usage";
    match code.unwrap_or_default() {
        "subscription_sharing_usage_limit_exceeded" => AiError::new(
            AiErrorKind::RateLimit,
            format!(
                "PlexusTerm has reached its usage limit on your ChatGPT plan. Check ChatGPT Settings > Usage ({usage})."
            ),
        ),
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            AiError::new(
                AiErrorKind::Network,
                "ChatGPT could not check your plan right now; try again later.",
            )
        }
        "subscription_sharing_user_not_eligible" => config_error(
            "Your ChatGPT plan can't be used in PlexusTerm (account, workspace or policy).",
        ),
        "subscription_sharing_unsupported_capability" => {
            let what = param.map(safe_code).filter(|p| !p.is_empty());
            config_error(match what {
                Some(p) => {
                    format!("ChatGPT does not support \"{p}\" in this request. Try another model.")
                }
                None => "ChatGPT does not support this request. Try another model.".to_string(),
            })
        }
        "subscription_sharing_route_not_supported"
        | "chatpass_v2_scope_not_authorized"
        | "chatpass_v2_invalid_authorization_context" => {
            config_error("ChatGPT did not authorize this request for PlexusTerm.")
        }
        "subscription_sharing_invalid_user" => AiError::new(
            AiErrorKind::Auth,
            "ChatGPT could not validate your sign-in. If it keeps failing, sign in again in Settings > AI.",
        ),
        other => {
            let code = Some(safe_code(other)).filter(|c| !c.is_empty());
            match (status, code) {
                (401 | 403, _) => AiError::new(
                    AiErrorKind::Auth,
                    "ChatGPT did not accept the sign-in. If it keeps failing, sign in again in Settings > AI.",
                ),
                (429, _) => AiError::new(
                    AiErrorKind::RateLimit,
                    "ChatGPT is limiting requests; try again in a moment.",
                ),
                (500..=599, _) => AiError::new(
                    AiErrorKind::Network,
                    format!("ChatGPT is unavailable right now (HTTP {status})."),
                ),
                (0, Some(code)) => AiError::new(
                    AiErrorKind::BadResponse,
                    format!("ChatGPT could not answer ({code})."),
                ),
                (0, None) => AiError::new(AiErrorKind::BadResponse, "ChatGPT could not answer."),
                (_, Some(code)) => config_error(format!(
                    "ChatGPT rejected the request (HTTP {status}, {code}). Check the model."
                )),
                (_, None) => config_error(format!(
                    "ChatGPT rejected the request (HTTP {status}). Check the model."
                )),
            }
        }
    }
}

/// The plan's models from `GET /models`: `models[]` with `visibility == "list"`, in server order.
pub(super) fn parse_models(value: &Value) -> Option<Vec<(String, Option<String>)>> {
    let models = value.get("models")?.as_array()?;
    Some(
        models
            .iter()
            .filter(|m| m["visibility"] == "list")
            .filter_map(|m| {
                let slug = m["slug"].as_str()?.to_string();
                Some((slug, m["display_name"].as_str().map(str::to_string)))
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_known_vectors() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
        assert_eq!(base64url_decode("-_8").unwrap(), vec![0xfb, 0xff]);
        assert_eq!(base64url_decode("Zm9vYg==").unwrap(), b"foob");
        assert!(base64url_decode("a*b").is_none());
    }

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn host_ids_are_uuid_v4_urns() {
        let id = host_id().unwrap();
        assert_eq!(id.len(), "urn:uuid:".len() + 36);
        assert!(id.starts_with("urn:uuid:"));
        assert_eq!(&id[9 + 14..9 + 15], "4");
        assert!(matches!(&id[9 + 19..9 + 20], "8" | "9" | "a" | "b"));
        assert_ne!(id, host_id().unwrap());
    }

    #[test]
    fn queries_decode_percent_and_plus() {
        let q = parse_query("code=a%2Fb&scope=openid+email&state=x&empty=&bad=%zz");
        assert_eq!(q["code"], "a/b");
        assert_eq!(q["scope"], "openid email");
        assert_eq!(q["empty"], "");
        assert_eq!(q["bad"], "%zz");
    }

    fn attempt() -> Attempt {
        Attempt {
            state: "st".into(),
            nonce: "no".into(),
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into(),
        }
    }

    fn endpoints() -> Endpoints {
        Endpoints::default()
    }

    #[test]
    fn first_authorization_registers_with_the_dynamic_client() {
        let record = Record {
            host_id: "urn:uuid:h".into(),
            ..Record::default()
        };
        let url = authorize_url(
            &endpoints(),
            &record,
            "http://127.0.0.1:1455/auth/callback",
            &attempt(),
        );
        let (base, query) = url.split_once('?').unwrap();
        assert_eq!(base, "https://auth.openai.com/api/accounts/authorize");
        let q = parse_query(query);
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["agent_name_hint"], "PlexusTerm");
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:h");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:1455/auth/callback");
        assert_eq!(
            q["scope"],
            "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
        );
        assert_eq!(q["resource"], "https://api.openai.com/v1");
        assert_eq!(q["state"], "st");
        assert_eq!(q["nonce"], "no");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(
            q["code_challenge"],
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert!(!q.contains_key("id_token_hint"));
        assert!(!q.contains_key("login_hint"));
    }

    #[test]
    fn reauthorization_uses_the_issued_client_and_hints() {
        let record = Record {
            host_id: "urn:uuid:h".into(),
            client_id: Some("oaiapp_1".into()),
            email: Some("a@b.c".into()),
            id_token: Some("old.id.token".into()),
            ..Record::default()
        };
        let url = authorize_url(
            &endpoints(),
            &record,
            "http://127.0.0.1:9/auth/callback",
            &attempt(),
        );
        let q = parse_query(url.split_once('?').unwrap().1);
        assert_eq!(q["client_id"], "oaiapp_1");
        assert!(!q.contains_key("agent_name_hint"));
        assert_eq!(q["id_token_hint"], "old.id.token");
        assert_eq!(q["login_hint"], "a@b.c");
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:h");
    }

    fn id_token(claims: Value) -> String {
        format!(
            "{}.{}.sig",
            base64url(br#"{"alg":"RS256"}"#),
            base64url(claims.to_string().as_bytes())
        )
    }

    #[test]
    fn id_tokens_need_issuer_audience_expiry_and_nonce() {
        let good = serde_json::json!({
            "iss": "https://auth.openai.com", "aud": "oaiapp_1", "exp": 2000,
            "nonce": "no", "sub": "user-1", "email": "a@b.c"
        });
        let claims = validate_id_token(&id_token(good.clone()), "oaiapp_1", "no", 1000).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.email.as_deref(), Some("a@b.c"));
        let mut list = good.clone();
        list["aud"] = serde_json::json!(["x", "oaiapp_1"]);
        assert!(validate_id_token(&id_token(list), "oaiapp_1", "no", 1000).is_ok());
        for (field, value) in [
            ("iss", serde_json::json!("https://evil.example")),
            ("aud", serde_json::json!("oaiapp_2")),
            ("exp", serde_json::json!(999)),
            ("nonce", serde_json::json!("other")),
            ("sub", serde_json::json!("")),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert!(
                validate_id_token(&id_token(bad), "oaiapp_1", "no", 1000).is_err(),
                "{field} must be checked"
            );
        }
        assert!(validate_id_token("not-a-jwt", "oaiapp_1", "no", 1000).is_err());
    }

    #[test]
    fn issued_client_ids_are_checked() {
        assert!(valid_client_id("oaiapp_AbC-1.2"));
        assert!(!valid_client_id("dynamic_agent_client"));
        assert!(!valid_client_id(""));
        assert!(!valid_client_id("a b"));
        assert!(!valid_client_id(&"a".repeat(129)));
    }

    #[test]
    fn the_stream_succeeds_only_on_a_terminal_event() {
        let completed = "event: response.created\ndata: {\"type\":\"response.created\"}\n\nevent: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n";
        assert_eq!(stream_response(completed).unwrap()["status"], "completed");
        let crlf = completed.replace('\n', "\r\n");
        assert_eq!(stream_response(&crlf).unwrap()["status"], "completed");
        let incomplete =
            "data: {\"type\":\"response.incomplete\",\"response\":{\"status\":\"incomplete\"}}\n";
        assert_eq!(stream_response(incomplete).unwrap()["status"], "incomplete");
        let cut = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\n";
        assert_eq!(stream_response(cut).unwrap_err().kind, AiErrorKind::Network);
        let failed = "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n";
        let err = stream_response(failed).unwrap_err();
        assert_eq!(err.kind, AiErrorKind::RateLimit);
        assert!(err.message.contains("https://chatgpt.com/settings/usage"));
    }

    #[test]
    fn structured_errors_get_their_own_messages() {
        let body = |code: &str| format!(r#"{{"error":{{"code":"{code}","param":"tools"}}}}"#);
        assert_eq!(
            status_error(429, &body("subscription_sharing_usage_limit_exceeded")).kind,
            AiErrorKind::RateLimit
        );
        assert_eq!(
            status_error(503, &body("subscription_sharing_usage_unavailable")).kind,
            AiErrorKind::Network
        );
        assert_eq!(
            status_error(403, &body("subscription_sharing_user_not_eligible")).kind,
            AiErrorKind::Config
        );
        let unsupported = status_error(400, &body("subscription_sharing_unsupported_capability"));
        assert!(unsupported.message.contains("\"tools\""));
        assert_eq!(
            status_error(401, &body("subscription_sharing_invalid_user")).kind,
            AiErrorKind::Auth
        );
        assert_eq!(status_error(401, "{}").kind, AiErrorKind::Auth);
        assert_eq!(status_error(502, "oops").kind, AiErrorKind::Network);
        assert_eq!(status_error(404, "{}").kind, AiErrorKind::Config);
    }

    #[test]
    fn models_keep_listed_ones_in_server_order() {
        let value = serde_json::json!({"models": [
            {"slug": "b", "display_name": "B", "visibility": "list"},
            {"slug": "hidden", "visibility": "hide"},
            {"slug": "a", "visibility": "list"}
        ]});
        assert_eq!(
            parse_models(&value).unwrap(),
            vec![("b".into(), Some("B".into())), ("a".into(), None)]
        );
        assert!(parse_models(&serde_json::json!({"data": []})).is_none());
    }

    #[test]
    fn the_record_debug_output_has_no_tokens() {
        let record = Record {
            access_token: Some("secret-access".into()),
            refresh_token: Some("secret-refresh".into()),
            id_token: Some("secret-id".into()),
            ..Record::default()
        };
        let debug = format!("{record:?}");
        assert!(!debug.contains("secret"));
    }

    #[test]
    fn origins_compare_scheme_host_and_port() {
        assert_eq!(
            origin("https://auth.openai.com/oauth/revoke"),
            Some("https://auth.openai.com")
        );
        assert_eq!(origin("http://127.0.0.1:9/x"), Some("http://127.0.0.1:9"));
        assert_eq!(
            origin("https://auth.openai.com"),
            Some("https://auth.openai.com")
        );
        assert_eq!(origin("nope"), None);
    }
}
