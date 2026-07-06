//! ccbridge daemon：发现 + 解析 + 监控本地 Claude Code 会话，提供 HTTP/WS API。
mod api;
mod config;
mod error;
mod hooks_config;
mod mailbox;
mod mcp;
mod store;
mod supervisor;
mod themes;
mod watcher;

use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // CLI 子命令：install-hooks / uninstall-hooks（无需启动 daemon）
    let arg1 = std::env::args().nth(1);
    match arg1.as_deref() {
        Some("install-hooks") => return hooks_config::install(),
        Some("uninstall-hooks") => return hooks_config::uninstall(),
        Some("mcp") => return mcp::run(),
        Some("--help") | Some("-h") => {
            println!("ccbridge — 本地 Claude Code 会话指挥中心");
            println!("用法:");
            println!("  ccbridge                 启动 daemon (默认 127.0.0.1:7878)");
            println!("  ccbridge install-hooks   注入 CC hook + MCP server 到 settings.json");
            println!("  ccbridge uninstall-hooks 移除已注入的 hook 与 MCP server");
            println!("  ccbridge mcp             作为 MCP server 运行 (stdio，供 CC 调用)");
            return Ok(());
        }
        _ => {}
    }

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
    let config = Arc::new(config::Config::load());
    let mailbox = Arc::new(mailbox::Mailbox::open_default().unwrap_or_else(|e| {
        tracing::warn!("信箱 SQLite 打开失败，降级内存库：{e}");
        mailbox::Mailbox::open_memory().expect("内存库")
    }));

    let addr = config.server.addr.clone();
    let state = api::AppState {
        store: store.clone(),
        tx: tx.clone(),
        sup,
        config,
        mailbox,
    };
    let app = api::with_static(api::router(state));

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ccbridge daemon 已启动 → http://{}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
