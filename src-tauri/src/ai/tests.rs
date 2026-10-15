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

/// Answers one request with `status` and `reply` after `delay`; returns the base URL.
async fn mock(status: u16, reply: Value, delay: Duration) -> (String, oneshot::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = oneshot::channel();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
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
        let _ = tx.send(Seen {
            method,
            path,
            headers,
            body,
        });
        tokio::time::sleep(delay).await;
        let payload = reply.to_string();
        let response = format!(
            "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            payload.len()
        );
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    });
    (base, rx)
}

fn client(base: &str) -> AiClient {
    AiClient::new(
        reqwest::Client::new(),
        Endpoints {
            anthropic: format!("{base}/v1/messages"),
            gemini: format!("{base}/v1beta"),
            openai: format!("{base}/v1/chat/completions"),
        },
    )
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

const ASSIST_JSON: &str = r#"{"command": "df -h", "explanation": "Shows free disk space."}"#;

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
            command: "df -h".into(),
            explanation: "Shows free disk space.".into()
        }
    );
    let body = seen.await.unwrap().body;
    assert_eq!(body["max_tokens"], 8192);
    assert_eq!(body["output_config"]["effort"], "medium");
    assert_eq!(body["output_config"]["format"]["type"], "json_schema");
    let schema = &body["output_config"]["format"]["schema"];
    assert_eq!(schema["required"], json!(["command", "explanation"]));
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
    assert_eq!(got.command, "df -h");
    let body = seen.await.unwrap().body;
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 8192);
    assert_eq!(
        body["generationConfig"]["responseMimeType"],
        "application/json"
    );
    assert_eq!(
        body["generationConfig"]["responseSchema"]["required"],
        json!(["command", "explanation"])
    );
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
    assert_eq!(got.command, "df -h");
    let body = seen.await.unwrap().body;
    assert_eq!(body["max_completion_tokens"], 8192);
    assert_eq!(body["response_format"]["type"], "json_schema");
    assert_eq!(body["response_format"]["json_schema"]["strict"], true);
    assert_eq!(
        body["response_format"]["json_schema"]["schema"]["additionalProperties"],
        false
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
    };
    let got = client("http://127.0.0.1:9")
        .assist(&store, &config, &ask("disk"))
        .await
        .unwrap();
    assert_eq!(got.command, "df -h");
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
    for provider in [Provider::Anthropic, Provider::Gemini, Provider::OpenAi] {
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
    for id in ["anthropic", "gemini", "openai", "openai-compatible"] {
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
