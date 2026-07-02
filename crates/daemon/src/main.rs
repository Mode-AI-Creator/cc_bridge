//! ccbridge daemon：发现 + 解析 + 监控本地 Claude Code 会话，提供 HTTP/WS API。
mod api;
mod store;
mod supervisor;
mod watcher;

use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let projects = ccbridge_core::discovery::claude_projects_dir()
        .ok_or_else(|| anyhow::anyhow!("无法定位 ~/.claude/projects 目录"))?;
    if !projects.exists() {
        anyhow::bail!("目录不存在: {}", projects.display());
    }

    let mut store = store::Store::new();
    let t0 = std::time::Instant::now();
    store.reload_all(&projects);
    tracing::info!(
        "已加载 {} 个会话（耗时 {:?}）",
        store.len(),
        t0.elapsed()
    );
    let store = Arc::new(RwLock::new(store));

    let (tx, _rx) = broadcast::channel::<String>(64);
    watcher::spawn_watcher(projects.clone(), store.clone(), tx.clone());

    let sup = Arc::new(supervisor::Supervisor::new());

    let state = api::AppState {
        store: store.clone(),
        tx: tx.clone(),
        sup,
    };
    let app = api::with_static(api::router(state));

    let addr = std::env::var("CCBRIDGE_ADDR").unwrap_or_else(|_| "127.0.0.1:7878".to_string());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ccbridge daemon 已启动 → http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
