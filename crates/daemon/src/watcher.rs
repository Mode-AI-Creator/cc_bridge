//! 基于 notify 的文件监听：jsonl 变更 → 增量重解析 → 广播刷新通知。
//! 自带轻量去抖（同一文件 400ms 内只处理一次），避免大文件重复解析。
use crate::store::Store;
use notify::{RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

const DEBOUNCE: Duration = Duration::from_millis(400);

pub fn spawn_watcher(root: PathBuf, store: Arc<RwLock<Store>>, tx: broadcast::Sender<String>) {
    std::thread::spawn(move || {
        let (raw_tx, raw_rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = raw_tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                tracing::error!("创建文件监听失败: {}", e);
                return;
            }
        };
        if let Err(e) = watcher.watch(&root, RecursiveMode::Recursive) {
            tracing::error!("监听目录失败 {}: {}", root.display(), e);
            return;
        }
        tracing::info!("文件监听已启动: {}", root.display());

        let mut last_seen: HashMap<PathBuf, Instant> = HashMap::new();
        for res in raw_rx {
            let event = match res {
                Ok(ev) => ev,
                Err(e) => {
                    tracing::warn!("监听事件错误: {}", e);
                    continue;
                }
            };
            let mut changed = false;
            for path in event.paths {
                if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                    let now = Instant::now();
                    if let Some(prev) = last_seen.get(&path) {
                        if now.duration_since(*prev) < DEBOUNCE {
                            continue;
                        }
                    }
                    last_seen.insert(path.clone(), now);

                    if path.exists() {
                        store.write().unwrap().reload_file(&path);
                    } else {
                        store.write().unwrap().remove_file(&path);
                    }
                    changed = true;
                }
            }
            if changed {
                let _ = tx.send("{\"type\":\"update\"}".to_string());
            }
        }
    });
}
