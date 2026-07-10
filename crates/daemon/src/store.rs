//! 内存会话存储 + 统计聚合（MVP；SQLite 持久化留作后续）。
use ccbridge_core::{
    discovery, parser, ParsedSession, SessionDetail, SessionStatus, SessionSummary,
};
use chrono::{TimeZone, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// 由 hook 上报的会话实时事实（Phase 3）。工具名在 WS 广播里携带，无需在此存储。
#[derive(Debug, Clone)]
pub struct HookFact {
    pub status: SessionStatus,
    pub ts: i64, // epoch 秒
}

pub struct Store {
    /// key = jsonl 文件路径（一个文件对应一个会话）。
    sessions: HashMap<String, ParsedSession>,
    /// key = sessionId → 最近一次 hook 事实。
    hooks: HashMap<String, HookFact>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct StatusCounts {
    pub working: usize,
    pub waiting: usize,
    pub idle: usize,
    pub error: usize,
    pub unknown: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectStat {
    pub project_name: String,
    pub sessions: usize,
    pub active: usize,
    pub cost_usd: f64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayStat {
    pub date: String, // YYYY-MM-DD (UTC)
    pub cost_usd: f64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub total_sessions: usize,
    pub active_sessions: usize,
    pub total_cost_usd: f64,
    pub cost_5h: f64,
    pub tokens_5h: u64,
    pub cost_7d: f64,
    pub tokens_7d: u64,
    pub status_counts: StatusCounts,
    pub by_project: Vec<ProjectStat>,
    pub heatmap: Vec<DayStat>,
}

impl Store {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            hooks: HashMap::new(),
        }
    }

    /// 记录一条 hook 事实（覆盖该会话的上一条）。
    pub fn record_hook(&mut self, session_id: &str, status: SessionStatus) {
        self.hooks.insert(
            session_id.to_string(),
            HookFact {
                status,
                ts: Utc::now().timestamp(),
            },
        );
    }

    pub fn reload_file(&mut self, path: &Path) {
        match parser::parse_file(path) {
            Ok(ps) => {
                self.sessions.insert(path.display().to_string(), ps);
            }
            Err(e) => {
                tracing::warn!("解析失败 {}: {}", path.display(), e);
            }
        }
    }

    pub fn remove_file(&mut self, path: &Path) {
        self.sessions.remove(&path.display().to_string());
    }

    pub fn reload_all(&mut self, root: &Path) {
        let files = discovery::find_session_files(root);
        tracing::info!("发现 {} 个会话文件", files.len());
        for f in &files {
            self.reload_file(f);
        }
    }

    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// 当前状态：hook 事实优先，时间启发式兜底。
    fn status_of(&self, s: &SessionSummary) -> SessionStatus {
        let now = Utc::now().timestamp();
        let secs = if s.last_active_epoch > 0 {
            now - s.last_active_epoch
        } else {
            -1
        };
        let hook = self.hooks.get(&s.id).map(|h| (h.status, now - h.ts));
        SessionStatus::resolve(hook, secs)
    }

    /// 会话摘要列表，按最近活动倒序；status 用当前时间即时重算。
    pub fn summaries(&self) -> Vec<SessionSummary> {
        let mut out: Vec<SessionSummary> = self
            .sessions
            .values()
            .map(|ps| {
                let mut s = ps.summary.clone();
                s.status = self.status_of(&s);
                s
            })
            .collect();
        out.sort_by_key(|s| std::cmp::Reverse(s.last_active_epoch));
        out
    }

    pub fn detail(&self, id: &str) -> Option<SessionDetail> {
        self.sessions
            .values()
            .find(|ps| ps.summary.id == id)
            .map(|ps| {
                let mut d = ps.clone().into_detail();
                d.summary.status = self.status_of(&d.summary);
                d
            })
    }

    pub fn stats(&self) -> Stats {
        let now = Utc::now().timestamp();
        let w5h = now - 5 * 3600;
        let w7d = now - 7 * 86400;
        let heatmap_days = 84i64;
        let heatmap_start = now - heatmap_days * 86400;

        let mut total_cost = 0.0;
        let mut cost_5h = 0.0;
        let mut tokens_5h = 0u64;
        let mut cost_7d = 0.0;
        let mut tokens_7d = 0u64;
        let mut status_counts = StatusCounts::default();
        let mut by_project: HashMap<String, ProjectStat> = HashMap::new();
        let mut by_day: HashMap<String, (f64, u64)> = HashMap::new();
        let mut active = 0usize;

        for ps in self.sessions.values() {
            let s = &ps.summary;
            total_cost += s.usage.cost_usd;

            let status = self.status_of(s);
            match status {
                SessionStatus::Working => {
                    status_counts.working += 1;
                    active += 1;
                }
                SessionStatus::Waiting => {
                    status_counts.waiting += 1;
                    active += 1;
                }
                SessionStatus::Idle => status_counts.idle += 1,
                SessionStatus::Error => status_counts.error += 1,
                SessionStatus::Unknown => status_counts.unknown += 1,
            }

            let entry = by_project
                .entry(s.project_name.clone())
                .or_insert_with(|| ProjectStat {
                    project_name: s.project_name.clone(),
                    sessions: 0,
                    active: 0,
                    cost_usd: 0.0,
                    total_tokens: 0,
                });
            entry.sessions += 1;
            entry.cost_usd += s.usage.cost_usd;
            entry.total_tokens += s.usage.total_tokens();
            if matches!(status, SessionStatus::Working | SessionStatus::Waiting) {
                entry.active += 1;
            }

            for tick in &ps.ticks {
                if tick.ts >= w5h {
                    cost_5h += tick.cost_usd;
                    tokens_5h += tick.total_tokens;
                }
                if tick.ts >= w7d {
                    cost_7d += tick.cost_usd;
                    tokens_7d += tick.total_tokens;
                }
                if tick.ts >= heatmap_start {
                    let date = day_key(tick.ts);
                    let d = by_day.entry(date).or_insert((0.0, 0));
                    d.0 += tick.cost_usd;
                    d.1 += tick.total_tokens;
                }
            }
        }

        let mut by_project: Vec<ProjectStat> = by_project.into_values().collect();
        by_project.sort_by(|a, b| {
            b.cost_usd
                .partial_cmp(&a.cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // 生成连续 84 天热力图
        let mut heatmap = Vec::with_capacity(heatmap_days as usize);
        for i in (0..heatmap_days).rev() {
            let ts = now - i * 86400;
            let date = day_key(ts);
            let (c, t) = by_day.get(&date).copied().unwrap_or((0.0, 0));
            heatmap.push(DayStat {
                date,
                cost_usd: c,
                total_tokens: t,
            });
        }

        Stats {
            total_sessions: self.sessions.len(),
            active_sessions: active,
            total_cost_usd: total_cost,
            cost_5h,
            tokens_5h,
            cost_7d,
            tokens_7d,
            status_counts,
            by_project,
            heatmap,
        }
    }
}

fn day_key(epoch: i64) -> String {
    Utc.timestamp_opt(epoch, 0)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ccbridge_core::{SessionSummary, UsageTotals};

    fn fake_session(id: &str, last_active_epoch: i64) -> ParsedSession {
        let summary = SessionSummary {
            id: id.to_string(),
            project_path: "/tmp/proj".to_string(),
            project_name: "proj".to_string(),
            title: None,
            model: None,
            status: SessionStatus::Unknown,
            started_at: None,
            last_active_at: None,
            last_active_epoch,
            had_error: false,
            message_count: 1,
            tool_count: 0,
            usage: UsageTotals::default(),
            git_branch: None,
            file: format!("/tmp/{id}.jsonl"),
        };
        ParsedSession {
            summary,
            recent_tools: vec![],
            recent_messages: vec![],
            ticks: vec![],
        }
    }

    #[test]
    fn hook_overrides_stale_time_status() {
        let mut store = Store::new();
        // 会话文件很久没动 → 时间启发式会判 idle
        let old = Utc::now().timestamp() - 100_000;
        store
            .sessions
            .insert("f1".to_string(), fake_session("s1", old));

        // 无 hook：idle
        let before = store.summaries();
        assert_eq!(before[0].status, SessionStatus::Idle);

        // 收到 PreToolUse hook → working（覆盖时间判断）
        store.record_hook("s1", SessionStatus::Working);
        let after = store.summaries();
        assert_eq!(after[0].status, SessionStatus::Working);

        // 统计里也应计入 active
        assert_eq!(store.stats().active_sessions, 1);
    }

    #[test]
    fn hook_for_unknown_session_is_harmless() {
        let mut store = Store::new();
        store.record_hook("ghost", SessionStatus::Working);
        assert_eq!(store.summaries().len(), 0);
        assert_eq!(store.stats().total_sessions, 0);
    }
}
