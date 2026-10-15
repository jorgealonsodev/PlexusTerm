//! Request shapes and answer parsing for each provider.

use serde_json::{Value, json};

use super::{AiConfig, AiError, ApiKey, Endpoints, Provider, Task};

/// One HTTP request ready to send.
pub struct Call {
    pub url: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Value,
}

/// What a successful (2xx) answer contained.
#[derive(Debug, PartialEq, Eq)]
pub enum Reply {
    Text(String),
    /// The model declined (safety refusal, blocked prompt).
    Refused,
    /// The token limit cut the answer off.
    Truncated,
}

/// Anthropic Messages API version header value.
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Beta that enables `fallbacks: "default"` (server-side retry on a recommended model).
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Output budgets. Thinking counts toward Anthropic's `max_tokens`, so it gets more room.
fn max_tokens(provider: Provider, task: Task) -> u32 {
    match (task, provider) {
        (Task::Complete, Provider::Anthropic) => 2048,
        (Task::Complete, _) => 1024,
        (Task::Assist, _) => 8192,
    }
}

/// Older Claude models reject `output_config` (effort and structured outputs).
fn anthropic_supports_output_config(model: &str) -> bool {
    const LEGACY: [&str; 7] = [
        "claude-3",
        "claude-haiku-4",
        "claude-sonnet-4-0",
        "claude-sonnet-4-2",
        "claude-sonnet-4-5",
        "claude-opus-4-0",
        "claude-opus-4-1",
    ];
    !LEGACY.iter().any(|prefix| model.starts_with(prefix))
}

/// `fallbacks: "default"` is sent only to the Claude Opus 5.5 family.
fn anthropic_uses_default_fallbacks(model: &str) -> bool {
    model == "claude-opus-5-5" || model.starts_with("claude-opus-5-5-")
}

fn assist_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "One shell command line, or empty."},
            "explanation": {"type": "string", "description": "One or two short sentences."}
        },
        "required": ["command", "explanation"],
        "additionalProperties": false
    })
}

/// `base_url` of an OpenAI-compatible server (`http(s)://host[:port]/path`), without trailing `/`.
fn compatible_url(base_url: Option<&str>) -> Result<String, AiError> {
    let base = base_url.map(str::trim).unwrap_or_default();
    if base.is_empty() {
        return Err(AiError::config(
            "Enter the base URL of the OpenAI-compatible server (for example http://localhost:11434/v1).",
        ));
    }
    let invalid = || AiError::config(format!("\"{base}\" is not a valid http(s) base URL."));
    let url = reqwest::Url::parse(base).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none_or(str::is_empty) {
        return Err(invalid());
    }
    Ok(format!("{}/chat/completions", base.trim_end_matches('/')))
}

/// Gemini puts the model in the URL path, so only plain model codes are accepted.
fn gemini_model(model: &str) -> Result<&str, AiError> {
    let model = model.strip_prefix("models/").unwrap_or(model);
    let valid = model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if valid && !model.starts_with('.') {
        Ok(model)
    } else {
        Err(AiError::config(format!(
            "\"{model}\" is not a valid Gemini model name."
        )))
    }
}

pub fn build(
    endpoints: &Endpoints,
    config: &AiConfig,
    key: Option<&ApiKey>,
    task: Task,
    system: &str,
    user: &str,
) -> Result<Call, AiError> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err(AiError::config("Choose a model in Settings > AI."));
    }
    let provider = config.provider;
    let limit = max_tokens(provider, task);
    let mut headers: Vec<(&'static str, String)> = Vec::new();
    let call = match provider {
        Provider::Anthropic => {
            if let Some(key) = key {
                headers.push(("x-api-key", key.expose().to_string()));
            }
            headers.push(("anthropic-version", ANTHROPIC_VERSION.to_string()));
            let mut body = json!({
                "model": model,
                "max_tokens": limit,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            });
            if anthropic_supports_output_config(model) {
                let mut output = json!({
                    "effort": match task { Task::Complete => "low", Task::Assist => "medium" },
                });
                if task == Task::Assist {
                    output["format"] = json!({"type": "json_schema", "schema": assist_schema()});
                }
                body["output_config"] = output;
            }
            if anthropic_uses_default_fallbacks(model) {
                body["fallbacks"] = json!("default");
                headers.push(("anthropic-beta", FALLBACK_BETA.to_string()));
            }
            Call {
                url: endpoints.anthropic.clone(),
                headers,
                body,
            }
        }
        Provider::Gemini => {
            let model = gemini_model(model)?;
            if let Some(key) = key {
                headers.push(("x-goog-api-key", key.expose().to_string()));
            }
            let mut generation = json!({"maxOutputTokens": limit});
            if task == Task::Assist {
                generation["responseMimeType"] = json!("application/json");
                generation["responseSchema"] = json!({
                    "type": "OBJECT",
                    "properties": {"command": {"type": "STRING"}, "explanation": {"type": "STRING"}},
                    "required": ["command", "explanation"]
                });
            }
            Call {
                url: format!(
                    "{}/models/{model}:generateContent",
                    endpoints.gemini.trim_end_matches('/')
                ),
                headers,
                body: json!({
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                    "generationConfig": generation,
                }),
            }
        }
        Provider::OpenAi | Provider::OpenAiCompatible => {
            let url = if provider == Provider::OpenAi {
                endpoints.openai.clone()
            } else {
                compatible_url(config.base_url.as_deref())?
            };
            if let Some(key) = key {
                headers.push(("authorization", format!("Bearer {}", key.expose())));
            }
            let mut body = json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            });
            if provider == Provider::OpenAi {
                // OpenAI deprecated `max_tokens` (reasoning models reject it).
                body["max_completion_tokens"] = json!(limit);
                if task == Task::Assist {
                    body["response_format"] = json!({
                        "type": "json_schema",
                        "json_schema": {"name": "command_suggestion", "strict": true, "schema": assist_schema()}
                    });
                }
            } else {
                // Ollama and LM Studio implement `max_tokens`; JSON is asked for in the prompt.
                body["max_tokens"] = json!(limit);
            }
            Call { url, headers, body }
        }
    };
    Ok(call)
}

fn anthropic_reply(body: &Value) -> Option<Reply> {
    match body["stop_reason"].as_str() {
        Some("refusal") => return Some(Reply::Refused),
        Some("max_tokens") => return Some(Reply::Truncated),
        _ => {}
    }
    let text: String = body["content"]
        .as_array()?
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    Some(Reply::Text(text))
}

fn gemini_reply(body: &Value) -> Option<Reply> {
    const BLOCKED: [&str; 6] = [
        "SAFETY",
        "RECITATION",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
        "IMAGE_SAFETY",
    ];
    let candidate = body["candidates"].as_array().and_then(|c| c.first());
    let Some(candidate) = candidate else {
        return body["promptFeedback"]["blockReason"]
            .is_string()
            .then_some(Reply::Refused);
    };
    let finish = candidate["finishReason"].as_str().unwrap_or_default();
    if BLOCKED.contains(&finish) {
        return Some(Reply::Refused);
    }
    if finish == "MAX_TOKENS" {
        return Some(Reply::Truncated);
    }
    let text: String = candidate["content"]["parts"]
        .as_array()?
        .iter()
        .filter(|part| part["thought"] != true)
        .filter_map(|part| part["text"].as_str())
        .collect();
    Some(Reply::Text(text))
}

fn openai_reply(body: &Value) -> Option<Reply> {
    let choice = body["choices"].as_array()?.first()?;
    let message = &choice["message"];
    let refused = message["refusal"].as_str().is_some_and(|r| !r.is_empty());
    match choice["finish_reason"].as_str() {
        _ if refused => return Some(Reply::Refused),
        Some("content_filter") => return Some(Reply::Refused),
        Some("length") => return Some(Reply::Truncated),
        _ => {}
    }
    let text = match &message["content"] {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
        _ => return None,
    };
    Some(Reply::Text(text))
}

pub fn parse(provider: Provider, body: &Value) -> Result<Reply, AiError> {
    let reply = match provider {
        Provider::Anthropic => anthropic_reply(body),
        Provider::Gemini => gemini_reply(body),
        Provider::OpenAi | Provider::OpenAiCompatible => openai_reply(body),
    };
    reply.ok_or_else(|| AiError::bad_response(provider))
}
