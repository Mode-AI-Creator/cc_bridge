//! 领域模型：会话摘要、详情、用量、工具调用、状态。
use serde::Serialize;

/// 会话活跃状态。MVP 阶段从 last_active 时间推断；Phase 3 由 hook 精确化。
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Working,
    Waiting,
    Idle,
    Error,
    Unknown,
}

impl SessionStatus {
    /// 基于距最后活动的秒数推断状态（MVP 启发式，Phase 3 由 hook 精确化）。
    pub fn infer(secs_since_active: i64, had_error: bool) -> Self {
        const ACTIVE: i64 = 120; // 2 分钟内有活动视为活跃
        const IDLE: i64 = 1800; // 30 分钟内视为等待
        if had_error {
            return SessionStatus::Error;
        }
        if secs_since_active < 0 {
            SessionStatus::Unknown
        } else if secs_since_active <= ACTIVE {
            SessionStatus::Working
        } else if secs_since_active <= IDLE {
            SessionStatus::Waiting
        } else {
            SessionStatus::Idle
        }
    }
}

/// token 用量汇总（含按价格表算出的成本）。
#[derive(Debug, Clone, Default, Serialize)]
pub struct UsageTotals {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
    pub cost_usd: f64,
}

impl UsageTotals {
    pub fn total_tokens(&self) -> u64 {
        self.input + self.output + self.cache_creation + self.cache_read
    }
}

/// 单次工具调用的精简记录。
#[derive(Debug, Clone, Serialize)]
pub struct ToolCall {
    pub ts: String,
    pub name: String,
    pub detail: String,
}

/// 一条消息预览（截断后的文本）。
#[derive(Debug, Clone, Serialize)]
pub struct MessagePreview {
    pub ts: String,
    pub role: String,
    pub text: String,
}

/// 用量时间点，用于 5h/7d 滚动窗口聚合。
#[derive(Debug, Clone, Serialize)]
pub struct UsageTick {
    pub ts: i64, // epoch 秒
    pub cost_usd: f64,
    pub total_tokens: u64,
}

/// 会话摘要（列表视图用）。
#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub project_path: String,
    pub project_name: String,
    pub title: Option<String>,
    pub model: Option<String>,
    pub status: SessionStatus,
    pub started_at: Option<String>,
    pub last_active_at: Option<String>,
    pub last_active_epoch: i64,
    pub had_error: bool,
    pub message_count: u64,
    pub tool_count: u64,
    pub usage: UsageTotals,
    pub git_branch: Option<String>,
    pub file: String,
}

/// 会话详情（详情视图用）。
#[derive(Debug, Clone, Serialize)]
pub struct SessionDetail {
    #[serde(flatten)]
    pub summary: SessionSummary,
    pub recent_tools: Vec<ToolCall>,
    pub recent_messages: Vec<MessagePreview>,
    pub ticks: Vec<UsageTick>,
}

/// 解析单个 jsonl 文件得到的完整结果。
#[derive(Debug, Clone, Serialize)]
pub struct ParsedSession {
    #[serde(flatten)]
    pub summary: SessionSummary,
    pub recent_tools: Vec<ToolCall>,
    pub recent_messages: Vec<MessagePreview>,
    pub ticks: Vec<UsageTick>,
}

impl ParsedSession {
    pub fn into_summary(&self) -> SessionSummary {
        self.summary.clone()
    }
    pub fn into_detail(self) -> SessionDetail {
        SessionDetail {
            summary: self.summary,
            recent_tools: self.recent_tools,
            recent_messages: self.recent_messages,
            ticks: self.ticks,
        }
    }
}
