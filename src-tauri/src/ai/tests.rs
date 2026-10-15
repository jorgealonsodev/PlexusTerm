//! Provider round trips against a local mock HTTP server (no network).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::*;
use crate::secrets::{MemoryStore, NoStore, SecretStore};

const KEY: &str = "sk-test-0123456789";
const SESSION: &str = "3f2b6c1e-8d4a-4e1b-9c2f-0a1b2c3d4e5f";
const USER_AGENT: &str = concat!("PlexusTerm/", env!("CARGO_PKG_VERSION"));

/// One request as the mock server received it.
#[derive(Debug)]
struct Seen {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Value,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).map(String::as_str)
    }
}

/// Reads one HTTP/1.1 request (head and JSON body) from `socket`.
async fn read_seen(socket: &mut tokio::net::TcpStream) -> Seen {
    let mut raw = Vec::new();
    let mut buf = [0u8; 4096];
    let head_end = loop {
        let n = socket.read(&mut buf).await.unwrap();
        assert!(n > 0, "client closed early");
        raw.extend_from_slice(&buf[..n]);
        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut start = lines.next().unwrap().split(' ');
    let method = start.next().unwrap().to_string();
    let path = start.next().unwrap().to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .map(|v| v.parse().unwrap())
        .unwrap_or(0);
    while raw.len() < head_end + length {
        let n = socket.read(&mut buf).await.unwrap();
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
    }
    let body = serde_json::from_slice(&raw[head_end..]).unwrap_or(Value::Null);
    Seen {
        method,
        path,
        headers,
        body,
    }
}

async fn respond(socket: &mut tokio::net::TcpStream, status: u16, extra: &str, payload: &str) {
    let response = format!(
        "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n{payload}",
        payload.len()
    );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;
}

/// Answers one request with `status` and `reply` after `delay`; returns the base URL.
async fn mock(status: u16, reply: Value, delay: Duration) -> (String, oneshot::Receiver<Seen>) {
    mock_with(status, "", reply, delay).await
}

/// Like `mock`, with extra raw response header lines (each ending in `\r\n`).
async fn mock_with(
    status: u16,
    extra: &'static str,
    reply: Value,
    delay: Duration,
) -> (String, oneshot::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let seen = read_seen(&mut socket).await;
        let _ = tx.send(seen);
        tokio::time::sleep(delay).await;
        respond(&mut socket, status, extra, &reply.to_string()).await;
    });
    (base, rx)
}

type Log = Arc<std::sync::Mutex<Vec<Seen>>>;

/// Serves any number of requests by path (`(path, status, body)`; unknown paths get 404).
async fn mock_routes(routes: Vec<(&'static str, u16, String)>) -> (String, Log) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let log: Log = Arc::default();
    let seen_log = log.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let seen = read_seen(&mut socket).await;
            let route = routes
                .iter()
                .find(|(path, _, _)| *path == seen.path)
                .cloned();
            seen_log.lock().unwrap().push(seen);
            let (status, body) = route.map_or((404, "{}".to_string()), |(_, s, b)| (s, b));
            respond(&mut socket, status, "", &body).await;
        }
    });
    (base, log)
}

fn endpoints(base: &str) -> Endpoints {
    Endpoints {
        anthropic: format!("{base}/v1/messages"),
        gemini: format!("{base}/v1beta"),
        openai: format!("{base}/v1/chat/completions"),
        opencode_go: format!("{base}/inference/go/v1"),
        models_dev: format!("{base}/api.json"),
    }
}

/// The production HTTP client (user agent, no redirects) against the mock endpoints.
fn client(base: &str) -> AiClient {
    AiClient::new(build_http().unwrap(), endpoints(base))
}

fn prompt() -> providers::Prompt<'static> {
    providers::Prompt {
        task: Task::Complete,
        system: "s",
        turns: &[],
        user: "u",
    }
}

fn store_with(provider: Provider, key: Option<&str>) -> SharedSecrets {
    let store = MemoryStore::shared();
    if let Some(key) = key {
        store.set(&provider.key_account(), "label", key).unwrap();
    }
    store
}

fn config(provider: Provider, model: &str) -> AiConfig {
    AiConfig {
        provider,
        base_url: None,
        model: model.into(),
        session_id: Some(SESSION.into()),
    }
}

fn line(text: &str) -> CompleteRequest {
    CompleteRequest {
        line: text.into(),
        os: "linux".into(),
        shell: Some("bash".into()),
        cwd: Some("/srv".into()),
        history: vec!["git status".into()],
    }
}

fn ask(prompt: &str) -> AssistRequest {
    AssistRequest {
        prompt: prompt.into(),
        os: "linux".into(),
        ..Default::default()
    }
}

fn anthropic_text(text: &str, stop: &str) -> Value {
    json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": [{"type": "thinking", "thinking": "", "signature": "x"}, {"type": "text", "text": text}],
        "stop_reason": stop, "usage": {"input_tokens": 10, "output_tokens": 5}
    })
}

fn gemini_text(text: &str, finish: &str) -> Value {
    json!({
        "candidates": [{"content": {"role": "model", "parts": [
            {"text": "thinking...", "thought": true}, {"text": text}
        ]}, "finishReason": finish, "index": 0}],
        "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 4, "totalTokenCount": 14},
        "modelVersion": "gemini-3.5-flash-lite"
    })
}

fn openai_text(text: &str, finish: &str) -> Value {
    json!({
        "id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "gpt-x",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text, "refusal": null},
                     "logprobs": null, "finish_reason": finish}],
        "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}
    })
}

const ASSIST_JSON: &str = r#"{"answer": "Shows free disk space.", "command": "df -h"}"#;
/// A general answer with no command (S8).
const ANSWER_ONLY_JSON: &str = r#"{"answer": "¡Hola! ¿En qué te ayudo?", "command": null}"#;

// --- Anthropic ---------------------------------------------------------------------------

#[tokio::test]
async fn anthropic_completion_request_and_answer() {
    let (base, seen) = mock(
        200,
        anthropic_text("git commit -m \"wip\"", "end_turn"),
        Duration::ZERO,
    )
    .await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let got = client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("git comm"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "it -m \"wip\"");

    let seen = seen.await.unwrap();
    assert_eq!(seen.method, "POST");
    assert_eq!(seen.path, "/v1/messages");
    assert_eq!(seen.header("x-api-key"), Some(KEY));
    assert_eq!(seen.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(
        seen.header("anthropic-beta"),
        Some("server-side-fallback-2026-07-01")
    );
    assert_eq!(seen.header("content-type"), Some("application/json"));
    assert_eq!(seen.header("authorization"), None);
    let body = &seen.body;
    assert_eq!(body["model"], "claude-opus-5-5");
    assert_eq!(body["max_tokens"], 2048);
    assert_eq!(body["output_config"]["effort"], "low");
    assert!(body["output_config"].get("format").is_none(), "{body}");
    assert_eq!(body["fallbacks"], "default");
    assert!(body.get("thinking").is_none(), "{body}");
    assert!(body.get("tool_choice").is_none(), "{body}");
    assert!(body.get("tools").is_none(), "{body}");
    assert_eq!(body["system"], text::COMPLETE_SYSTEM);
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1, "no assistant prefill: {body}");
    assert_eq!(messages[0]["role"], "user");
    let user = messages[0]["content"].as_str().unwrap();
    assert!(user.contains(r#"Typed so far: "git comm""#), "{user}");
    assert!(user.contains("git status"), "{user}");
    assert!(user.contains("/srv"), "{user}");
}

#[tokio::test]
async fn anthropic_fallbacks_only_for_claude_opus_5_5() {
    let (base, seen) = mock(200, anthropic_text("ls -la", "end_turn"), Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-haiku-5-5"),
            &line("ls"),
        )
        .await
        .unwrap();
    let seen = seen.await.unwrap();
    assert_eq!(seen.header("anthropic-beta"), None);
    assert!(seen.body.get("fallbacks").is_none(), "{}", seen.body);
    assert_eq!(seen.body["model"], "claude-haiku-5-5");
    assert_eq!(seen.body["output_config"]["effort"], "low");
}

#[tokio::test]
async fn anthropic_assist_request_and_answer() {
    let (base, seen) = mock(200, anthropic_text(ASSIST_JSON, "end_turn"), Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let got = client(&base)
        .assist(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &ask("free space?"),
        )
        .await
        .unwrap();
    assert_eq!(
        got,
        AssistResponse {
            answer: "Shows free disk space.".into(),
            command: Some("df -h".into()),
        }
    );
    let body = seen.await.unwrap().body;
    assert_eq!(body["max_tokens"], 16000);
    assert_eq!(body["output_config"]["effort"], "medium");
    assert_eq!(body["output_config"]["format"]["type"], "json_schema");
    let schema = &body["output_config"]["format"]["schema"];
    assert_eq!(schema["required"], json!(["answer", "command"]));
    assert_eq!(schema["properties"]["answer"]["type"], "string");
    assert_eq!(
        schema["properties"]["command"]["anyOf"],
        json!([{"type": "string"}, {"type": "null"}])
    );
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(body["system"], text::ASSIST_SYSTEM);
    assert_eq!(body["fallbacks"], "default");
}

#[tokio::test]
async fn anthropic_refusal_is_refused() {
    let reply = json!({"type": "message", "content": [], "stop_reason": "refusal",
                       "stop_details": {"category": "cyber"}});
    let (base, _seen) = mock(200, reply, Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let err = client(&base)
        .assist(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &ask("x"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Refused);
}

#[tokio::test]
async fn anthropic_max_tokens_gives_no_completion() {
    let (base, _seen) = mock(200, anthropic_text("ls -l", "max_tokens"), Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let got = client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("ls"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "");
}

// --- Gemini ------------------------------------------------------------------------------

#[tokio::test]
async fn gemini_completion_request_and_answer() {
    let (base, seen) = mock(
        200,
        gemini_text("docker compose up -d", "STOP"),
        Duration::ZERO,
    )
    .await;
    let store = store_with(Provider::Gemini, Some(KEY));
    let got = client(&base)
        .complete(
            &store,
            &config(Provider::Gemini, "gemini-3.5-flash-lite"),
            &line("docker comp"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "ose up -d");
    let seen = seen.await.unwrap();
    assert_eq!(
        seen.path,
        "/v1beta/models/gemini-3.5-flash-lite:generateContent"
    );
    assert_eq!(seen.header("x-goog-api-key"), Some(KEY));
    assert_eq!(seen.header("authorization"), None);
    assert!(!seen.path.contains("key="), "key must not be in the URL");
    let body = &seen.body;
    assert_eq!(
        body["systemInstruction"]["parts"][0]["text"],
        text::COMPLETE_SYSTEM
    );
    assert_eq!(body["contents"][0]["role"], "user");
    let user = body["contents"][0]["parts"][0]["text"].as_str().unwrap();
    assert!(user.contains(r#"Typed so far: "docker comp""#), "{user}");
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 1024);
    assert!(
        body["generationConfig"].get("responseMimeType").is_none(),
        "{body}"
    );
}

#[tokio::test]
async fn gemini_assist_asks_for_json() {
    let (base, seen) = mock(200, gemini_text(ASSIST_JSON, "STOP"), Duration::ZERO).await;
    let store = store_with(Provider::Gemini, Some(KEY));
    let got = client(&base)
        .assist(
            &store,
            &config(Provider::Gemini, "gemini-3.5-flash-lite"),
            &ask("disk"),
        )
        .await
        .unwrap();
    assert_eq!(got.command.as_deref(), Some("df -h"));
    let body = seen.await.unwrap().body;
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 8192);
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    let schema = &body["generationConfig"]["responseSchema"];
    assert_eq!(schema["required"], json!(["answer"]));
    assert_eq!(schema["properties"]["answer"]["type"], "STRING");
    assert_eq!(schema["properties"]["command"]["type"], "STRING");
    assert_eq!(schema["properties"]["command"]["nullable"], true);
}

#[tokio::test]
async fn gemini_blocked_prompt_and_safety_stop_are_refused() {
    let blocked = json!({"promptFeedback": {"blockReason": "SAFETY"}});
    let (base, _seen) = mock(200, blocked, Duration::ZERO).await;
    let store = store_with(Provider::Gemini, Some(KEY));
    let err = client(&base)
        .assist(
            &store,
            &config(Provider::Gemini, "gemini-3.5-flash-lite"),
            &ask("x"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Refused);

    let (base, _seen) = mock(200, gemini_text("", "SAFETY"), Duration::ZERO).await;
    let err = client(&base)
        .complete(
            &store,
            &config(Provider::Gemini, "gemini-3.5-flash-lite"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Refused);
}

#[tokio::test]
async fn gemini_invalid_key_is_auth() {
    let reply = json!({"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.",
        "status": "INVALID_ARGUMENT", "details": [{"reason": "API_KEY_INVALID"}]}});
    let (base, _seen) = mock(400, reply, Duration::ZERO).await;
    let store = store_with(Provider::Gemini, Some(KEY));
    let err = client(&base)
        .complete(
            &store,
            &config(Provider::Gemini, "gemini-3.5-flash-lite"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Auth);
}

#[tokio::test]
async fn gemini_model_names_must_be_path_safe() {
    let store = store_with(Provider::Gemini, Some(KEY));
    let err = client("http://127.0.0.1:9")
        .complete(
            &store,
            &config(Provider::Gemini, "../evil?x=1"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
}

// --- OpenAI and compatible servers -------------------------------------------------------

#[tokio::test]
async fn openai_completion_request_and_answer() {
    let (base, seen) = mock(
        200,
        openai_text("kubectl get pods -A", "stop"),
        Duration::ZERO,
    )
    .await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let got = client(&base)
        .complete(
            &store,
            &config(Provider::OpenAi, "gpt-x"),
            &line("kubectl get po"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "ds -A");
    let seen = seen.await.unwrap();
    assert_eq!(seen.path, "/v1/chat/completions");
    assert_eq!(
        seen.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    let body = &seen.body;
    assert_eq!(body["model"], "gpt-x");
    assert_eq!(body["max_completion_tokens"], 1024);
    assert!(body.get("max_tokens").is_none(), "{body}");
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][0]["content"], text::COMPLETE_SYSTEM);
    assert_eq!(body["messages"][1]["role"], "user");
    assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    assert!(body.get("response_format").is_none(), "{body}");
}

#[tokio::test]
async fn openai_assist_uses_a_strict_json_schema() {
    let (base, seen) = mock(200, openai_text(ASSIST_JSON, "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let got = client(&base)
        .assist(&store, &config(Provider::OpenAi, "gpt-x"), &ask("disk"))
        .await
        .unwrap();
    assert_eq!(got.command.as_deref(), Some("df -h"));
    let body = seen.await.unwrap().body;
    assert_eq!(body["max_completion_tokens"], 8192);
    assert_eq!(body["response_format"]["type"], "json_schema");
    assert_eq!(body["response_format"]["json_schema"]["strict"], true);
    let schema = &body["response_format"]["json_schema"]["schema"];
    assert_eq!(schema["additionalProperties"], false);
    assert_eq!(schema["required"], json!(["answer", "command"]));
    assert_eq!(
        schema["properties"]["command"]["anyOf"],
        json!([{"type": "string"}, {"type": "null"}])
    );
}

#[tokio::test]
async fn openai_refusal_is_refused() {
    let reply = json!({"choices": [{"index": 0, "message": {"role": "assistant", "content": null,
        "refusal": "I can't help with that."}, "finish_reason": "stop"}]});
    let (base, _seen) = mock(200, reply, Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .assist(&store, &config(Provider::OpenAi, "gpt-x"), &ask("x"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Refused);
}

#[tokio::test]
async fn compatible_server_without_key_sends_no_authorization() {
    let reply = openai_text(&format!("```json\n{ASSIST_JSON}\n```"), "stop");
    let (base, seen) = mock(200, reply, Duration::ZERO).await;
    let store = store_with(Provider::OpenAiCompatible, None);
    let config = AiConfig {
        provider: Provider::OpenAiCompatible,
        base_url: Some(format!("{base}/v1/")),
        model: "llama3.2".into(),
        session_id: None,
    };
    let got = client("http://127.0.0.1:9")
        .assist(&store, &config, &ask("disk"))
        .await
        .unwrap();
    assert_eq!(got.command.as_deref(), Some("df -h"));
    let seen = seen.await.unwrap();
    assert_eq!(seen.path, "/v1/chat/completions");
    assert_eq!(seen.header("authorization"), None);
    assert_eq!(seen.body["model"], "llama3.2");
    assert_eq!(seen.body["max_tokens"], 8192);
    assert!(
        seen.body.get("max_completion_tokens").is_none(),
        "{}",
        seen.body
    );
    assert!(seen.body.get("response_format").is_none(), "{}", seen.body);
}

#[tokio::test]
async fn compatible_server_with_key_sends_a_bearer_token() {
    let (base, seen) = mock(200, openai_text("ls -la", "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAiCompatible, Some(KEY));
    let config = AiConfig {
        provider: Provider::OpenAiCompatible,
        base_url: Some(format!("{base}/api/v1")),
        model: "openai/gpt-x".into(),
        session_id: Some(SESSION.into()),
    };
    client("http://127.0.0.1:9")
        .complete(&store, &config, &line("ls"))
        .await
        .unwrap();
    let seen = seen.await.unwrap();
    assert_eq!(seen.path, "/api/v1/chat/completions");
    assert_eq!(
        seen.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(seen.body["max_tokens"], 1024);
}

#[tokio::test]
async fn compatible_base_url_is_required_and_must_be_http() {
    let store = store_with(Provider::OpenAiCompatible, None);
    for base_url in [
        None,
        Some(""),
        Some("ftp://host/v1"),
        Some("not a url"),
        Some("http://"),
    ] {
        let config = AiConfig {
            provider: Provider::OpenAiCompatible,
            base_url: base_url.map(String::from),
            model: "m".into(),
            session_id: None,
        };
        let err = client("http://127.0.0.1:9")
            .complete(&store, &config, &line("ls"))
            .await
            .unwrap_err();
        assert_eq!(err.kind, AiErrorKind::Config, "{base_url:?}");
    }
}

#[tokio::test]
async fn an_empty_model_is_a_config_error() {
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client("http://127.0.0.1:9")
        .complete(&store, &config(Provider::OpenAi, "  "), &line("ls"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
}

// --- OpenCode Go and session IDs ------------------------------------------------------

#[tokio::test]
async fn opencode_go_uses_chat_completions_with_a_bearer_key_and_the_session() {
    let (base, seen) = mock(200, openai_text("git status", "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let got = client(&base)
        .complete(
            &store,
            &config(Provider::OpenCodeGo, "kimi-k2.6"),
            &line("git sta"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "tus");
    let seen = seen.await.unwrap();
    assert_eq!(seen.method, "POST");
    assert_eq!(seen.path, "/inference/go/v1/chat/completions");
    assert_eq!(
        seen.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(seen.header("x-opencode-session"), Some(SESSION));
    assert_eq!(seen.header("user-agent"), Some(USER_AGENT));
    let body = &seen.body;
    assert_eq!(body["model"], "kimi-k2.6");
    assert_eq!(body["max_tokens"], 1024);
    assert!(body.get("max_completion_tokens").is_none(), "{body}");
    assert!(body.get("response_format").is_none(), "{body}");
    assert_eq!(body["messages"][0]["role"], "system");
}

#[tokio::test]
async fn opencode_go_assist_reads_the_json_answer() {
    let (base, seen) = mock(200, openai_text(ASSIST_JSON, "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let got = client(&base)
        .assist(
            &store,
            &config(Provider::OpenCodeGo, "glm-5.3"),
            &ask("disk"),
        )
        .await
        .unwrap();
    assert_eq!(got.command.as_deref(), Some("df -h"));
    let seen = seen.await.unwrap();
    assert_eq!(seen.header("x-opencode-session"), Some(SESSION));
    assert_eq!(seen.body["max_tokens"], 8192);
}

#[test]
fn the_default_opencode_endpoints_are_the_go_api_and_models_dev() {
    let endpoints = Endpoints::default();
    assert_eq!(endpoints.opencode_go, "https://opencode.ai/inference/go/v1");
    assert_eq!(endpoints.models_dev, "https://models.dev/api.json");
}

#[tokio::test]
async fn opencode_go_refuses_a_missing_or_invalid_session_id_before_any_request() {
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let too_long = "a".repeat(129);
    for session in [
        None,
        Some(""),
        Some("has space"),
        Some("a/b"),
        Some("ñ"),
        Some(too_long.as_str()),
    ] {
        let config = AiConfig {
            session_id: session.map(String::from),
            ..config(Provider::OpenCodeGo, "kimi-k2.6")
        };
        let err = client("http://127.0.0.1:9")
            .complete(&store, &config, &line("ls"))
            .await
            .unwrap_err();
        assert_eq!(err.kind, AiErrorKind::Config, "{session:?}");
        assert!(err.message.contains("session"), "{}", err.message);
    }
}

#[test]
fn session_ids_of_1_to_128_safe_characters_are_accepted() {
    let longest = "Az09._-".repeat(18) + "ab";
    assert_eq!(longest.len(), 128);
    for session in ["x", longest.as_str()] {
        let config = AiConfig {
            session_id: Some(session.into()),
            ..config(Provider::OpenCodeGo, "kimi-k2.6")
        };
        let call = providers::build(
            &Endpoints::default(),
            &config,
            Some(&ApiKey::new(KEY)),
            prompt(),
            opencode::GoFormat::Chat,
        )
        .unwrap();
        assert!(
            call.headers
                .iter()
                .any(|(name, value)| *name == "x-opencode-session" && value == session)
        );
    }
}

fn compatible_at(base_url: &str) -> AiConfig {
    AiConfig {
        provider: Provider::OpenAiCompatible,
        base_url: Some(base_url.into()),
        model: "kimi-k2.6".into(),
        session_id: Some(SESSION.into()),
    }
}

#[test]
fn a_compatible_server_at_opencode_ai_gets_the_session_header() {
    for base in [
        "https://opencode.ai/inference/go/v1",
        "https://OpenCode.ai/zen/v1/",
    ] {
        let call = providers::build(
            &Endpoints::default(),
            &compatible_at(base),
            Some(&ApiKey::new(KEY)),
            prompt(),
            opencode::GoFormat::Chat,
        )
        .unwrap();
        assert!(
            call.headers
                .iter()
                .any(|(name, value)| *name == "x-opencode-session" && value == SESSION),
            "{base}"
        );
    }
    let missing = AiConfig {
        session_id: None,
        ..compatible_at("https://opencode.ai/inference/go/v1")
    };
    let err = providers::build(
        &Endpoints::default(),
        &missing,
        None,
        prompt(),
        opencode::GoFormat::Chat,
    )
    .err()
    .unwrap();
    assert_eq!(err.kind, AiErrorKind::Config);
}

#[tokio::test]
async fn a_compatible_server_elsewhere_gets_no_session_header() {
    let (base, seen) = mock(200, openai_text("ls -la", "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAiCompatible, None);
    client("http://127.0.0.1:9")
        .complete(&store, &compatible_at(&format!("{base}/v1")), &line("ls"))
        .await
        .unwrap();
    let seen = seen.await.unwrap();
    assert_eq!(seen.header("x-opencode-session"), None);
    for base in [
        "https://opencode.ai.example.com/v1",
        "https://notopencode.ai/v1",
    ] {
        let call = providers::build(
            &Endpoints::default(),
            &compatible_at(base),
            None,
            prompt(),
            opencode::GoFormat::Chat,
        )
        .unwrap();
        assert!(
            call.headers
                .iter()
                .all(|(name, _)| *name != "x-opencode-session"),
            "{base}"
        );
    }
}

#[tokio::test]
async fn every_provider_identifies_itself_as_plexusterm() {
    let replies = [
        (Provider::Anthropic, anthropic_text("ls -l", "end_turn")),
        (Provider::Gemini, gemini_text("ls -l", "STOP")),
        (Provider::OpenAi, openai_text("ls -l", "stop")),
        (Provider::OpenAiCompatible, openai_text("ls -l", "stop")),
        (Provider::OpenCodeGo, openai_text("ls -l", "stop")),
    ];
    for (provider, reply) in replies {
        let (base, seen) = mock(200, reply, Duration::ZERO).await;
        let store = store_with(provider, Some(KEY));
        let config = AiConfig {
            base_url: Some(format!("{base}/v1")),
            ..config(provider, "m")
        };
        client(&base)
            .complete(&store, &config, &line("ls"))
            .await
            .unwrap();
        let seen = seen.await.unwrap();
        assert_eq!(seen.header("user-agent"), Some(USER_AGENT), "{provider:?}");
    }
}

#[test]
fn opencode_go_parses_with_its_id_and_name() {
    assert_eq!(
        Provider::parse("opencode-go").unwrap(),
        Provider::OpenCodeGo
    );
    assert_eq!(Provider::OpenCodeGo.id(), "opencode-go");
    assert_eq!(Provider::OpenCodeGo.key_account(), "ai:opencode-go");
    assert_eq!(Provider::OpenCodeGo.display_name(), "OpenCode Go");
    assert!(Provider::OpenCodeGo.requires_key());
    let config: AiConfig = serde_json::from_value(json!({
        "provider": "opencode-go", "model": "kimi-k2.6", "sessionId": SESSION
    }))
    .unwrap();
    assert_eq!(config.provider, Provider::OpenCodeGo);
    assert_eq!(config.session_id.as_deref(), Some(SESSION));
}

// --- OpenCode Go: formats per model and the model catalogue ------------------------------

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// A cache file holding `models` as `(id, format)`, fetched `age` seconds ago.
fn go_cache(dir: &tempfile::TempDir, models: &[(&str, &str)], age: u64) -> std::path::PathBuf {
    let path = dir.path().join("opencode-go-models.json");
    let models: Vec<Value> = models
        .iter()
        .map(|(id, format)| {
            json!({"id": id, "name": id, "format": format, "supported": *format != "google"})
        })
        .collect();
    let cache = json!({"models": models, "note": null, "fetchedAt": now_secs() - age});
    std::fs::write(&path, cache.to_string()).unwrap();
    path
}

#[tokio::test]
async fn opencode_go_messages_models_get_the_anthropic_shape_with_both_key_headers() {
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("minimax-m3", "messages")], 0);
    let (base, seen) = mock(
        200,
        anthropic_text("git status", "end_turn"),
        Duration::ZERO,
    )
    .await;
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let ai = client(&base);
    ai.set_go_cache(Some(path));
    let got = ai
        .complete(
            &store,
            &config(Provider::OpenCodeGo, "minimax-m3"),
            &line("git sta"),
        )
        .await
        .unwrap();
    assert_eq!(got.completion, "tus");
    let seen = seen.await.unwrap();
    assert_eq!(seen.path, "/inference/go/v1/messages");
    assert_eq!(seen.header("x-api-key"), Some(KEY));
    assert_eq!(
        seen.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(seen.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(seen.header("x-opencode-session"), Some(SESSION));
    assert_eq!(seen.header("user-agent"), Some(USER_AGENT));
    assert_eq!(seen.header("anthropic-beta"), None);
    let body = &seen.body;
    assert_eq!(body["model"], "minimax-m3");
    assert_eq!(body["max_tokens"], 1024);
    assert_eq!(body["system"], text::COMPLETE_SYSTEM);
    assert_eq!(body["messages"][0]["role"], "user");
    assert!(body.get("output_config").is_none(), "{body}");
    assert!(body.get("fallbacks").is_none(), "{body}");
}

fn responses_text(text: &str) -> Value {
    json!({
        "id": "resp_1", "object": "response", "status": "completed",
        "output": [
            {"type": "reasoning", "id": "rs_1", "summary": []},
            {"type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
             "content": [{"type": "output_text", "text": text, "annotations": []}]}
        ]
    })
}

#[tokio::test]
async fn opencode_go_responses_models_post_instructions_and_input_to_responses() {
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("gpt-6-luna", "responses")], 0);
    let (base, seen) = mock(200, responses_text(ASSIST_JSON), Duration::ZERO).await;
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let ai = client(&base);
    ai.set_go_cache(Some(path));
    let got = ai
        .assist(
            &store,
            &config(Provider::OpenCodeGo, "gpt-6-luna"),
            &ask("disk"),
        )
        .await
        .unwrap();
    assert_eq!(got.command.as_deref(), Some("df -h"));
    let seen = seen.await.unwrap();
    assert_eq!(seen.path, "/inference/go/v1/responses");
    assert_eq!(
        seen.header("authorization"),
        Some(format!("Bearer {KEY}").as_str())
    );
    assert_eq!(seen.header("x-api-key"), None);
    assert_eq!(seen.header("x-opencode-session"), Some(SESSION));
    let body = &seen.body;
    assert_eq!(body["model"], "gpt-6-luna");
    assert_eq!(body["instructions"], text::ASSIST_SYSTEM);
    assert!(
        body["input"].as_str().unwrap().contains("Request: disk"),
        "{body}"
    );
    assert_eq!(body["max_output_tokens"], 8192);
    assert_eq!(body["store"], false);
    assert!(body.get("messages").is_none(), "{body}");
}

#[tokio::test]
async fn responses_answers_cut_off_or_refused_are_reported() {
    let cases = [
        (
            json!({"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "output": []}),
            AiErrorKind::BadResponse,
        ),
        (
            json!({"status": "completed", "output": [{"type": "message", "content": [
                {"type": "refusal", "refusal": "No."}]}]}),
            AiErrorKind::Refused,
        ),
    ];
    for (reply, kind) in cases {
        let dir = tempfile::tempdir().unwrap();
        let path = go_cache(&dir, &[("gpt-6-luna", "responses")], 0);
        let (base, _seen) = mock(200, reply, Duration::ZERO).await;
        let store = store_with(Provider::OpenCodeGo, Some(KEY));
        let ai = client(&base);
        ai.set_go_cache(Some(path));
        let err = ai
            .assist(
                &store,
                &config(Provider::OpenCodeGo, "gpt-6-luna"),
                &ask("x"),
            )
            .await
            .unwrap_err();
        assert_eq!(err.kind, kind);
    }
}

#[tokio::test]
async fn opencode_go_google_models_are_not_supported_yet_and_send_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("gemini-4-argon-contributor", "google")], 0);
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let ai = client("http://127.0.0.1:9");
    ai.set_go_cache(Some(path));
    let err = ai
        .complete(
            &store,
            &config(Provider::OpenCodeGo, "gemini-4-argon-contributor"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    assert!(err.message.contains("does not support"), "{}", err.message);
}

const GO_LIST: &str = r#"{"object":"list","data":[
    {"id":"kimi-k3","object":"model","owned_by":"opencode"},
    {"id":"minimax-m3","object":"model","owned_by":"opencode"},
    {"id":"gpt-6-luna","object":"model","owned_by":"opencode"},
    {"id":"gemini-4-argon-contributor","object":"model","owned_by":"opencode"},
    {"id":"omen-alpha","object":"model","owned_by":"opencode"},
    {"id":"kimi-k3","object":"model","owned_by":"opencode"},
    {"id":"bad id","object":"model","owned_by":"opencode"}
]}"#;

const MODELS_DEV: &str = r#"{
  "openai": {"id": "openai", "models": {"gpt-x": {"id": "gpt-x", "name": "GPT X", "provider": {"npm": "@ai-sdk/anthropic"}}}},
  "opencode-go": {"id": "opencode-go", "npm": "@ai-sdk/openai-compatible", "api": "https://opencode.ai/inference/go/v1",
    "models": {
      "kimi-k3": {"id": "kimi-k3", "name": "Kimi K3", "limit": {"context": 1, "output": 1}},
      "minimax-m3": {"id": "minimax-m3", "name": "MiniMax-M3", "provider": {"npm": "@ai-sdk/anthropic"}},
      "gpt-6-luna": {"id": "gpt-6-luna", "name": "GPT-6 Luna", "provider": {"npm": "@ai-sdk/openai"}},
      "gemini-4-argon-contributor": {"id": "gemini-4-argon-contributor", "name": "Gemini 4 Argon Contributor", "provider": {"npm": "@ai-sdk/google"}},
      "retired": {"id": "retired", "name": "Retired"}
    }}
}"#;

fn go_routes(list: (u16, &str), dev: (u16, &str)) -> Vec<(&'static str, u16, String)> {
    vec![
        ("/inference/go/v1/models", list.0, list.1.to_string()),
        ("/api.json", dev.0, dev.1.to_string()),
    ]
}

fn summary(models: &opencode::GoModels) -> Vec<(String, String, opencode::GoFormat, bool)> {
    models
        .models
        .iter()
        .map(|m| (m.id.clone(), m.name.clone(), m.format, m.supported))
        .collect()
}

#[tokio::test]
async fn the_opencode_go_catalogue_joins_the_public_list_with_models_dev_formats() {
    use opencode::GoFormat::*;
    let (base, log) = mock_routes(go_routes((200, GO_LIST), (200, MODELS_DEV))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("opencode-go-models.json");
    let ai = client(&base);
    ai.set_go_cache(Some(path.clone()));
    let got = ai.opencode_models(false).await.unwrap();
    let s = |v: &str| v.to_string();
    assert_eq!(
        summary(&got),
        vec![
            (
                s("gemini-4-argon-contributor"),
                s("Gemini 4 Argon Contributor"),
                Google,
                false
            ),
            (s("gpt-6-luna"), s("GPT-6 Luna"), Responses, true),
            (s("kimi-k3"), s("Kimi K3"), Chat, true),
            (s("minimax-m3"), s("MiniMax-M3"), Messages, true),
            (s("omen-alpha"), s("omen-alpha"), Chat, true),
        ]
    );
    assert_eq!(got.note, None);
    assert!(got.fetched_at >= now_secs() - 5);
    {
        let log = log.lock().unwrap();
        assert_eq!(log.len(), 2);
        for seen in log.iter() {
            assert_eq!(seen.method, "GET");
            assert_eq!(seen.header("user-agent"), Some(USER_AGENT));
            assert_eq!(seen.header("authorization"), None);
        }
    }
    // Cached on disk for the next start, and in memory for this one.
    let saved: opencode::GoModels =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(saved, got);
    assert_eq!(ai.opencode_models(false).await.unwrap(), got);
    assert_eq!(log.lock().unwrap().len(), 2);
    // The frontend gets camelCase fields.
    let json = serde_json::to_value(&got).unwrap();
    assert_eq!(json["models"][1]["format"], "responses");
    assert!(json["fetchedAt"].is_u64());
}

#[tokio::test]
async fn a_fresh_cache_file_is_used_without_asking_and_refresh_or_age_fetches_again() {
    let (base, log) = mock_routes(go_routes((200, GO_LIST), (200, MODELS_DEV))).await;
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("cached-model", "chat")], 60);
    let ai = client(&base);
    ai.set_go_cache(Some(path.clone()));
    let got = ai.opencode_models(false).await.unwrap();
    assert_eq!(got.models[0].id, "cached-model");
    assert!(log.lock().unwrap().is_empty());
    let refreshed = ai.opencode_models(true).await.unwrap();
    assert_eq!(refreshed.models.len(), 5);
    assert_eq!(log.lock().unwrap().len(), 2);

    let old = go_cache(
        &dir,
        &[("cached-model", "chat")],
        opencode::MAX_AGE_SECS + 1,
    );
    let ai = client(&base);
    ai.set_go_cache(Some(old));
    assert_eq!(ai.opencode_models(false).await.unwrap().models.len(), 5);
    assert_eq!(log.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn without_models_dev_every_listed_model_is_chat_completions_with_a_note() {
    let (base, _log) = mock_routes(go_routes((200, GO_LIST), (503, "{}"))).await;
    let got = client(&base).opencode_models(true).await.unwrap();
    assert_eq!(got.models.len(), 5);
    assert!(
        got.models
            .iter()
            .all(|m| m.format == opencode::GoFormat::Chat && m.supported && m.name == m.id)
    );
    assert_eq!(got.note.as_deref(), Some(opencode::NOTE_NO_FORMATS));
}

#[tokio::test]
async fn without_the_public_list_models_dev_alone_gives_the_models() {
    let (base, _log) = mock_routes(go_routes((500, "{}"), (200, MODELS_DEV))).await;
    let got = client(&base).opencode_models(true).await.unwrap();
    let ids: Vec<&str> = got.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "gemini-4-argon-contributor",
            "gpt-6-luna",
            "kimi-k3",
            "minimax-m3",
            "retired"
        ]
    );
}

#[tokio::test]
async fn when_both_sources_fail_the_saved_list_is_kept_with_a_note_or_it_is_a_network_error() {
    let (base, _log) = mock_routes(vec![]).await;
    let err = client(&base).opencode_models(true).await.unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Network);
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("cached-model", "messages")], 10);
    let ai = client(&base);
    ai.set_go_cache(Some(path));
    let got = ai.opencode_models(true).await.unwrap();
    assert_eq!(got.models[0].id, "cached-model");
    assert_eq!(got.note.as_deref(), Some(opencode::NOTE_STALE));
}

#[tokio::test]
async fn models_missing_from_the_catalogue_fall_back_to_chat_completions() {
    let dir = tempfile::tempdir().unwrap();
    let path = go_cache(&dir, &[("minimax-m3", "messages")], 0);
    let (base, seen) = mock(200, openai_text("ls -la", "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenCodeGo, Some(KEY));
    let ai = client(&base);
    ai.set_go_cache(Some(path));
    ai.complete(
        &store,
        &config(Provider::OpenCodeGo, "new-model"),
        &line("ls"),
    )
    .await
    .unwrap();
    assert_eq!(
        seen.await.unwrap().path,
        "/inference/go/v1/chat/completions"
    );
}

// --- Verifier advisories -----------------------------------------------------------------

#[tokio::test]
async fn redirects_are_not_followed_and_are_a_config_error() {
    let (elsewhere, other_log) = mock_routes(vec![]).await;
    let location: &'static str =
        Box::leak(format!("Location: {elsewhere}/steal\r\n").into_boxed_str());
    let (base, seen) = mock_with(302, location, json!({}), Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let err = client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    assert!(err.message.contains("redirect"), "{}", err.message);
    assert_eq!(seen.await.unwrap().header("x-api-key"), Some(KEY));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(other_log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_assistant_command_over_2000_characters_is_dropped_and_the_answer_kept() {
    let long = "a".repeat(text::MAX_COMMAND + 1);
    let answer = format!("{{\"answer\": \"x\", \"command\": \"{long}\"}}");
    let (base, _seen) = mock(200, openai_text(&answer, "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let got = client(&base)
        .assist(&store, &config(Provider::OpenAi, "gpt-x"), &ask("x"))
        .await
        .unwrap();
    assert_eq!(
        got,
        AssistResponse {
            answer: "x".into(),
            command: None
        }
    );
}

#[test]
fn an_answer_without_a_command_serializes_command_as_null() {
    let got = AssistResponse {
        answer: "Hi.".into(),
        command: None,
    };
    assert_eq!(
        serde_json::to_value(&got).unwrap(),
        json!({"answer": "Hi.", "command": null})
    );
}

// --- General answers (S8) ----------------------------------------------------------------

/// The provider's own success body around `text`, for each assistant API shape.
fn reply_for(provider: Provider, text: &str) -> Value {
    match provider {
        Provider::Anthropic => anthropic_text(text, "end_turn"),
        Provider::Gemini => gemini_text(text, "STOP"),
        _ => openai_text(text, "stop"),
    }
}

fn compatible_config(base: &str) -> AiConfig {
    AiConfig {
        provider: Provider::OpenAiCompatible,
        base_url: Some(format!("{base}/v1")),
        model: "llama3.2".into(),
        session_id: None,
    }
}

#[tokio::test]
async fn every_provider_reads_an_answer_without_a_command() {
    for (provider, model) in [
        (Provider::Anthropic, "claude-opus-5-5"),
        (Provider::Gemini, "gemini-3.5-flash-lite"),
        (Provider::OpenAi, "gpt-x"),
        (Provider::OpenCodeGo, "glm-5.3"),
        (Provider::OpenAiCompatible, "llama3.2"),
    ] {
        let (base, _seen) = mock(200, reply_for(provider, ANSWER_ONLY_JSON), Duration::ZERO).await;
        let store = store_with(provider, Some(KEY));
        let config = if provider == Provider::OpenAiCompatible {
            compatible_config(&base)
        } else {
            config(provider, model)
        };
        let got = client(&base)
            .assist(&store, &config, &ask("hola"))
            .await
            .unwrap();
        assert_eq!(
            got,
            AssistResponse {
                answer: "¡Hola! ¿En qué te ayudo?".into(),
                command: None
            },
            "{provider:?}"
        );
    }
}

#[tokio::test]
async fn every_provider_sends_the_general_assistant_prompt() {
    for (provider, model) in [
        (Provider::Anthropic, "claude-opus-5-5"),
        (Provider::Gemini, "gemini-3.5-flash-lite"),
        (Provider::OpenAi, "gpt-x"),
        (Provider::OpenCodeGo, "glm-5.3"),
        (Provider::OpenAiCompatible, "llama3.2"),
    ] {
        let (base, seen) = mock(200, reply_for(provider, ASSIST_JSON), Duration::ZERO).await;
        let store = store_with(provider, Some(KEY));
        let config = if provider == Provider::OpenAiCompatible {
            compatible_config(&base)
        } else {
            config(provider, model)
        };
        client(&base)
            .assist(&store, &config, &ask("¿qué es un inodo?"))
            .await
            .unwrap();
        let body = seen.await.unwrap().body;
        let system = match provider {
            Provider::Anthropic => &body["system"],
            Provider::Gemini => &body["systemInstruction"]["parts"][0]["text"],
            _ => &body["messages"][0]["content"],
        };
        assert_eq!(system, text::ASSIST_SYSTEM, "{provider:?}");
    }
    let prompt = text::ASSIST_SYSTEM;
    for needle in [
        "any question",
        "language the user wrote",
        "\"command\": null",
        "never run",
    ] {
        assert!(prompt.contains(needle), "{needle}: {prompt}");
    }
}

#[tokio::test]
async fn plain_text_replies_become_the_answer_with_no_command() {
    let reply = "Un inodo guarda los datos de un archivo.\n```sh\nls -i\n```";
    // OpenAI-compatible (chat completions).
    let (base, _seen) = mock(200, openai_text(reply, "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAiCompatible, None);
    let got = client(&base)
        .assist(&store, &compatible_config(&base), &ask("inodo"))
        .await
        .unwrap();
    assert_eq!(got.answer, reply);
    assert_eq!(got.command, None);
    // OpenCode Go messages and responses models.
    for (model, format, body) in [
        ("minimax-m3", "messages", anthropic_text(reply, "end_turn")),
        ("gpt-6-luna", "responses", responses_text(reply)),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = go_cache(&dir, &[(model, format)], 0);
        let (base, _seen) = mock(200, body, Duration::ZERO).await;
        let store = store_with(Provider::OpenCodeGo, Some(KEY));
        let ai = client(&base);
        ai.set_go_cache(Some(path));
        let got = ai
            .assist(&store, &config(Provider::OpenCodeGo, model), &ask("inodo"))
            .await
            .unwrap();
        assert_eq!(
            got,
            AssistResponse {
                answer: reply.into(),
                command: None
            },
            "{format}"
        );
    }
}

#[tokio::test]
async fn an_empty_assistant_reply_is_a_bad_response() {
    let (base, _seen) = mock(200, openai_text("  \n", "stop"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .assist(&store, &config(Provider::OpenAi, "gpt-x"), &ask("x"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::BadResponse);
}

// --- Errors ------------------------------------------------------------------------------

#[tokio::test]
async fn http_401_is_auth_and_never_carries_the_key() {
    let reply = json!({"error": {"message": format!("Incorrect API key provided: {KEY}")}});
    let (base, _seen) = mock(401, reply, Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .complete(&store, &config(Provider::OpenAi, "gpt-x"), &line("ls"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Auth);
    let serialized = serde_json::to_string(&err).unwrap();
    assert!(serialized.contains(r#""kind":"auth""#), "{serialized}");
    assert!(!serialized.contains(KEY), "{serialized}");
    assert!(!format!("{err:?}").contains(KEY));
}

#[tokio::test]
async fn http_429_is_rate_limit() {
    let reply =
        json!({"type": "error", "error": {"type": "rate_limit_error", "message": "slow down"}});
    let (base, _seen) = mock(429, reply, Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let err = client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::RateLimit);
}

#[tokio::test]
async fn http_400_keeps_the_provider_message_without_the_key() {
    let reply = json!({"error": {"message": format!("model not found for key {KEY}")}});
    let (base, _seen) = mock(400, reply, Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .complete(&store, &config(Provider::OpenAi, "gpt-x"), &line("ls"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    assert!(
        err.message.contains("model not found for key ***"),
        "{}",
        err.message
    );
    assert!(!err.message.contains(KEY));
}

#[tokio::test]
async fn http_529_overloaded_is_network() {
    let reply =
        json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}});
    let (base, _seen) = mock(529, reply, Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let err = client(&base)
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Network);
}

#[tokio::test]
async fn a_slow_provider_times_out() {
    let (base, _seen) = mock(
        200,
        anthropic_text("ls -l", "end_turn"),
        Duration::from_secs(5),
    )
    .await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    let err = client(&base)
        .with_timeouts(Duration::from_millis(200), Duration::from_millis(200))
        .complete(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &line("ls"),
        )
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Timeout);
}

#[tokio::test]
async fn an_unreachable_server_is_network() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .complete(&store, &config(Provider::OpenAi, "gpt-x"), &line("ls"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Network);
}

#[tokio::test]
async fn a_non_json_answer_is_bad_response() {
    let (base, _seen) = mock(200, json!("<html>"), Duration::ZERO).await;
    let store = store_with(Provider::OpenAi, Some(KEY));
    let err = client(&base)
        .complete(&store, &config(Provider::OpenAi, "gpt-x"), &line("ls"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::BadResponse);
}

#[tokio::test]
async fn hosted_providers_without_a_key_fail_before_any_request() {
    let store = store_with(Provider::Anthropic, None);
    for provider in [
        Provider::Anthropic,
        Provider::Gemini,
        Provider::OpenAi,
        Provider::OpenCodeGo,
    ] {
        let err = client("http://127.0.0.1:9")
            .complete(&store, &config(provider, "m"), &line("ls"))
            .await
            .unwrap_err();
        assert_eq!(err.kind, AiErrorKind::NoKey, "{provider:?}");
    }
    let unavailable: SharedSecrets = Arc::new(NoStore);
    let err = client("http://127.0.0.1:9")
        .assist(&unavailable, &config(Provider::Gemini, "m"), &ask("x"))
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::NoKey);
}

#[tokio::test]
async fn an_empty_line_is_not_sent() {
    let store = store_with(Provider::OpenAi, Some(KEY));
    let got = client("http://127.0.0.1:9")
        .complete(&store, &config(Provider::OpenAi, "gpt-x"), &line("   "))
        .await
        .unwrap();
    assert_eq!(got.completion, "");
}

#[test]
fn errors_serialize_as_kind_and_message() {
    let err = AiError::new(AiErrorKind::NoKey, "No key.");
    assert_eq!(
        serde_json::to_value(&err).unwrap(),
        json!({"kind": "noKey", "message": "No key."})
    );
    let kinds = [
        (AiErrorKind::RateLimit, "rateLimit"),
        (AiErrorKind::BadResponse, "badResponse"),
        (AiErrorKind::Timeout, "timeout"),
        (AiErrorKind::Refused, "refused"),
    ];
    for (kind, name) in kinds {
        assert_eq!(serde_json::to_value(kind).unwrap(), json!(name));
    }
}

#[test]
fn config_deserializes_from_camel_case() {
    let config: AiConfig = serde_json::from_value(json!({
        "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "llama3.2"
    }))
    .unwrap();
    assert_eq!(config.provider, Provider::OpenAiCompatible);
    assert_eq!(
        config.base_url.as_deref(),
        Some("http://localhost:11434/v1")
    );
    let request: AssistRequest =
        serde_json::from_value(json!({"prompt": "p", "os": "linux", "history": []})).unwrap();
    assert_eq!(request.selection, None);
}

#[test]
fn the_default_client_builds_with_tls() {
    assert!(build_http().is_ok());
}

// --- Keys --------------------------------------------------------------------------------

#[tokio::test]
async fn keys_are_saved_reported_and_deleted_in_the_keyring() {
    let store = MemoryStore::shared();
    let shared: SharedSecrets = store.clone();
    assert!(!key_status(&shared, "anthropic").await.unwrap());
    key_save(&shared, "anthropic", format!("  {KEY}\n"))
        .await
        .unwrap();
    assert!(key_status(&shared, "anthropic").await.unwrap());
    assert_eq!(store.get("ai:anthropic").unwrap().as_deref(), Some(KEY));
    assert_eq!(
        store.label("ai:anthropic").as_deref(),
        Some("PlexusTerm AI key (Anthropic)")
    );
    assert!(!key_status(&shared, "gemini").await.unwrap());
    key_delete(&shared, "anthropic").await.unwrap();
    assert!(!key_status(&shared, "anthropic").await.unwrap());
    key_delete(&shared, "anthropic").await.unwrap();
}

#[tokio::test]
async fn key_accounts_follow_the_provider_id() {
    let store = MemoryStore::shared();
    let shared: SharedSecrets = store.clone();
    for id in [
        "anthropic",
        "gemini",
        "openai",
        "openai-compatible",
        "opencode-go",
    ] {
        key_save(&shared, id, "k".into()).await.unwrap();
        assert_eq!(
            store.get(&format!("ai:{id}")).unwrap().as_deref(),
            Some("k")
        );
    }
}

#[tokio::test]
async fn empty_keys_and_unknown_providers_are_rejected() {
    let shared: SharedSecrets = MemoryStore::shared();
    let err = key_save(&shared, "anthropic", "   ".into())
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    let err = key_save(&shared, "opencode", "k".into()).await.unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    assert_eq!(
        key_status(&shared, "opencode").await.unwrap_err().kind,
        AiErrorKind::Config
    );
}

#[tokio::test]
async fn an_unavailable_keyring_reports_no_key_and_refuses_to_save() {
    let shared: SharedSecrets = Arc::new(NoStore);
    assert!(!key_status(&shared, "openai").await.unwrap());
    let err = key_save(&shared, "openai", KEY.to_string())
        .await
        .unwrap_err();
    assert_eq!(err.kind, AiErrorKind::Config);
    assert!(!err.message.contains(KEY), "{}", err.message);
}

#[test]
fn api_keys_are_redacted_in_debug_output() {
    let key = ApiKey::new(KEY);
    assert_eq!(format!("{key:?}"), "ApiKey(***)");
}

// --- Chat conversation (S9) --------------------------------------------------------------

fn follow_up() -> AssistRequest {
    AssistRequest {
        conversation: vec![Turn {
            question: "what uses the space?".into(),
            selection: None,
            answer: "Sizes, smallest first.".into(),
            command: Some("du -sh *".into()),
        }],
        ..ask("and sorted?")
    }
}

const FIRST_ANSWER: &str = r#"{"answer":"Sizes, smallest first.","command":"du -sh *"}"#;

/// `(role, text)` of each message, whatever the provider's shape.
fn roles_and_texts(messages: &Value, text_of: impl Fn(&Value) -> String) -> Vec<(String, String)> {
    messages
        .as_array()
        .unwrap()
        .iter()
        .map(|m| (m["role"].as_str().unwrap().to_string(), text_of(m)))
        .collect()
}

fn assert_replayed(got: &[(String, String)], assistant_role: &str, what: &str) {
    assert_eq!(got.len(), 3, "{what}: {got:?}");
    assert_eq!(
        got[0],
        ("user".into(), "Request: what uses the space?".into()),
        "{what}"
    );
    assert_eq!(got[1].0, assistant_role, "{what}");
    let replayed: Value = serde_json::from_str(&got[1].1).unwrap();
    assert_eq!(
        replayed,
        serde_json::from_str::<Value>(FIRST_ANSWER).unwrap(),
        "{what}"
    );
    assert_eq!(got[2].0, "user", "{what}");
    assert!(
        got[2].1.contains("Request: and sorted?"),
        "{what}: {}",
        got[2].1
    );
    assert!(!got[2].1.contains("what uses the space"), "{what}");
}

#[tokio::test]
async fn follow_ups_replay_earlier_turns_as_alternating_messages_for_every_provider() {
    for (provider, model) in [
        (Provider::Anthropic, "claude-opus-5-5"),
        (Provider::Gemini, "gemini-3.5-flash-lite"),
        (Provider::OpenAi, "gpt-x"),
        (Provider::OpenAiCompatible, "llama3.2"),
    ] {
        let (base, seen) = mock(200, reply_for(provider, ASSIST_JSON), Duration::ZERO).await;
        let store = store_with(provider, Some(KEY));
        let config = if provider == Provider::OpenAiCompatible {
            compatible_config(&base)
        } else {
            config(provider, model)
        };
        client(&base)
            .assist(&store, &config, &follow_up())
            .await
            .unwrap();
        let body = seen.await.unwrap().body;
        let what = format!("{provider:?}");
        match provider {
            Provider::Anthropic => {
                assert_eq!(body["system"], text::ASSIST_SYSTEM);
                let got =
                    roles_and_texts(&body["messages"], |m| m["content"].as_str().unwrap().into());
                assert_replayed(&got, "assistant", &what);
            }
            Provider::Gemini => {
                assert_eq!(
                    body["systemInstruction"]["parts"][0]["text"],
                    text::ASSIST_SYSTEM
                );
                let got = roles_and_texts(&body["contents"], |m| {
                    m["parts"][0]["text"].as_str().unwrap().into()
                });
                assert_replayed(&got, "model", &what);
            }
            _ => {
                let messages = body["messages"].as_array().unwrap();
                assert_eq!(messages[0]["role"], "system", "{what}");
                assert_eq!(messages[0]["content"], text::ASSIST_SYSTEM, "{what}");
                let rest = Value::Array(messages[1..].to_vec());
                let got = roles_and_texts(&rest, |m| m["content"].as_str().unwrap().into());
                assert_replayed(&got, "assistant", &what);
            }
        }
    }
}

#[tokio::test]
async fn opencode_go_follow_ups_replay_turns_in_each_model_format() {
    for (model, format) in [
        ("glm-5.3", "chat"),
        ("minimax-m3", "messages"),
        ("gpt-6-luna", "responses"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = go_cache(&dir, &[(model, format)], 0);
        let reply = match format {
            "messages" => anthropic_text(ASSIST_JSON, "end_turn"),
            "responses" => responses_text(ASSIST_JSON),
            _ => openai_text(ASSIST_JSON, "stop"),
        };
        let (base, seen) = mock(200, reply, Duration::ZERO).await;
        let store = store_with(Provider::OpenCodeGo, Some(KEY));
        let ai = client(&base);
        ai.set_go_cache(Some(path));
        ai.assist(&store, &config(Provider::OpenCodeGo, model), &follow_up())
            .await
            .unwrap();
        let seen = seen.await.unwrap();
        assert_eq!(seen.header("x-opencode-session"), Some(SESSION), "{format}");
        let body = &seen.body;
        let content = |m: &Value| m["content"].as_str().unwrap().to_string();
        match format {
            "messages" => {
                assert_eq!(body["system"], text::ASSIST_SYSTEM);
                assert_replayed(
                    &roles_and_texts(&body["messages"], content),
                    "assistant",
                    format,
                );
            }
            "responses" => {
                assert_eq!(body["instructions"], text::ASSIST_SYSTEM);
                assert_replayed(
                    &roles_and_texts(&body["input"], content),
                    "assistant",
                    format,
                );
            }
            _ => {
                let messages = body["messages"].as_array().unwrap();
                assert_eq!(messages[0]["content"], text::ASSIST_SYSTEM);
                let rest = Value::Array(messages[1..].to_vec());
                assert_replayed(&roles_and_texts(&rest, content), "assistant", format);
            }
        }
    }
}

#[tokio::test]
async fn a_first_question_sends_no_earlier_turns() {
    let (base, seen) = mock(200, anthropic_text(ASSIST_JSON, "end_turn"), Duration::ZERO).await;
    let store = store_with(Provider::Anthropic, Some(KEY));
    client(&base)
        .assist(
            &store,
            &config(Provider::Anthropic, "claude-opus-5-5"),
            &ask("disk"),
        )
        .await
        .unwrap();
    let body = seen.await.unwrap().body;
    assert_eq!(body["messages"].as_array().unwrap().len(), 1, "{body}");
}

#[test]
fn the_conversation_deserializes_from_camel_case_and_defaults_to_empty() {
    let request: AssistRequest = serde_json::from_value(json!({
        "prompt": "and sorted?", "os": "linux", "history": [],
        "conversation": [{"question": "q", "answer": "a", "command": null, "selection": "sel"}]
    }))
    .unwrap();
    assert_eq!(request.conversation.len(), 1);
    assert_eq!(request.conversation[0].selection.as_deref(), Some("sel"));
    let plain: AssistRequest =
        serde_json::from_value(json!({"prompt": "p", "os": "linux"})).unwrap();
    assert!(plain.conversation.is_empty());
}
