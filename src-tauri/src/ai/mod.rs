//! AI command suggestions: inline completion of the typed line and the on-demand assistant.
//!
//! The frontend passes the provider settings on every call; API keys live only in the
//! system keyring (account `ai:<provider>`) and never go back to the frontend, into
//! errors, or into `Debug` output. Nothing returned here is ever executed: the frontend
//! only shows or types it, and every command text is reduced to one line without control
//! characters first.

mod providers;
#[cfg(test)]
mod tests;
mod text;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::secrets::{self, SecretError, SharedSecrets};

/// The AI services PlexusTerm can talk to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Provider {
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "openai")]
    OpenAi,
    /// Any server implementing OpenAI Chat Completions (Ollama, LM Studio, OpenRouter...).
    #[serde(rename = "openai-compatible")]
    OpenAiCompatible,
}

impl Provider {
    pub fn parse(id: &str) -> Result<Self, AiError> {
        match id {
            "anthropic" => Ok(Self::Anthropic),
            "gemini" => Ok(Self::Gemini),
            "openai" => Ok(Self::OpenAi),
            "openai-compatible" => Ok(Self::OpenAiCompatible),
            other => Err(AiError::config(format!("Unknown AI provider \"{other}\"."))),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Gemini => "gemini",
            Self::OpenAi => "openai",
            Self::OpenAiCompatible => "openai-compatible",
        }
    }

    /// Name used in user-facing messages.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::Gemini => "Gemini",
            Self::OpenAi => "OpenAI",
            Self::OpenAiCompatible => "The OpenAI-compatible server",
        }
    }

    /// Local servers (Ollama, LM Studio) usually need no key.
    pub fn requires_key(self) -> bool {
        self != Self::OpenAiCompatible
    }

    /// Keyring account holding this provider's API key.
    pub fn key_account(self) -> String {
        format!("ai:{}", self.id())
    }
}

/// Provider settings sent by the frontend with every request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub provider: Provider,
    /// Only used by `openai-compatible` (required there), e.g. `http://localhost:11434/v1`.
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
}

/// Context for completing the line being typed. Terminal output is never sent.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRequest {
    pub line: String,
    pub os: String,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub history: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResponse {
    /// Text to append after the typed line; empty when there is no useful completion.
    pub completion: String,
}

/// What the user asked the assistant for, with optional terminal selection.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequest {
    pub prompt: String,
    #[serde(default)]
    pub selection: Option<String>,
    pub os: String,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub history: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistResponse {
    /// One single-line command (may be empty when the request has no command answer).
    pub command: String,
    pub explanation: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AiErrorKind {
    NoKey,
    Auth,
    RateLimit,
    Network,
    Timeout,
    Refused,
    BadResponse,
    Config,
}

/// Serialized as `{ kind, message }`; the message is meant for the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AiError {
    pub kind: AiErrorKind,
    pub message: String,
}

impl AiError {
    pub fn new(kind: AiErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn config(message: impl Into<String>) -> Self {
        Self::new(AiErrorKind::Config, message)
    }

    pub fn bad_response(provider: Provider) -> Self {
        Self::new(
            AiErrorKind::BadResponse,
            format!(
                "{} sent an answer PlexusTerm could not read.",
                provider.display_name()
            ),
        )
    }

    fn refused(provider: Provider) -> Self {
        Self::new(
            AiErrorKind::Refused,
            format!(
                "{} declined to answer this request.",
                provider.display_name()
            ),
        )
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AiError {}

fn keyring_error(err: SecretError) -> AiError {
    AiError::config(format!("Could not use the system keyring: {err}."))
}

/// An API key read from the keyring; its bytes never show up in `Debug` output.
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    #[cfg(test)]
    pub fn new(key: impl Into<String>) -> Self {
        Self(key.into())
    }

    fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ApiKey(***)")
    }
}

/// Endpoints of the hosted providers; tests point them at a local mock server.
#[derive(Debug, Clone)]
pub struct Endpoints {
    /// Full Messages API URL.
    pub anthropic: String,
    /// API root; `/models/{model}:generateContent` is appended.
    pub gemini: String,
    /// Full Chat Completions URL.
    pub openai: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            anthropic: "https://api.anthropic.com/v1/messages".into(),
            gemini: "https://generativelanguage.googleapis.com/v1beta".into(),
            openai: "https://api.openai.com/v1/chat/completions".into(),
        }
    }
}

/// Shared HTTP client and limits (Tauri managed state).
pub struct AiClient {
    http: reqwest::Client,
    endpoints: Endpoints,
    complete_timeout: Duration,
    assist_timeout: Duration,
}

impl Default for AiClient {
    fn default() -> Self {
        let http = build_http().unwrap_or_else(|_| reqwest::Client::new());
        Self::new(http, Endpoints::default())
    }
}

fn build_http() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("PlexusTerm/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(5))
        .build()
}

/// Which of the two features a request serves; it picks budgets and timeouts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Task {
    Complete,
    Assist,
}

impl AiClient {
    pub fn new(http: reqwest::Client, endpoints: Endpoints) -> Self {
        Self {
            http,
            endpoints,
            complete_timeout: Duration::from_secs(8),
            assist_timeout: Duration::from_secs(60),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_timeouts(mut self, complete: Duration, assist: Duration) -> Self {
        self.complete_timeout = complete;
        self.assist_timeout = assist;
        self
    }

    pub async fn complete(
        &self,
        secrets: &SharedSecrets,
        config: &AiConfig,
        request: &CompleteRequest,
    ) -> Result<CompleteResponse, AiError> {
        if request.line.trim().is_empty() {
            return Ok(CompleteResponse {
                completion: String::new(),
            });
        }
        let user = text::complete_prompt(request);
        let completion = match self
            .call(
                secrets,
                config,
                Task::Complete,
                text::COMPLETE_SYSTEM,
                &user,
            )
            .await?
        {
            providers::Reply::Text(reply) => text::clean_completion(&request.line, &reply),
            providers::Reply::Truncated => String::new(),
            providers::Reply::Refused => return Err(AiError::refused(config.provider)),
        };
        Ok(CompleteResponse { completion })
    }

    pub async fn assist(
        &self,
        secrets: &SharedSecrets,
        config: &AiConfig,
        request: &AssistRequest,
    ) -> Result<AssistResponse, AiError> {
        if request.prompt.trim().is_empty() {
            return Err(AiError::config("Describe what you want to do."));
        }
        let user = text::assist_prompt(request);
        match self
            .call(secrets, config, Task::Assist, text::ASSIST_SYSTEM, &user)
            .await?
        {
            providers::Reply::Text(reply) => text::parse_assist(&reply)
                .map(|(command, explanation)| AssistResponse {
                    command,
                    explanation,
                })
                .ok_or_else(|| AiError::bad_response(config.provider)),
            providers::Reply::Truncated => Err(AiError::new(
                AiErrorKind::BadResponse,
                format!(
                    "The answer from {} was cut off.",
                    config.provider.display_name()
                ),
            )),
            providers::Reply::Refused => Err(AiError::refused(config.provider)),
        }
    }

    async fn call(
        &self,
        secrets: &SharedSecrets,
        config: &AiConfig,
        task: Task,
        system: &str,
        user: &str,
    ) -> Result<providers::Reply, AiError> {
        let provider = config.provider;
        let key = load_key(secrets, provider).await?;
        if provider.requires_key() && key.is_none() {
            return Err(AiError::new(
                AiErrorKind::NoKey,
                format!(
                    "No {} API key is saved. Add one in Settings > AI.",
                    provider.display_name()
                ),
            ));
        }
        let call = providers::build(&self.endpoints, config, key.as_ref(), task, system, user)?;
        let timeout = match task {
            Task::Complete => self.complete_timeout,
            Task::Assist => self.assist_timeout,
        };
        let mut builder = self.http.post(&call.url).timeout(timeout).json(&call.body);
        for (name, value) in &call.headers {
            builder = builder.header(*name, value);
        }
        let response = builder
            .send()
            .await
            .map_err(|err| transport_error(provider, err))?;
        let status = response.status().as_u16();
        let body = response
            .text()
            .await
            .map_err(|err| transport_error(provider, err))?;
        if !(200..300).contains(&status) {
            return Err(status_error(provider, status, &body, key.as_ref()));
        }
        let value: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| AiError::bad_response(provider))?;
        providers::parse(provider, &value)
    }
}

/// Reads the provider's key; a missing keyring only matters for providers that need a key.
async fn load_key(secrets: &SharedSecrets, provider: Provider) -> Result<Option<ApiKey>, AiError> {
    let account = provider.key_account();
    let found = secrets::run(secrets, move |s| {
        if s.available() {
            s.get(&account)
        } else {
            Ok(None)
        }
    })
    .await;
    match found {
        Ok(key) => Ok(key.filter(|k| !k.is_empty()).map(ApiKey)),
        Err(_) if !provider.requires_key() => Ok(None),
        Err(err) => Err(keyring_error(err)),
    }
}

fn transport_error(provider: Provider, err: reqwest::Error) -> AiError {
    if err.is_timeout() {
        return AiError::new(
            AiErrorKind::Timeout,
            format!("{} did not answer in time.", provider.display_name()),
        );
    }
    AiError::new(
        AiErrorKind::Network,
        format!(
            "Could not reach {}: {}.",
            provider.display_name(),
            err.without_url()
        ),
    )
}

/// Maps a non-2xx answer; the provider's own message is kept only when it cannot carry the key.
fn status_error(provider: Provider, status: u16, body: &str, key: Option<&ApiKey>) -> AiError {
    let name = provider.display_name();
    let detail = text::error_detail(body, key.map(ApiKey::expose));
    let gemini_bad_key = provider == Provider::Gemini
        && status == 400
        && (body.contains("API_KEY_INVALID") || body.contains("API key not valid"));
    match status {
        401 | 403 => auth_error(name),
        _ if gemini_bad_key => auth_error(name),
        429 => AiError::new(
            AiErrorKind::RateLimit,
            format!("{name} is limiting requests; try again in a moment."),
        ),
        500..=599 => AiError::new(
            AiErrorKind::Network,
            format!("{name} is unavailable right now (HTTP {status})."),
        ),
        400 | 404 | 422 => AiError::config(match detail {
            Some(detail) => format!("{name} rejected the request (HTTP {status}): {detail}"),
            None => format!("{name} rejected the request (HTTP {status}). Check the model name."),
        }),
        _ => AiError::new(
            AiErrorKind::BadResponse,
            format!("{name} answered with HTTP {status}."),
        ),
    }
}

fn auth_error(name: &str) -> AiError {
    AiError::new(
        AiErrorKind::Auth,
        format!("The {name} API key was rejected. Check it in Settings > AI."),
    )
}

pub async fn key_status(secrets: &SharedSecrets, provider: &str) -> Result<bool, AiError> {
    let account = Provider::parse(provider)?.key_account();
    secrets::run(secrets, move |s| {
        Ok(s.available() && s.get(&account)?.is_some_and(|k| !k.is_empty()))
    })
    .await
    .map_err(keyring_error)
}

pub async fn key_save(secrets: &SharedSecrets, provider: &str, key: String) -> Result<(), AiError> {
    let provider = Provider::parse(provider)?;
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err(AiError::config("Enter an API key."));
    }
    let account = provider.key_account();
    let label = format!("PlexusTerm AI key ({})", provider.display_name());
    secrets::run(secrets, move |s| s.set(&account, &label, &key))
        .await
        .map_err(keyring_error)
}

pub async fn key_delete(secrets: &SharedSecrets, provider: &str) -> Result<(), AiError> {
    let account = Provider::parse(provider)?.key_account();
    secrets::run(secrets, move |s| s.delete(&account))
        .await
        .map_err(keyring_error)
}

/// Whether an API key is saved for `provider`; the key itself never leaves the backend.
#[tauri::command]
pub async fn ai_key_status(
    provider: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<bool, AiError> {
    key_status(secrets.inner(), &provider).await
}

#[tauri::command]
pub async fn ai_key_save(
    provider: String,
    key: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<(), AiError> {
    key_save(secrets.inner(), &provider, key).await
}

#[tauri::command]
pub async fn ai_key_delete(
    provider: String,
    secrets: State<'_, SharedSecrets>,
) -> Result<(), AiError> {
    key_delete(secrets.inner(), &provider).await
}

/// Completes the typed line; returns only the text to append.
#[tauri::command]
pub async fn ai_complete(
    config: AiConfig,
    request: CompleteRequest,
    ai: State<'_, AiClient>,
    secrets: State<'_, SharedSecrets>,
) -> Result<CompleteResponse, AiError> {
    ai.complete(secrets.inner(), &config, &request).await
}

/// Suggests one command for a natural-language request; never runs anything.
#[tauri::command]
pub async fn ai_assist(
    config: AiConfig,
    request: AssistRequest,
    ai: State<'_, AiClient>,
    secrets: State<'_, SharedSecrets>,
) -> Result<AssistResponse, AiError> {
    ai.assist(secrets.inner(), &config, &request).await
}
