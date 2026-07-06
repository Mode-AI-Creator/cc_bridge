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

/// Working hook 事实的粘滞时长（秒）：此窗口内即便工具间有空档也保持 working。
pub const HOOK_WORKING_TTL: i64 = 120;
/// Waiting hook 事实的有效时长（秒）：超过后回落 idle。
pub const HOOK_WAITING_TTL: i64 = 1800;

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

    /// 「hook 优先、时间兜底」的状态判定。
    ///
    /// `hook` = 最近一次 hook 事实 `(状态, 距该事件的秒数)`；无 hook 传 `None`。
    /// - Working 事实在 [`HOOK_WORKING_TTL`] 内粘滞（覆盖工具间空档），过期回落时间推断。
    /// - Waiting 事实在 [`HOOK_WAITING_TTL`] 内有效，过期回落 idle。
    /// - 其余显式状态（Idle/Error/Unknown）直接采用。
    pub fn resolve(hook: Option<(SessionStatus, i64)>, secs_since_active: i64) -> Self {
        if let Some((hs, age)) = hook {
            match hs {
                SessionStatus::Working if age <= HOOK_WORKING_TTL => return SessionStatus::Working,
                SessionStatus::Working => {} // 陈旧 working → 回落时间推断
                SessionStatus::Waiting if age <= HOOK_WAITING_TTL => return SessionStatus::Waiting,
                SessionStatus::Waiting => return SessionStatus::Idle, // 陈旧 waiting → idle
                other => return other,
            }
        }
        Self::infer(secs_since_active, false)
    }
}

/// CC settings.json 支持的 hook 事件种类（Phase 3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookKind {
    SessionStart,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    Notification,
    Stop,
}

impl HookKind {
    /// 从 hook 事件名解析（接受 CC 原名与 snake_case 两种写法）。
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "SessionStart" | "session_start" => Some(Self::SessionStart),
            "UserPromptSubmit" | "user_prompt_submit" => Some(Self::UserPromptSubmit),
            "PreToolUse" | "pre_tool_use" => Some(Self::PreToolUse),
            "PostToolUse" | "post_tool_use" => Some(Self::PostToolUse),
            "Notification" | "notification" => Some(Self::Notification),
            "Stop" | "stop" => Some(Self::Stop),
            _ => None,
        }
    }

    /// 所有需注册的事件（供自动配置器使用）。
    pub const ALL: [HookKind; 6] = [
        HookKind::SessionStart,
        HookKind::UserPromptSubmit,
        HookKind::PreToolUse,
        HookKind::PostToolUse,
        HookKind::Notification,
        HookKind::Stop,
    ];

    /// CC settings.json 中的事件键名。
    pub fn event_name(self) -> &'static str {
        match self {
            HookKind::SessionStart => "SessionStart",
            HookKind::UserPromptSubmit => "UserPromptSubmit",
            HookKind::PreToolUse => "PreToolUse",
            HookKind::PostToolUse => "PostToolUse",
            HookKind::Notification => "Notification",
            HookKind::Stop => "Stop",
        }
    }

    /// 该 hook 事件暗示的即时会话状态。
    pub fn implied_status(self) -> SessionStatus {
        match self {
            // agent 正在推进（提交提示 / 调工具中）
            HookKind::UserPromptSubmit | HookKind::PreToolUse | HookKind::PostToolUse => {
                SessionStatus::Working
            }
            // 等待用户（启动就绪 / 需确认 / 一轮结束）
            HookKind::SessionStart | HookKind::Notification | HookKind::Stop => {
                SessionStatus::Waiting
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hookkind_parses_both_casings() {
        assert_eq!(HookKind::parse("PreToolUse"), Some(HookKind::PreToolUse));
        assert_eq!(HookKind::parse("stop"), Some(HookKind::Stop));
        assert_eq!(HookKind::parse("nope"), None);
    }

    #[test]
    fn implied_status_maps_working_vs_waiting() {
        assert_eq!(
            HookKind::PreToolUse.implied_status(),
            SessionStatus::Working
        );
        assert_eq!(
            HookKind::UserPromptSubmit.implied_status(),
            SessionStatus::Working
        );
        assert_eq!(HookKind::Stop.implied_status(), SessionStatus::Waiting);
        assert_eq!(
            HookKind::Notification.implied_status(),
            SessionStatus::Waiting
        );
    }

    #[test]
    fn resolve_fresh_working_hook_is_working() {
        // 即使距文件活动很久，新鲜的 working hook 也判 working
        let s = SessionStatus::resolve(Some((SessionStatus::Working, 30)), 9999);
        assert_eq!(s, SessionStatus::Working);
    }

    #[test]
    fn resolve_stale_working_falls_back_to_time() {
        // 陈旧 working（>TTL）回落时间推断：近期活动 → working
        let s = SessionStatus::resolve(Some((SessionStatus::Working, HOOK_WORKING_TTL + 10)), 5);
        assert_eq!(s, SessionStatus::Working);
        // 陈旧 working + 久无活动 → idle
        let s2 = SessionStatus::resolve(Some((SessionStatus::Working, 9999)), 999999);
        assert_eq!(s2, SessionStatus::Idle);
    }

    #[test]
    fn resolve_waiting_decays_to_idle() {
        let fresh = SessionStatus::resolve(Some((SessionStatus::Waiting, 60)), 9999);
        assert_eq!(fresh, SessionStatus::Waiting);
        let stale =
            SessionStatus::resolve(Some((SessionStatus::Waiting, HOOK_WAITING_TTL + 1)), 9999);
        assert_eq!(stale, SessionStatus::Idle);
    }

    #[test]
    fn resolve_no_hook_uses_time_heuristic() {
        assert_eq!(SessionStatus::resolve(None, 10), SessionStatus::Working);
        assert_eq!(SessionStatus::resolve(None, 600), SessionStatus::Waiting);
        assert_eq!(SessionStatus::resolve(None, 99999), SessionStatus::Idle);
        assert_eq!(SessionStatus::resolve(None, -1), SessionStatus::Unknown);
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
