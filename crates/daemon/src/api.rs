//! HTTP + WebSocket API。
use crate::store::Store;
use crate::supervisor::Supervisor;
use ccbridge_core::HookKind;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxPath, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<RwLock<Store>>,
    pub tx: broadcast::Sender<String>,
    pub sup: Arc<Supervisor>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions/:id", get(get_session))
        .route("/api/stats", get(get_stats))
        .route("/api/hook", post(post_hook))
        .route("/ws", get(ws_handler))
        // PTY 托管
        .route("/api/managed", get(list_managed))
        .route("/api/spawn", post(spawn_session))
        .route("/api/managed/:id/kill", post(kill_session))
        .route("/api/pty/:id", get(pty_ws))
        // 文件系统浏览（新建会话选目录）
        .route("/api/fs/list", get(fs_list))
        .route("/api/fs/mkdir", post(fs_mkdir))
        // 吉祥物换肤主题
        .route("/api/themes", get(list_themes))
        .route("/api/themes/:name/asset/:state", get(get_theme_asset))
        .route("/api/themes/:name/asset/:state", post(upload_theme_asset))
        .with_state(state)
        .layer(CorsLayer::permissive())
}

/// 若找到 web/dist 则挂载静态前端（SPA fallback 到 index.html）。
pub fn with_static(app: Router) -> Router {
    use tower_http::services::{ServeDir, ServeFile};
    for cand in ["web/dist", "../../web/dist", "../web/dist"] {
        if std::path::Path::new(cand).exists() {
            let serve = ServeDir::new(cand)
                .not_found_service(ServeFile::new(format!("{cand}/index.html")));
            tracing::info!("静态前端目录: {}", cand);
            return app.fallback_service(serve);
        }
    }
    tracing::warn!("未找到 web/dist，仅提供 API（前端请用 `npm run dev`）");
    app
}

// ---------- 观测（JSONL 发现） ----------

async fn list_sessions(State(s): State<AppState>) -> impl IntoResponse {
    let summaries = s.store.read().unwrap().summaries();
    Json(summaries)
}

async fn get_session(State(s): State<AppState>, AxPath(id): AxPath<String>) -> impl IntoResponse {
    let detail = s.store.read().unwrap().detail(&id);
    match detail {
        Some(d) => Json(d).into_response(),
        None => (StatusCode::NOT_FOUND, "session not found").into_response(),
    }
}

async fn get_stats(State(s): State<AppState>) -> impl IntoResponse {
    let stats = s.store.read().unwrap().stats();
    Json(stats)
}

// ---------- Hook 上报（Phase 3） ----------

#[derive(Deserialize)]
struct HookReq {
    session_id: String,
    event: String,
    #[serde(default)]
    tool: Option<String>,
}

/// POST /api/hook — CC hook 脚本上报实时事件；更新状态并经 WS 广播动作流。
async fn post_hook(State(s): State<AppState>, Json(req): Json<HookReq>) -> impl IntoResponse {
    let Some(kind) = HookKind::parse(&req.event) else {
        // 未知事件：忽略但不报错，避免 hook 脚本因 4xx 噪声
        return StatusCode::NO_CONTENT;
    };
    if req.session_id.trim().is_empty() {
        return StatusCode::NO_CONTENT;
    }
    let status = kind.implied_status();
    s.store
        .write()
        .unwrap()
        .record_hook(&req.session_id, status, req.tool.clone());

    let msg = serde_json::json!({
        "type": "hook",
        "session_id": req.session_id,
        "event": kind.event_name(),
        "tool": req.tool,
        "status": status,
    })
    .to_string();
    let _ = s.tx.send(msg);

    StatusCode::NO_CONTENT
}

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, s))
}

async fn ws_loop(mut socket: WebSocket, s: AppState) {
    let mut rx = s.tx.subscribe();
    if socket
        .send(Message::Text("{\"type\":\"hello\"}".to_string()))
        .await
        .is_err()
    {
        return;
    }
    loop {
        match rx.recv().await {
            Ok(msg) => {
                if socket.send(Message::Text(msg)).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

// ---------- PTY 托管 ----------

#[derive(Deserialize)]
struct SpawnReq {
    cwd: String,
    /// 可选：resume 已有会话 id（claude --resume <id>）。
    resume: Option<String>,
    /// 可选：加 --dangerously-skip-permissions（跳过权限确认）。
    #[serde(default)]
    skip_permissions: bool,
}

async fn list_managed(State(s): State<AppState>) -> impl IntoResponse {
    Json(s.sup.list())
}

async fn spawn_session(State(s): State<AppState>, Json(req): Json<SpawnReq>) -> impl IntoResponse {
    let program = std::env::var("CCBRIDGE_CLAUDE").unwrap_or_else(|_| "claude".to_string());
    let mut args: Vec<String> = Vec::new();
    if req.skip_permissions {
        args.push("--dangerously-skip-permissions".to_string());
    }
    if let Some(r) = &req.resume {
        args.push("--resume".to_string());
        args.push(r.clone());
    }
    let title = basename(&req.cwd);
    match s.sup.spawn(&req.cwd, &program, &args, &title) {
        Ok(id) => Json(serde_json::json!({ "id": id })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn kill_session(State(s): State<AppState>, AxPath(id): AxPath<String>) -> impl IntoResponse {
    s.sup.kill(&id);
    StatusCode::NO_CONTENT
}

/// 终端 WebSocket：server→client 推 PTY 输出（先回放缓冲），client→server 发输入。
/// 控制消息：文本以 `\u{1}resize:<rows>,<cols>` 前缀表示 resize，其余按键盘输入写入 PTY。
async fn pty_ws(
    ws: WebSocketUpgrade,
    State(s): State<AppState>,
    AxPath(id): AxPath<String>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| pty_loop(socket, s, id))
}

async fn pty_loop(socket: WebSocket, s: AppState, id: String) {
    let Some(sess) = s.sup.get(&id) else {
        return;
    };
    let (mut sink, mut stream) = socket.split();

    // 回放尾部缓冲，让终端恢复当前画面
    let snap = sess.snapshot();
    if !snap.is_empty() && sink.send(Message::Binary(snap)).await.is_err() {
        return;
    }

    // 输出泵
    let mut rx = sess.output_tx.subscribe();
    let out_task = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(b) => {
                    if sink.send(Message::Binary(b)).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // 输入泵
    while let Some(Ok(msg)) = stream.next().await {
        match msg {
            Message::Text(t) => {
                if let Some(rest) = t.strip_prefix('\u{1}') {
                    if let Some(dims) = rest.strip_prefix("resize:") {
                        let mut it = dims.split(',');
                        if let (Some(r), Some(c)) = (it.next(), it.next()) {
                            if let (Ok(r), Ok(c)) = (r.parse::<u16>(), c.parse::<u16>()) {
                                let _ = sess.resize(r, c);
                            }
                        }
                    }
                } else {
                    let _ = sess.write_input(t.as_bytes());
                }
            }
            Message::Binary(b) => {
                let _ = sess.write_input(&b);
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
    out_task.abort();
}

fn basename(path: &str) -> String {
    let norm = path.replace('\\', "/");
    norm.rsplit('/')
        .find(|s| !s.is_empty())
        .unwrap_or(&norm)
        .to_string()
}

// ---------- 文件系统浏览 ----------

#[derive(Deserialize)]
struct ListQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct DirEntryDto {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct ListResp {
    path: String,
    parent: Option<String>,
    dirs: Vec<DirEntryDto>,
}

/// 列出驱动器（Windows）或根（其他平台）。
fn list_roots() -> Vec<DirEntryDto> {
    #[cfg(windows)]
    {
        ('A'..='Z')
            .filter_map(|c| {
                let p = format!("{c}:\\");
                std::path::Path::new(&p).exists().then(|| DirEntryDto {
                    name: format!("{c}:"),
                    path: p,
                })
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![DirEntryDto {
            name: "/".to_string(),
            path: "/".to_string(),
        }]
    }
}

/// GET /api/fs/list?path=... — 列出子目录；path 为空则列出驱动器/根。
async fn fs_list(Query(q): Query<ListQuery>) -> impl IntoResponse {
    let raw = q.path.unwrap_or_default();
    if raw.trim().is_empty() {
        return Json(ListResp {
            path: String::new(),
            parent: None,
            dirs: list_roots(),
        })
        .into_response();
    }
    let p = std::path::Path::new(&raw);
    match std::fs::read_dir(p) {
        Ok(rd) => {
            let mut dirs: Vec<DirEntryDto> = rd
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| DirEntryDto {
                    name: e.file_name().to_string_lossy().to_string(),
                    path: e.path().to_string_lossy().to_string(),
                })
                .collect();
            dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            let parent = p.parent().map(|pp| pp.to_string_lossy().to_string());
            Json(ListResp {
                path: p.to_string_lossy().to_string(),
                parent,
                dirs,
            })
            .into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, format!("无法读取目录: {e}")).into_response(),
    }
}

#[derive(Deserialize)]
struct MkdirReq {
    parent: String,
    name: String,
}

/// POST /api/fs/mkdir — 在 parent 下新建文件夹，返回新路径。
async fn fs_mkdir(Json(req): Json<MkdirReq>) -> impl IntoResponse {
    let name = req.name.trim();
    if name.is_empty() || name.contains(['/', '\\']) {
        return (StatusCode::BAD_REQUEST, "文件夹名不合法".to_string()).into_response();
    }
    let full = std::path::Path::new(&req.parent).join(name);
    match std::fs::create_dir_all(&full) {
        Ok(_) => Json(serde_json::json!({ "path": full.to_string_lossy() })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, format!("创建失败: {e}")).into_response(),
    }
}

// ---------- 吉祥物换肤主题 ----------

async fn list_themes() -> impl IntoResponse {
    Json(crate::themes::list_themes())
}

/// GET /api/themes/:name/asset/:state — 返回资产字节。
async fn get_theme_asset(AxPath((name, state)): AxPath<(String, String)>) -> impl IntoResponse {
    match crate::themes::read_asset(&name, &state) {
        Some((bytes, ct)) => (
            [(axum::http::header::CONTENT_TYPE, ct)],
            bytes,
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "无此资产").into_response(),
    }
}

#[derive(Deserialize)]
struct UploadReq {
    filename: String,
    /// base64 编码的资产字节。
    data_base64: String,
}

/// POST /api/themes/:name/asset/:state — 上传单个状态资产（base64）。
async fn upload_theme_asset(
    AxPath((name, state)): AxPath<(String, String)>,
    Json(req): Json<UploadReq>,
) -> impl IntoResponse {
    use base64::Engine;
    let bytes = match base64::engine::general_purpose::STANDARD.decode(req.data_base64.as_bytes()) {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "base64 解码失败".to_string()).into_response(),
    };
    match crate::themes::write_asset(&name, &state, &req.filename, &bytes) {
        Ok(fname) => Json(serde_json::json!({ "file": fname })).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

// ---------- HTTP 冒烟测试（Phase 3） ----------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use tower::ServiceExt; // for `oneshot`

    fn test_state() -> AppState {
        let store = Arc::new(RwLock::new(Store::new()));
        let (tx, _rx) = broadcast::channel(16);
        AppState {
            store,
            tx,
            sup: Arc::new(Supervisor::new()),
        }
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let res = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert_eq!(&body[..], b"ok");
    }

    #[tokio::test]
    async fn hook_accepts_valid_and_ignores_unknown() {
        let app = router(test_state());
        let good = Request::builder()
            .method("POST")
            .uri("/api/hook")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"session_id":"s1","event":"PreToolUse","tool":"Bash"}"#,
            ))
            .unwrap();
        let res = app.clone().oneshot(good).await.unwrap();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);

        // 未知事件仍 204，避免给 hook 脚本制造 4xx 噪声
        let bad = Request::builder()
            .method("POST")
            .uri("/api/hook")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"session_id":"s1","event":"Bogus"}"#))
            .unwrap();
        let res2 = app.oneshot(bad).await.unwrap();
        assert_eq!(res2.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn stats_returns_json_ok() {
        let res = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/api/stats")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn themes_list_ok() {
        let res = router(test_state())
            .oneshot(
                Request::builder()
                    .uri("/api/themes")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn theme_upload_rejects_bad_format() {
        // .bmp 非白名单 → 400
        let bad = Request::builder()
            .method("POST")
            .uri("/api/themes/myskin/asset/idle")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"filename":"x.bmp","data_base64":"AAAA"}"#,
            ))
            .unwrap();
        let res = router(test_state()).oneshot(bad).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
