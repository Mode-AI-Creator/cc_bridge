export type SessionStatus = 'working' | 'waiting' | 'idle' | 'error' | 'unknown';

export interface UsageTotals {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  cost_usd: number;
}

export interface SessionSummary {
  id: string;
  project_path: string;
  project_name: string;
  title: string | null;
  model: string | null;
  status: SessionStatus;
  started_at: string | null;
  last_active_at: string | null;
  last_active_epoch: number;
  had_error: boolean;
  message_count: number;
  tool_count: number;
  usage: UsageTotals;
  git_branch: string | null;
  file: string;
}

export interface ToolCall {
  ts: string;
  name: string;
  detail: string;
}

export interface MessagePreview {
  ts: string;
  role: string;
  text: string;
}

export interface UsageTick {
  ts: number;
  cost_usd: number;
  total_tokens: number;
}

export interface SessionDetail extends SessionSummary {
  recent_tools: ToolCall[];
  recent_messages: MessagePreview[];
  ticks: UsageTick[];
}

export interface InboxMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  created_at: number;
  read_at: number | null;
  urgent: boolean;
}

export interface ManagedInfo {
  id: string;
  cwd: string;
  title: string;
  created_at: number;
  alive: boolean;
}

export interface StatusCounts {
  working: number;
  waiting: number;
  idle: number;
  error: number;
  unknown: number;
}

export interface ProjectStat {
  project_name: string;
  sessions: number;
  active: number;
  cost_usd: number;
  total_tokens: number;
}

export interface DayStat {
  date: string;
  cost_usd: number;
  total_tokens: number;
}

export interface Stats {
  total_sessions: number;
  active_sessions: number;
  total_cost_usd: number;
  cost_5h: number;
  tokens_5h: number;
  cost_7d: number;
  tokens_7d: number;
  status_counts: StatusCounts;
  by_project: ProjectStat[];
  heatmap: DayStat[];
}
