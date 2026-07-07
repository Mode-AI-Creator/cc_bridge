//! ccbridge daemon：发现 + 解析 + 监控本地 Claude Code 会话，提供 HTTP/WS API。
mod api;
mod config;
#[cfg(feature = "embed-frontend")]
mod embed;
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
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // panic 记入日志（后台线程 panic 不至于静默丢失）
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!("panic: {info}");
        default_hook(info);
    }));

    // 配置需在解析（计价）之前装配：应用价格覆盖 + 标注版本
    let config = Arc::new(config::Config::load());
    ccbridge_core::pricing::set_table(config.pricing.to_table());
    tracing::info!(
        "价格表版本 {}（可在 config.toml [pricing] 覆盖）",
        ccbridge_core::pricing::PRICE_TABLE_VERSION
    );

    let projects = ccbridge_core::discovery::claude_projects_dir()
        .ok_or_else(|| anyhow::anyhow!("无法定位 ~/.claude/projects 目录"))?;
    if !projects.exists() {
        anyhow::bail!("目录不存在: {}", projects.display());
    }

    let mut store = store::Store::new();
    let t0 = std::time::Instant::now();
    store.reload_all(&projects);
    tracing::info!("已加载 {} 个会话（耗时 {:?}）", store.len(), t0.elapsed());
    let store = Arc::new(RwLock::new(store));

    // 未知模型告警（成本回退 sonnet 档估算）
    {
        let unknown: std::collections::BTreeSet<String> = store
            .read()
            .unwrap()
            .summaries()
            .iter()
            .filter_map(|s| s.model.clone())
            .filter(|m| !ccbridge_core::pricing::is_known(m))
            .collect();
        for m in unknown {
            tracing::warn!("未知模型 `{m}`：成本按 sonnet 档位估算，请更新价格表");
        }
    }

    let (tx, _rx) = broadcast::channel::<String>(64);
    watcher::spawn_watcher(projects.clone(), store.clone(), tx.clone());

    let sup = Arc::new(supervisor::Supervisor::new());
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
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("已优雅关闭");
    Ok(())
}

/// 等待 Ctrl-C 触发优雅关闭。
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("收到关闭信号，正在停止…");
}
