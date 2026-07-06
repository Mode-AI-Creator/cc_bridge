//! 容错 JSONL 解析：逐行读取一个会话文件，聚合用量/工具/消息/状态。
//! 任何单行 JSON 失败或字段缺失都不会中断整体解析。
use crate::model::*;
use crate::pricing;
use chrono::Utc;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

const MAX_TOOLS: usize = 40;
const MAX_MSGS: usize = 20;
const MSG_LEN: usize = 280;
const TOOL_DETAIL_LEN: usize = 120;

pub fn parse_file(path: &Path) -> anyhow::Result<ParsedSession> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut id = String::new();
    let mut cwd: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut title: Option<String> = None;
    let mut model: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut last_active_at: Option<String> = None;
    // MVP：状态纯按活动时间推断。历史里偶发的 hook 错误不代表会话失败，
    // 真正的 error 判定留给 Phase 3 的实时 hook。
    let had_error = false;
    let mut message_count: u64 = 0;
    let mut tool_count: u64 = 0;
    let mut usage = UsageTotals::default();
    let mut recent_tools: Vec<ToolCall> = Vec::new();
    let mut recent_messages: Vec<MessagePreview> = Vec::new();
    let mut ticks: Vec<UsageTick> = Vec::new();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(t) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if id.is_empty() {
            if let Some(s) = v.get("sessionId").and_then(|x| x.as_str()) {
                id = s.to_string();
            }
        }
        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if started_at.is_none() {
                started_at = Some(ts.to_string());
            }
            last_active_at = Some(ts.to_string());
        }
        if cwd.is_none() {
            if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) {
                cwd = Some(c.to_string());
            }
        }
        if git_branch.is_none() {
            if let Some(g) = v.get("gitBranch").and_then(|x| x.as_str()) {
                if !g.is_empty() {
                    git_branch = Some(g.to_string());
                }
            }
        }

        match kind {
            "ai-title" => {
                if let Some(t2) = v.get("aiTitle").and_then(|x| x.as_str()) {
                    title = Some(t2.to_string());
                }
            }
            "user" => {
                message_count += 1;
                if let Some(msg) = v.get("message") {
                    if let Some(txt) = extract_user_text(msg) {
                        push_msg(&mut recent_messages, &v, "user", &txt);
                    }
                }
            }
            "assistant" => {
                message_count += 1;
                if let Some(msg) = v.get("message") {
                    if let Some(md) = msg.get("model").and_then(|x| x.as_str()) {
                        model = Some(md.to_string());
                    }
                    if let Some(u) = msg.get("usage") {
                        let inp = u.get("input_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                        let out = u.get("output_tokens").and_then(|x| x.as_u64()).unwrap_or(0);
                        let cw = u
                            .get("cache_creation_input_tokens")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(0);
                        let cr = u
                            .get("cache_read_input_tokens")
                            .and_then(|x| x.as_u64())
                            .unwrap_or(0);
                        let md = model.as_deref().unwrap_or("sonnet");
                        let c = pricing::cost(md, inp, out, cw, cr);
                        usage.input += inp;
                        usage.output += out;
                        usage.cache_creation += cw;
                        usage.cache_read += cr;
                        usage.cost_usd += c;
                        let epoch = v
                            .get("timestamp")
                            .and_then(|x| x.as_str())
                            .and_then(parse_epoch)
                            .unwrap_or(0);
                        ticks.push(UsageTick {
                            ts: epoch,
                            cost_usd: c,
                            total_tokens: inp + out + cw + cr,
                        });
                    }
                    if let Some(content) = msg.get("content").and_then(|x| x.as_array()) {
                        let mut text_buf = String::new();
                        for block in content {
                            match block.get("type").and_then(|x| x.as_str()) {
                                Some("text") => {
                                    if let Some(tx) = block.get("text").and_then(|x| x.as_str()) {
                                        text_buf.push_str(tx);
                                    }
                                }
                                Some("tool_use") => {
                                    tool_count += 1;
                                    let name = block
                                        .get("name")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("tool")
                                        .to_string();
                                    let detail = tool_digest(block.get("input"));
                                    let ts = v
                                        .get("timestamp")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    recent_tools.push(ToolCall { ts, name, detail });
                                }
                                _ => {}
                            }
                        }
                        if !text_buf.trim().is_empty() {
                            push_msg(&mut recent_messages, &v, "assistant", text_buf.trim());
                        }
                    }
                }
            }
            _ => {}
        }

        if recent_tools.len() > MAX_TOOLS {
            let drop = recent_tools.len() - MAX_TOOLS;
            recent_tools.drain(0..drop);
        }
        if recent_messages.len() > MAX_MSGS {
            let drop = recent_messages.len() - MAX_MSGS;
            recent_messages.drain(0..drop);
        }
    }

    let project_path = cwd.clone().unwrap_or_else(|| {
        path.parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    });
    let project_name = project_basename(&project_path);
    let last_active_epoch = last_active_at.as_deref().and_then(parse_epoch).unwrap_or(0);
    if id.is_empty() {
        id = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
    }

    let secs = if last_active_epoch > 0 {
        Utc::now().timestamp() - last_active_epoch
    } else {
        -1
    };
    let status = SessionStatus::infer(secs, had_error);

    let summary = SessionSummary {
        id,
        project_path,
        project_name,
        title,
        model,
        status,
        started_at,
        last_active_at,
        last_active_epoch,
        had_error,
        message_count,
        tool_count,
        usage,
        git_branch,
        file: path.display().to_string(),
    };

    Ok(ParsedSession {
        summary,
        recent_tools,
        recent_messages,
        ticks,
    })
}

/// user 消息文本：content 可能是 string 或 array（取 text 块）。
fn extract_user_text(msg: &serde_json::Value) -> Option<String> {
    let content = msg.get("content")?;
    if let Some(s) = content.as_str() {
        let s = s.trim();
        return if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        };
    }
    if let Some(arr) = content.as_array() {
        let mut buf = String::new();
        for b in arr {
            if b.get("type").and_then(|x| x.as_str()) == Some("text") {
                if let Some(tx) = b.get("text").and_then(|x| x.as_str()) {
                    buf.push_str(tx);
                }
            }
        }
        let buf = buf.trim();
        return if buf.is_empty() {
            None
        } else {
            Some(buf.to_string())
        };
    }
    None
}

fn push_msg(vec: &mut Vec<MessagePreview>, v: &serde_json::Value, role: &str, text: &str) {
    let ts = v
        .get("timestamp")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    vec.push(MessagePreview {
        ts,
        role: role.to_string(),
        text: truncate(text, MSG_LEN),
    });
}

/// 工具调用摘要：优先取常见关键字段，否则截断整个 input。
fn tool_digest(input: Option<&serde_json::Value>) -> String {
    let Some(input) = input else {
        return String::new();
    };
    for key in [
        "file_path",
        "path",
        "command",
        "pattern",
        "url",
        "query",
        "description",
        "prompt",
    ] {
        if let Some(val) = input.get(key).and_then(|x| x.as_str()) {
            return truncate(val.trim(), TOOL_DETAIL_LEN);
        }
    }
    truncate(input.to_string().trim(), TOOL_DETAIL_LEN)
}

/// ISO8601/RFC3339 → epoch 秒。
pub fn parse_epoch(ts: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp())
}

fn project_basename(path: &str) -> String {
    let norm = path.replace('\\', "/");
    norm.rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(&norm)
        .to_string()
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}
