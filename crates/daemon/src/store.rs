//! 内存会话存储 + 统计聚合（MVP；SQLite 持久化留作后续）。
use ccbridge_core::{discovery, parser, ParsedSession, SessionDetail, SessionStatus, SessionSummary};
use chrono::{TimeZone, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub struct Store {
    /// key = jsonl 文件路径（一个文件对应一个会话）。
    sessions: HashMap<String, ParsedSession>,
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
        }
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

    fn refresh_status(s: &SessionSummary) -> SessionStatus {
        let secs = if s.last_active_epoch > 0 {
            Utc::now().timestamp() - s.last_active_epoch
        } else {
            -1
        };
        SessionStatus::infer(secs, s.had_error)
    }

    /// 会话摘要列表，按最近活动倒序；status 用当前时间即时重算。
    pub fn summaries(&self) -> Vec<SessionSummary> {
        let mut out: Vec<SessionSummary> = self
            .sessions
            .values()
            .map(|ps| {
                let mut s = ps.summary.clone();
                s.status = Self::refresh_status(&s);
                s
            })
            .collect();
        out.sort_by(|a, b| b.last_active_epoch.cmp(&a.last_active_epoch));
        out
    }

    pub fn detail(&self, id: &str) -> Option<SessionDetail> {
        self.sessions
            .values()
            .find(|ps| ps.summary.id == id)
            .map(|ps| {
                let mut d = ps.clone().into_detail();
                d.summary.status = Self::refresh_status(&d.summary);
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

            let status = Self::refresh_status(s);
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
        by_project.sort_by(|a, b| b.cost_usd.partial_cmp(&a.cost_usd).unwrap_or(std::cmp::Ordering::Equal));

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
