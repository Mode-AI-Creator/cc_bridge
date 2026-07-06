//! MCP server（Phase 6 S3）：`ccbridge mcp` 子命令。
//!
//! 实现最小 MCP stdio 传输（换行分隔的 JSON-RPC 2.0），把工具调用转成对本地
//! daemon 的 HTTP 请求 —— MCP 是薄客户端，真相在 daemon 的 SQLite 信箱。
//!
//! 自身会话身份取自环境变量 `CCBRIDGE_SESSION`（ccbridge 托管会话 spawn 时注入）；
//! 缺省时回退别名 `CCBRIDGE_ALIAS` 或 `"operator"`。

use anyhow::Result;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

fn me() -> String {
    std::env::var("CCBRIDGE_SESSION")
        .or_else(|_| std::env::var("CCBRIDGE_ALIAS"))
        .unwrap_or_else(|_| "operator".to_string())
}

fn port() -> u16 {
    std::env::var("CCBRIDGE_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7878)
}

/// 工具定义（tools/list 响应）。
fn tool_defs() -> Value {
    json!([
        {
            "name": "inbox_read",
            "description": "读取自己的收件箱（跨会话消息）。",
            "inputSchema": { "type": "object", "properties": {
                "unread_only": { "type": "boolean", "description": "仅未读" }
            }}
        },
        {
            "name": "send_to_session",
            "description": "给另一个 Claude Code 会话发消息。",
            "inputSchema": { "type": "object", "required": ["to","body"], "properties": {
                "to": { "type": "string", "description": "目标会话 id/别名" },
                "body": { "type": "string" },
                "urgent": { "type": "boolean", "description": "紧急则尝试即时注入对方终端" }
            }}
        },
        {
            "name": "shared_note_write",
            "description": "写入共享笔记（跨会话可见）。",
            "inputSchema": { "type": "object", "required": ["key","body"], "properties": {
                "key": { "type": "string" }, "body": { "type": "string" }
            }}
        },
        {
            "name": "shared_note_read",
            "description": "读取共享笔记。",
            "inputSchema": { "type": "object", "required": ["key"], "properties": {
                "key": { "type": "string" }
            }}
        },
        {
            "name": "search_other_sessions",
            "description": "按关键词搜索其它会话（项目名/标题/id）。",
            "inputSchema": { "type": "object", "properties": {
                "query": { "type": "string" }
            }}
        },
        {
            "name": "list_sessions",
            "description": "列出所有已知会话（可作为发送目标）。",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

/// 一次工具调用要发往 daemon 的 HTTP 请求（纯计划，便于单测）。
#[derive(Debug, PartialEq)]
pub struct CallPlan {
    pub method: &'static str,
    pub path: String,
    pub body: Option<Value>,
    /// 是否对返回结果做客户端过滤（search 用）。
    pub filter: Option<String>,
}

/// 纯函数：把工具名 + 参数 + 自身身份，映射为 HTTP 计划。
pub fn plan_call(me: &str, name: &str, args: &Value) -> Result<CallPlan> {
    let s = |k: &str| {
        args.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let b = |k: &str| args.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    Ok(match name {
        "inbox_read" => CallPlan {
            method: "GET",
            path: format!(
                "/api/inbox/{}?unread={}",
                urlencode(me),
                if b("unread_only") { "1" } else { "0" }
            ),
            body: None,
            filter: None,
        },
        "send_to_session" => CallPlan {
            method: "POST",
            path: "/api/inbox/send".to_string(),
            body: Some(
                json!({ "from": me, "to": s("to"), "body": s("body"), "urgent": b("urgent") }),
            ),
            filter: None,
        },
        "shared_note_write" => CallPlan {
            method: "POST",
            path: "/api/notes".to_string(),
            body: Some(json!({ "key": s("key"), "body": s("body"), "author": me })),
            filter: None,
        },
        "shared_note_read" => CallPlan {
            method: "GET",
            path: format!("/api/notes/{}", urlencode(&s("key"))),
            body: None,
            filter: None,
        },
        "search_other_sessions" => CallPlan {
            method: "GET",
            path: "/api/sessions".to_string(),
            body: None,
            filter: Some(s("query")),
        },
        "list_sessions" => CallPlan {
            method: "GET",
            path: "/api/sessions".to_string(),
            body: None,
            filter: None,
        },
        other => anyhow::bail!("未知工具: {other}"),
    })
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32 & 0xFF)
            }
        })
        .collect()
}

/// 执行计划：向 daemon 发 HTTP，返回文本结果。
fn execute(port: u16, plan: &CallPlan) -> Result<String> {
    let url = format!("http://127.0.0.1:{port}{}", plan.path);
    let resp = match (plan.method, &plan.body) {
        ("POST", Some(b)) => ureq::post(&url).send_json(b.clone()),
        ("GET", _) => ureq::get(&url).call(),
        _ => ureq::get(&url).call(),
    };
    let text = match resp {
        Ok(r) => r.into_string().unwrap_or_default(),
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            return Ok(format!("daemon 返回 {code}: {body}"));
        }
        Err(e) => return Ok(format!("无法连接 daemon: {e}")),
    };
    // search 客户端过滤
    if let Some(q) = &plan.filter {
        if !q.is_empty() {
            if let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(&text) {
                let ql = q.to_lowercase();
                let hit: Vec<Value> = arr
                    .into_iter()
                    .filter(|s| {
                        let hay = format!(
                            "{} {} {}",
                            s.get("project_name").and_then(|v| v.as_str()).unwrap_or(""),
                            s.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                            s.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                        )
                        .to_lowercase();
                        hay.contains(&ql)
                    })
                    .collect();
                return Ok(serde_json::to_string(&hit)?);
            }
        }
    }
    Ok(text)
}

/// 处理一条 JSON-RPC 消息，返回响应（通知则 None）。
fn handle(me: &str, port: u16, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "ccbridge", "version": env!("CARGO_PKG_VERSION") }
            }
        })),
        "tools/list" => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "result": { "tools": tool_defs() }
        })),
        "tools/call" => {
            let params = msg.get("params").cloned().unwrap_or(json!({}));
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let text = match plan_call(me, name, &args).and_then(|p| execute(port, &p)) {
                Ok(t) => t,
                Err(e) => e.to_string(),
            };
            Some(json!({
                "jsonrpc": "2.0", "id": id,
                "result": { "content": [ { "type": "text", "text": text } ] }
            }))
        }
        "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        // 通知（notifications/initialized 等）无需响应
        _ if id.is_none() => None,
        _ => Some(json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32601, "message": format!("method not found: {method}") }
        })),
    }
}

/// stdio 主循环。
pub fn run() -> Result<()> {
    let me = me();
    let port = port();
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(resp) = handle(&me, port, &msg) {
            let s = serde_json::to_string(&resp)?;
            writeln!(stdout, "{s}")?;
            stdout.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_reports_server_info() {
        let r = handle(
            "me",
            7878,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize"}),
        )
        .unwrap();
        assert_eq!(r["result"]["serverInfo"]["name"], "ccbridge");
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSION);
    }

    #[test]
    fn tools_list_has_expected_tools() {
        let r = handle(
            "me",
            7878,
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .unwrap();
        let names: Vec<&str> = r["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        for t in [
            "inbox_read",
            "send_to_session",
            "shared_note_write",
            "list_sessions",
        ] {
            assert!(names.contains(&t), "missing {t}");
        }
    }

    #[test]
    fn notification_gets_no_response() {
        let r = handle(
            "me",
            7878,
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        );
        assert!(r.is_none());
    }

    #[test]
    fn plan_send_uses_me_as_from() {
        let p = plan_call(
            "sessA",
            "send_to_session",
            &json!({"to":"sessB","body":"hi","urgent":true}),
        )
        .unwrap();
        assert_eq!(p.method, "POST");
        assert_eq!(p.path, "/api/inbox/send");
        let b = p.body.unwrap();
        assert_eq!(b["from"], "sessA");
        assert_eq!(b["to"], "sessB");
        assert_eq!(b["urgent"], true);
    }

    #[test]
    fn plan_inbox_read_encodes_self() {
        let p = plan_call("a/b", "inbox_read", &json!({"unread_only":true})).unwrap();
        assert_eq!(p.method, "GET");
        assert_eq!(p.path, "/api/inbox/a%2Fb?unread=1");
    }

    #[test]
    fn plan_note_write_sets_author() {
        let p = plan_call("me", "shared_note_write", &json!({"key":"plan","body":"x"})).unwrap();
        assert_eq!(p.body.unwrap()["author"], "me");
    }

    #[test]
    fn unknown_tool_errors() {
        assert!(plan_call("me", "bogus", &json!({})).is_err());
    }
}
