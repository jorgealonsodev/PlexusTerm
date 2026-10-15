//! Prompts sent to the providers and cleaning of what they answer.
//!
//! Everything a provider returns is untrusted: commands come back as one line with no
//! control characters, so typing them into a terminal can never press Enter or send an
//! escape sequence.

use super::{AssistRequest, CompleteRequest};

pub const COMPLETE_SYSTEM: &str = "You complete shell commands while the user types them in a terminal. \
Reply with only the complete command line, starting with exactly the text already typed, on a single line. \
No explanation, no quotes, no markdown. If you have no useful completion, reply with nothing.";

pub const ASSIST_SYSTEM: &str = "You help a terminal user by suggesting one shell command for what they describe. \
Reply with only a JSON object {\"command\": \"...\", \"explanation\": \"...\"}. \
\"command\" is a single command line for the given OS and shell (combine steps with && or pipes); \
\"explanation\" is one or two short sentences saying what it does and any risk. \
You never run anything: the user reviews the command first. \
If no command fits the request, leave \"command\" empty and explain why.";

/// History commands sent as context at most (the settings allow 0-20).
const MAX_HISTORY: usize = 20;
/// Longest single field (line, history entry, folder) sent.
const MAX_FIELD: usize = 500;
const MAX_PROMPT: usize = 4000;
const MAX_SELECTION: usize = 8000;
const MAX_DETAIL: usize = 200;
const MAX_COMPLETION: usize = 300;

/// Cuts `s` to at most `max` characters.
fn cap(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((at, _)) => &s[..at],
        None => s,
    }
}

fn context(os: &str, shell: Option<&str>, cwd: Option<&str>, history: &[String]) -> String {
    let mut out = format!("OS: {}\n", cap(os, MAX_FIELD));
    if let Some(shell) = shell.filter(|s| !s.trim().is_empty()) {
        out.push_str(&format!("Shell: {}\n", cap(shell, MAX_FIELD)));
    }
    if let Some(cwd) = cwd.filter(|s| !s.trim().is_empty()) {
        out.push_str(&format!("Current folder: {}\n", cap(cwd, MAX_FIELD)));
    }
    let recent = &history[history.len().saturating_sub(MAX_HISTORY)..];
    if !recent.is_empty() {
        out.push_str("Recent commands (oldest first):\n");
        for command in recent {
            out.push_str(&single_line(cap(command, MAX_FIELD)));
            out.push('\n');
        }
    }
    out
}

pub fn complete_prompt(request: &CompleteRequest) -> String {
    let mut out = context(
        &request.os,
        request.shell.as_deref(),
        request.cwd.as_deref(),
        &request.history,
    );
    // JSON string quoting keeps trailing spaces visible.
    let typed = serde_json::to_string(cap(&request.line, MAX_FIELD)).unwrap_or_default();
    out.push_str(&format!("Typed so far: {typed}"));
    out
}

pub fn assist_prompt(request: &AssistRequest) -> String {
    let mut out = context(
        &request.os,
        request.shell.as_deref(),
        request.cwd.as_deref(),
        &request.history,
    );
    if let Some(selection) = request
        .selection
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        out.push_str(&format!(
            "Selected terminal text:\n{}\n",
            cap(selection, MAX_SELECTION)
        ));
    }
    out.push_str(&format!(
        "Request: {}",
        cap(request.prompt.trim(), MAX_PROMPT)
    ));
    out
}

/// Drops `<think>...</think>` blocks some local models put in their answer.
fn strip_reasoning(reply: &str) -> String {
    let mut out = String::new();
    let mut rest = reply;
    while let Some(start) = rest.find("<think>") {
        out.push_str(&rest[..start]);
        match rest[start..].find("</think>") {
            Some(end) => rest = &rest[start + end + "</think>".len()..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// Splits off the first fenced code block: (its content, the text around it).
fn split_fence(reply: &str) -> Option<(String, String)> {
    let start = reply.find("```")?;
    let after = &reply[start + 3..];
    let body_start = after.find('\n').map(|i| i + 1)?;
    let body = &after[body_start..];
    let end = body.find("```")?;
    let outside = [reply[..start].trim(), body[end + 3..].trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Some((body[..end].to_string(), outside))
}

/// Removes control characters (tabs become spaces).
fn strip_controls(s: &str) -> String {
    s.chars()
        .filter_map(|c| match c {
            '\t' => Some(' '),
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect()
}

/// Joins a multi-line command into one line: `\\`-continuations with a space, others with `&&`.
fn single_line(command: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut continued = false;
    for raw in command.replace("\r\n", "\n").split(['\n', '\r']) {
        let line = strip_controls(raw);
        let line = if continued {
            line.trim_start()
        } else {
            line.as_str()
        }
        .trim_end();
        let (line, continues) = match line.strip_suffix('\\') {
            Some(head) => (head.trim_end(), true),
            None => (line, false),
        };
        match lines.last_mut() {
            Some(last) if continued => {
                if !line.is_empty() {
                    last.push(' ');
                    last.push_str(line);
                }
            }
            _ if line.trim().is_empty() => {}
            _ => lines.push(line.trim_start().to_string()),
        }
        continued = continues && !lines.is_empty();
    }
    lines.join(" && ")
}

fn unwrap_quotes(s: &str) -> &str {
    for q in ['`', '"', '\''] {
        if s.len() >= 2 && s.starts_with(q) && s.ends_with(q) && !s[1..s.len() - 1].contains(q) {
            return &s[1..s.len() - 1];
        }
    }
    s
}

/// The text to append after `line`, from a reply that should repeat the whole line.
pub fn clean_completion(line: &str, reply: &str) -> String {
    let reply = strip_reasoning(reply);
    let text = split_fence(&reply).map_or(reply, |(code, _)| code);
    let Some(first) = text.lines().map(str::trim).find(|l| !l.is_empty()) else {
        return String::new();
    };
    let mut candidate = unwrap_quotes(first);
    for marker in ["$ ", "> ", "# "] {
        candidate = candidate.strip_prefix(marker).unwrap_or(candidate);
    }
    let candidate = strip_controls(candidate);
    let typed = line.trim_start();
    let rest = if let Some(rest) = candidate.strip_prefix(typed) {
        rest
    } else if typed.ends_with(char::is_whitespace) {
        // The model dropped the trailing space: accept it only at a word boundary.
        match candidate.strip_prefix(typed.trim_end()) {
            Some(rest) if rest.starts_with(char::is_whitespace) => rest.trim_start(),
            _ => "",
        }
    } else {
        ""
    };
    cap(rest.trim_end(), MAX_COMPLETION).to_string()
}

#[derive(serde::Deserialize)]
struct Suggestion {
    #[serde(default)]
    command: String,
    #[serde(default)]
    explanation: String,
}

fn json_object(text: &str) -> Option<Suggestion> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// Reads `(command, explanation)` from the assistant's answer: JSON (bare, fenced or
/// inside text), else the first code block.
pub fn parse_assist(reply: &str) -> Option<(String, String)> {
    let reply = strip_reasoning(reply);
    let fence = split_fence(&reply);
    let parsed = json_object(&reply)
        .or_else(|| fence.as_ref().and_then(|(code, _)| json_object(code)))
        .map(|s| (s.command, s.explanation))
        .or(fence)?;
    let command = single_line(&parsed.0);
    let explanation = strip_controls_keep_lines(parsed.1.trim());
    if command.is_empty() && explanation.is_empty() {
        return None;
    }
    Some((command, explanation))
}

fn strip_controls_keep_lines(s: &str) -> String {
    s.chars()
        .filter(|&c| c == '\n' || !c.is_control())
        .collect()
}

/// The provider's own error message (`error.message`), with the key masked and shortened.
pub fn error_detail(body: &str, key: Option<&str>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let message = value["error"]["message"].as_str()?;
    let mut message = strip_controls(message.trim());
    if let Some(key) = key.filter(|k| !k.is_empty()) {
        message = message.replace(key, "***");
    }
    if message.is_empty() {
        return None;
    }
    if message.chars().count() > MAX_DETAIL {
        message = format!("{}…", cap(&message, MAX_DETAIL));
    }
    Some(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complete(line: &str) -> CompleteRequest {
        CompleteRequest {
            line: line.into(),
            os: "linux".into(),
            shell: Some("bash".into()),
            cwd: Some("/home/ana/src".into()),
            history: vec!["git status".into(), "cargo test".into()],
        }
    }

    #[test]
    fn complete_prompt_carries_only_the_given_fields() {
        let prompt = complete_prompt(&complete("git comm"));
        assert!(prompt.contains("OS: linux"), "{prompt}");
        assert!(prompt.contains("Shell: bash"), "{prompt}");
        assert!(prompt.contains("Current folder: /home/ana/src"), "{prompt}");
        assert!(prompt.contains("git status\ncargo test"), "{prompt}");
        assert!(prompt.contains(r#"Typed so far: "git comm""#), "{prompt}");

        let bare = CompleteRequest {
            line: "ls ".into(),
            os: "linux".into(),
            ..Default::default()
        };
        let prompt = complete_prompt(&bare);
        assert!(!prompt.contains("Shell:"), "{prompt}");
        assert!(!prompt.contains("Current folder:"), "{prompt}");
        assert!(!prompt.contains("Recent commands"), "{prompt}");
        assert!(prompt.contains(r#"Typed so far: "ls ""#), "{prompt}");
    }

    #[test]
    fn prompts_keep_only_the_last_twenty_history_commands() {
        let mut request = complete("ls");
        request.history = (0..30).map(|i| format!("cmd{i}")).collect();
        let prompt = complete_prompt(&request);
        assert!(!prompt.contains("cmd9\n"), "{prompt}");
        assert!(prompt.contains("cmd10\n"), "{prompt}");
        assert!(prompt.contains("cmd29"), "{prompt}");
    }

    #[test]
    fn assist_prompt_includes_the_request_and_the_selection_only_when_given() {
        let request = AssistRequest {
            prompt: "find big files".into(),
            selection: Some("du: cannot read".into()),
            os: "linux".into(),
            ..Default::default()
        };
        let prompt = assist_prompt(&request);
        assert!(prompt.contains("Request: find big files"), "{prompt}");
        assert!(
            prompt.contains("Selected terminal text:\ndu: cannot read"),
            "{prompt}"
        );
        let prompt = assist_prompt(&AssistRequest {
            selection: None,
            ..request
        });
        assert!(!prompt.contains("Selected terminal text"), "{prompt}");
    }

    #[test]
    fn completion_strips_the_echoed_line() {
        assert_eq!(
            clean_completion("git comm", "git commit -m \"wip\""),
            "it -m \"wip\""
        );
        assert_eq!(clean_completion("ls ", "ls -la"), "-la");
        assert_eq!(clean_completion("  docker ps", "docker ps -a"), " -a");
    }

    #[test]
    fn completion_strips_fences_backticks_quotes_and_prompt_markers() {
        assert_eq!(
            clean_completion("git pu", "```bash\ngit push origin main\n```"),
            "sh origin main"
        );
        assert_eq!(clean_completion("git pu", "`git push`"), "sh");
        assert_eq!(clean_completion("git pu", "\"git push\""), "sh");
        assert_eq!(clean_completion("git pu", "$ git push"), "sh");
    }

    #[test]
    fn completion_keeps_only_the_first_line() {
        assert_eq!(clean_completion("ls", "\nls -la\nls -R\n"), " -la");
    }

    #[test]
    fn completion_is_empty_when_the_reply_does_not_continue_the_line() {
        assert_eq!(clean_completion("ls ", "lsof -i"), "");
        assert_eq!(clean_completion("git", "cargo build"), "");
        assert_eq!(clean_completion("git push", "git push"), "");
        assert_eq!(clean_completion("git", ""), "");
    }

    #[test]
    fn completion_never_carries_control_characters_or_reasoning() {
        assert_eq!(clean_completion("echo", "echo hi\u{1b}[2J\u{7}"), " hi[2J");
        assert_eq!(
            clean_completion("ls", "<think>user wants ls</think>ls -l"),
            " -l"
        );
    }

    #[test]
    fn assist_parses_plain_json() {
        let reply = r#"{"command": "du -sh * | sort -h", "explanation": "Sizes, sorted."}"#;
        assert_eq!(
            parse_assist(reply),
            Some(("du -sh * | sort -h".into(), "Sizes, sorted.".into()))
        );
    }

    #[test]
    fn assist_parses_json_wrapped_in_fences_or_text() {
        let fenced = "```json\n{\"command\": \"ls -la\", \"explanation\": \"Lists all.\"}\n```";
        assert_eq!(
            parse_assist(fenced),
            Some(("ls -la".into(), "Lists all.".into()))
        );
        let chatty =
            "Sure! {\"command\": \"pwd\", \"explanation\": \"Prints the folder.\"} Hope it helps.";
        assert_eq!(
            parse_assist(chatty),
            Some(("pwd".into(), "Prints the folder.".into()))
        );
    }

    #[test]
    fn assist_falls_back_to_a_code_block_when_there_is_no_json() {
        let reply = "Use this:\n```sh\nfree -h\n```\nIt shows memory.";
        assert_eq!(
            parse_assist(reply),
            Some(("free -h".into(), "Use this:\nIt shows memory.".into()))
        );
    }

    #[test]
    fn assist_commands_are_one_line_without_control_characters() {
        let reply = r#"{"command": "cd /tmp\nls \\\n  -la\u001b[A\r", "explanation": "x"}"#;
        assert_eq!(
            parse_assist(reply),
            Some(("cd /tmp && ls -la[A".into(), "x".into()))
        );
    }

    #[test]
    fn assist_rejects_unreadable_answers() {
        assert_eq!(parse_assist("I cannot help with that."), None);
        assert_eq!(parse_assist(r#"{"command": "", "explanation": ""}"#), None);
    }

    #[test]
    fn error_detail_reads_the_provider_message_and_redacts_the_key() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad key sk-secret-123 here"}}"#;
        assert_eq!(
            error_detail(body, Some("sk-secret-123")).as_deref(),
            Some("bad key *** here")
        );
        assert_eq!(error_detail("<html>oops</html>", None), None);
        let long = format!(r#"{{"error":{{"message":"{}"}}}}"#, "x".repeat(500));
        assert_eq!(error_detail(&long, None).unwrap().chars().count(), 201);
    }
}
